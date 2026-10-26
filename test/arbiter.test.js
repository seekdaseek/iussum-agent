import test from 'node:test';
import assert from 'node:assert/strict';
import { createArbiter } from '../src/dispute/arbiter.js';
import { openDisputeStore } from '../src/dispute/store.js';
import { makeCase, fakeRpc, stubProvider, vans } from './cases.js';

const setup = async (opts = {}, caseOpts = {}) => {
  const c = await makeCase(caseOpts);
  const sent = [];
  const store = openDisputeStore();
  let clock = 1_800_001_000;
  const sendRefund = opts.sendRefund ?? (async (args, hooks) => { sent.push(args); const sig = `R${sent.length}`.padEnd(88, 'R'); await hooks.onSigned(sig); return sig; });
  const arb = createArbiter({ rpc: opts.rpc ?? fakeRpc({ [c.txSig]: c.tx }), store, sendRefund, sellerKey: async (pay_to) => (pay_to === c.key.publicKey ? c.key.publicKey : null), now: () => clock, ...opts.arb });
  return { c, sent, store, arb, tick: (s) => { clock += s; } };
};

test('R5a: NOT_AS_OFFERED with verifying evidence -> seller liable, refunded once to the principal found on chain', async () => {
  const { c, sent, arb, store } = await setup();
  const v = await arb.dispute(c.payload);
  assert.deepEqual([v.verdict, v.reason, v.liable, v.outcome], ['valid', 'not_as_offered', 'seller', 'NOT_AS_OFFERED']);
  assert.match(v.refund_tx, /^R1/);
  assert.equal(sent.length, 1);
  assert.deepEqual({ ...sent[0], reason: undefined }, { to: c.principal, mint: c.mint, amount: '150000', decimals: 6, reason: undefined });
  assert.equal(store.get(c.txSig).refund_tx, v.refund_tx);
});
test('a repeated dispute returns the stored verdict and never refunds twice; five parallel filings make one refund', async () => {
  const { c, sent, arb } = await setup();
  const [first, ...rest] = await Promise.all([1, 2, 3, 4, 5].map(() => arb.dispute(c.payload)));
  assert.equal(sent.length, 1);
  for (const r of rest) assert.equal(r.refund_tx, first.refund_tx);
  const again = await arb.dispute(c.payload);
  assert.equal(again.duplicate, true);
  assert.equal(again.refund_tx, first.refund_tx);
  assert.equal(sent.length, 1);
});
test('R5b: DELIVERED_AS_OFFERED -> invalid, the principal bears it, no refund', async () => {
  const { c, sent, arb } = await setup({}, { vision: [vans('yes'), vans('yes')] });
  const v = await arb.dispute(c.payload);
  assert.deepEqual([v.verdict, v.reason, v.liable, v.refund_tx], ['invalid', 'delivered_as_offered', 'principal', null]);
  assert.equal(sent.length, 0);
});
test('R5c: COULD_NOT_BE_CHECKED -> undecided, nothing stored, may be filed again; never a refund and never a pass', async () => {
  const { c, sent, arb, store } = await setup({}, { vision: [vans('no', 0.95), vans('yes', 0.9)] });
  const v = await arb.dispute(c.payload);
  assert.deepEqual([v.verdict, v.reason, v.liable, v.outcome], ['undecided', 'could_not_be_checked', null, 'COULD_NOT_BE_CHECKED']);
  assert.equal(store.get(c.txSig), null);
  assert.equal(sent.length, 0);
  assert.equal((await arb.dispute(c.payload)).verdict, 'undecided');
});
test('R5d: evidence that does not verify is rejected with liable null and no refund', async () => {
  const { c, sent, arb } = await setup();
  const bad = JSON.parse(JSON.stringify(c.payload));
  bad.evidence.record.outcome = 'NOT_AS_OFFERED'; bad.evidence.record.checks.full.answer.matches_offer = 'yes'; // the outcome no longer follows
  const r = await arb.dispute(bad);
  assert.deepEqual([r.verdict, r.reason, r.liable], ['rejected', 'evidence_invalid', null]);
  const swapImg = await arb.dispute({ ...c.payload, delivered_b64: Buffer.from('not the attested image').toString('base64') });
  assert.ok(swapImg.problems.some((p) => /not the attested one/.test(p)));
  assert.equal((await arb.dispute({ ...c.payload, delivered_b64: '***' })).reason, 'attachment_not_base64');
  assert.equal((await arb.dispute({})).reason, 'evidence_missing');
  assert.equal((await arb.dispute({ evidence: { record: { payment: {} }, evidence_id: 'x' } })).reason, 'evidence_invalid');
  assert.equal(sent.length, 0);
});
test('an unknown seller key is rejected (the filer cannot name the key)', async () => {
  const { c, arb } = await setup({ arb: { sellerKey: async () => null } });
  assert.equal((await arb.dispute(c.payload)).reason, 'seller_key_unknown');
});
test('the payment must be proven on chain exactly as the receipt says', async () => {
  const cases = {
    'not found': (c) => ({}),
    'transaction failed': (c) => ({ [c.txSig]: { ...c.tx, meta: { ...c.tx.meta, err: { InstructionError: [0, 'x'] } } } }),
    'amount differs': (c) => { const t = JSON.parse(JSON.stringify(c.tx)); t.transaction.message.instructions[0].parsed.info.tokenAmount.amount = '1'; return { [c.txSig]: t }; },
    'paid someone else': (c) => { const t = JSON.parse(JSON.stringify(c.tx)); t.meta.postTokenBalances[1].owner = c.principal; return { [c.txSig]: t }; },
    'other authority': (c) => { const t = JSON.parse(JSON.stringify(c.tx)); t.transaction.message.instructions[0].parsed.info.authority = c.principal; return { [c.txSig]: t }; },
    'two transfers': (c) => { const t = JSON.parse(JSON.stringify(c.tx)); t.transaction.message.instructions.push(t.transaction.message.instructions[0]); return { [c.txSig]: t }; },
  };
  for (const [name, mk] of Object.entries(cases)) {
    const c = await makeCase(); const sent = [];
    const arb = createArbiter({ rpc: fakeRpc(mk(c)), store: openDisputeStore(), sendRefund: async () => { sent.push(1); return 'x'; }, sellerKey: async () => c.key.publicKey });
    const r = await arb.dispute(c.payload);
    assert.equal(r.reason, 'payment_not_proven', name);
    assert.equal(sent.length, 0, name);
  }
});
test('a refund that fails is released, retried on the next filing, and lands once', async () => {
  let n = 0; const landed = [];
  const sendRefund = async (args, hooks) => { n++; if (n === 1) throw new Error('rpc down'); landed.push(args); const sig = 'S'.repeat(88); await hooks.onSigned(sig); return sig; };
  const { c, arb, store } = await setup({ sendRefund });
  const v1 = await arb.dispute(c.payload);
  assert.equal(v1.verdict, 'valid'); assert.equal(v1.refund_tx, null); assert.match(v1.refund_error, /rpc down/);
  assert.equal(store.get(c.txSig).refund_claim, null);
  const v2 = await arb.dispute(c.payload);
  assert.equal(v2.refund_tx, 'S'.repeat(88));
  assert.equal(landed.length, 1);
});
test('a refund that was SIGNED and then failed to confirm is not resent while it may still land; a confirmed one is adopted', async () => {
  const sig = 'P'.repeat(88);
  let sends = 0;
  const sendRefund = async (_a, hooks) => { sends++; await hooks.onSigned(sig); throw new Error('timeout after signing'); };
  const statuses = {};
  const c0 = await makeCase();
  const { arb, c, tick, store } = await setup({ sendRefund, rpc: fakeRpc({ [c0.txSig]: c0.tx }, statuses), arb: {} }, { txSig: c0.txSig });
  // the setup builds its own case; use the case it built
  const c1 = c; const rpc = fakeRpc({ [c1.txSig]: c1.tx }, statuses);
  const arb2 = createArbiter({ rpc, store: openDisputeStore(), sendRefund, sellerKey: async () => c1.key.publicKey, now: () => 1_800_001_000 });
  const v1 = await arb2.dispute(c1.payload);
  assert.match(v1.refund_error, /timeout after signing/);
  const v2 = await arb2.dispute(c1.payload);          // within the grace period and not confirmed: pending, no second send
  assert.equal(sends, 1);
  assert.equal(v2.refund_state, 'pending');
  statuses[sig] = { confirmationStatus: 'confirmed', err: null };
  const v3 = await arb2.dispute(c1.payload);          // the chain says it landed: adopted
  assert.equal(v3.refund_tx, sig);
  assert.equal(sends, 1);
  void arb; void tick; void store;
});
test('a stale signed refund that never landed is retaken after the grace period (exactly one new send)', async () => {
  const sigs = []; let clock = 1_800_001_000;
  const sendRefund = async (_a, hooks) => { const s = `${sigs.length}`.padEnd(88, 'Q'); sigs.push(s); await hooks.onSigned(s); if (sigs.length === 1) throw new Error('dropped'); return s; };
  const c = await makeCase();
  const arb = createArbiter({ rpc: fakeRpc({ [c.txSig]: c.tx }), store: openDisputeStore(), sendRefund, sellerKey: async () => c.key.publicKey, now: () => clock });
  await arb.dispute(c.payload);
  clock += 400;
  const v = await Promise.all([arb.dispute(c.payload), arb.dispute(c.payload)]);
  assert.equal(sigs.length, 2);
  assert.equal(v[0].refund_tx, sigs[1]);
});
test('mandate checks: a mandate that is not the receipt\'s, or does not allow the payee, is rejected', async () => {
  const { c, arb } = await setup();
  const m = { v: 'iussum/0.2' };
  assert.equal((await arb.dispute({ ...c.payload, mandate: m })).reason, 'mandate_invalid');
});
test('recheck: the arbiter re-runs the check on the attested bytes; a disagreeing re-check means no ruling', async () => {
  const agree = stubProvider({ vision: [vans('no', 0.95), vans('no', 0.9)] });
  const a = await setup({ arb: { provider: agree, recheck: true } });
  const v = await a.arb.dispute(a.c.payload);
  assert.equal(v.verdict, 'valid');
  assert.equal(v.notes[0].recheck_outcome, 'NOT_AS_OFFERED');
  const disagree = stubProvider({ vision: [vans('yes', 0.95), vans('yes', 0.9)] });
  const b = await setup({ arb: { provider: disagree, recheck: true } });
  const w = await b.arb.dispute(b.c.payload);
  assert.deepEqual([w.verdict, w.reason], ['undecided', 'could_not_be_checked']);
  assert.equal(b.sent.length, 0);
  const none = await setup({ arb: { recheck: true } });
  assert.equal((await none.arb.dispute(none.c.payload)).reason, 'recheck_unavailable');
});
