// The delivery arbiter: NEW rule R5 on top of the prior iussum components. The prior resolver (apps/resolver) rules on whether a payment was IN SCOPE of the mandate;
// a payment that was in scope but bought the wrong thing is, by its rules, the principal's loss (R1). R5 covers exactly that gap, and only with evidence it can verify:
//   R5a  the delivery was NOT_AS_OFFERED, the evidence record verifies (shop-signed receipt and delivery attestation, hashes, rule re-applied to the recorded checks)
//        and the payment is proven on chain      -> valid, the SELLER is liable, the payment is refunded once.
//   R5b  DELIVERED_AS_OFFERED                    -> invalid, no refund (the principal bears it).
//   R5c  COULD_NOT_BE_CHECKED                    -> undecided, no ruling, no refund; it may be filed again with a new check.
//   R5d  anything that does not verify           -> rejected, liable null.
// Reused from the prior repo as libraries: @iussum/core (verifyReceipt, parsePayment, mandate validation) and @iussum/resolver's makeRefundSender (the refund transaction).
// As in the prior demo, the refund is paid from a float wallet that stands in for the seller's own refund key; this is a devnet demo simplification, not a production design.
import { randomUUID } from 'node:crypto';
import { parsePayment, validateMandate, mandateId, canonicalize, sha256Hex } from '@iussum/core';
import { verifyEvidence } from '../evidence/record.js';
import { runDeliveryCheck } from '../evidence/check.js';

const PENDING_GRACE_S = 150;
const isB64 = (s) => typeof s === 'string' && s.length > 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(s);
const rejected = (reason, problems = []) => ({ verdict: 'rejected', reason, liable: null, problems, refund_tx: null });

// cfg: { rpc, store, sendRefund|null, sellerKey: async (pay_to) => base58 pubkey | null, provider|null (arbiter's own re-check), recheck, allowFixture, now }
export function createArbiter({ rpc, store, sendRefund = null, sellerKey, provider = null, recheck = false, allowFixture = false, now = () => Math.floor(Date.now() / 1000) }) {
  const inflight = new Map();

  async function payRefund(tx_sig) {
    const row = store.get(tx_sig);
    if (!row || row.verdict !== 'valid') throw new Error('no seller-liable verdict stored for this payment');
    if (row.refund_tx) return { refund_tx: row.refund_tx };
    if (!sendRefund) return { refund_tx: null, refund_state: 'no_refund_sender' };
    let over = null;
    if (row.refund_pending) {
      if (!row.refund_pending.startsWith('claim:')) { // a signed refund: ask the chain before anything else
        const st = (await rpc.call('getSignatureStatuses', [[row.refund_pending], { searchTransactionHistory: true }])).value[0];
        if (st && !st.err && ['confirmed', 'finalized'].includes(st.confirmationStatus)) { store.setRefund(tx_sig, row.refund_pending); return { refund_tx: row.refund_pending }; }
      }
      if (now() - (row.refund_pending_at ?? 0) < PENDING_GRACE_S) return { refund_tx: null, refund_state: 'pending' };
      over = row.refund_pending;
    }
    const token = randomUUID();
    if (!store.claimRefund(tx_sig, token, now(), over)) { const cur = store.get(tx_sig); return cur.refund_tx ? { refund_tx: cur.refund_tx } : { refund_tx: null, refund_state: 'pending' }; }
    let sig;
    try {
      sig = await sendRefund({ to: row.refund_to, mint: row.refund_mint, amount: row.refund_amount, decimals: row.refund_decimals, reason: `delivery dispute ${tx_sig}` }, { onSigned: (p) => { if (!store.signRefund(tx_sig, token, p, now())) throw new Error('lost the refund claim before signing'); } });
    } catch (e) { store.releaseClaim(tx_sig, token); throw e; } // a claim that never signed goes back; a signed one stays as the signature
    store.setRefund(tx_sig, sig);
    return { refund_tx: sig };
  }

  const out = (row, extra = {}) => ({ verdict: row.verdict, reason: row.reason, liable: row.liable, outcome: row.outcome, evidence_id: row.evidence_id, tx_sig: row.tx_sig, refund_tx: row.refund_tx ?? null, refund_amount: row.refund_amount, ...extra });

  async function decide(body) {
    const { evidence, overlay_png_b64 = null, delivered_b64 = null, mandate = null } = body ?? {};
    if (!evidence?.record || typeof evidence.evidence_id !== 'string') return rejected('evidence_missing');
    if (delivered_b64 !== null && !isB64(delivered_b64)) return rejected('attachment_not_base64', ['delivered_b64']);
    if (overlay_png_b64 !== null && !isB64(overlay_png_b64)) return rejected('attachment_not_base64', ['overlay_png_b64']);
    const { record } = evidence, receipt = record.payment?.receipt;
    if (!receipt?.tx_sig) return rejected('evidence_invalid', ['no receipt in the record']);
    const tx_sig = receipt.tx_sig;

    const stored = store.get(tx_sig);
    if (stored) { // duplicate: the stored verdict, and a refund that failed after the verdict is retried idempotently
      let extra = { duplicate: true };
      if (stored.verdict === 'valid' && !stored.refund_tx) { try { extra = { ...extra, ...(await payRefund(tx_sig)) }; } catch (e) { extra.refund_error = e.message; } }
      return out(store.get(tx_sig), extra);
    }

    const key = await sellerKey(receipt.pay_to);
    if (!key) return rejected('seller_key_unknown');
    const delivered = delivered_b64 ? Buffer.from(delivered_b64, 'base64') : null;
    const overlay = overlay_png_b64 ? Buffer.from(overlay_png_b64, 'base64') : null;
    const v = await verifyEvidence(evidence, { shopKey: key, overlayPng: overlay, deliveredBytes: delivered, allowFixture });
    if (!v.ok) return rejected('evidence_invalid', v.problems);
    if (mandate) {
      const errs = validateMandate(mandate);
      if (errs.length) return rejected('mandate_invalid', errs);
      if (mandateId(mandate) !== receipt.mandate_id) return rejected('mandate_mismatch', ['the mandate is not the one the receipt carries']);
      if (!mandate.allow.pay_to.includes(receipt.pay_to)) return rejected('mandate_mismatch', ['the receipt names a payee the mandate does not allow']);
    }

    // the payment must be on chain exactly as the receipt says; the refund details come from the chain, never from the filer
    let payment;
    try { payment = parsePayment(await rpc.getTransaction(tx_sig)); } catch (e) { return rejected('chain_unreachable', [e.message]); }
    const t = payment.found && !payment.err && payment.transfers.length === 1 ? payment.transfers[0] : null;
    if (!t) return rejected('payment_not_proven', [payment.found ? (payment.err ? 'the transaction failed' : 'not exactly one TransferChecked') : 'transaction not found']);
    const mism = [];
    if (t.amount !== receipt.amount) mism.push(`amount ${t.amount} != receipt ${receipt.amount}`);
    if (t.dest_owner !== receipt.pay_to) mism.push(`paid ${t.dest_owner}, receipt says ${receipt.pay_to}`);
    if (t.mint !== receipt.asset) mism.push('mint differs from the receipt');
    if (t.authority !== receipt.payer) mism.push('transfer authority differs from the receipt payer');
    if (!t.source_owner) mism.push('the principal (source owner) is not readable from the transaction');
    if (mismatches(mism)) return rejected('payment_not_proven', mism);

    let outcome = v.outcome, notes = [], rc = null;
    if (recheck) { // the arbiter looks at the shop-attested bytes itself, with its own model calls
      if (!provider || !delivered) return rejected('recheck_unavailable', ['recheck needs a provider and the delivered image attached']);
      const t0 = Date.now();
      const run = await runDeliveryCheck({ provider, image: delivered, offer: record.offer, spec: record.spec, thresholds: record.rule.thresholds });
      const cost = [run.checks.seg, run.checks.full, run.checks.crop, run.checks.observed].reduce((a, c) => a + (c?.model?.cost_usd ?? 0), 0);
      // what the re-run cost and whether it agreed with the filer's outcome: kept on the verdict so the agreement rate can be measured
      rc = { agreed: run.rule.outcome === outcome, filed_outcome: outcome, recheck_outcome: run.rule.outcome, recheck_code: run.rule.code, recheck_reasons: run.rule.reasons, ms: Date.now() - t0, model_cost_usd: Number(cost.toFixed(6)), checks: { segment: run.checks.seg?.error ? 'error' : `${run.checks.seg.instances.length} found`, full: run.checks.full?.answer ? `${run.checks.full.answer.matches_offer} ${run.checks.full.answer.confidence}` : 'error', crop: run.checks.crop?.answer ? `${run.checks.crop.answer.matches_offer} ${run.checks.crop.answer.confidence}` : (run.checks.crop ? 'error' : 'not run') } };
      notes.push({ recheck_outcome: run.rule.outcome, recheck_code: run.rule.code });
      if (run.rule.outcome !== outcome) outcome = 'COULD_NOT_BE_CHECKED';
    }
    const base = { tx_sig, evidence_id: evidence.evidence_id, outcome, record_json: canonicalize(record), created_at: now() };
    if (outcome === 'COULD_NOT_BE_CHECKED') return { verdict: 'undecided', reason: 'could_not_be_checked', liable: null, outcome, evidence_id: evidence.evidence_id, tx_sig, refund_tx: null, notes, recheck: rc };
    if (outcome === 'DELIVERED_AS_OFFERED') {
      store.insert({ ...base, verdict: 'invalid', reason: 'delivered_as_offered', liable: 'principal' });
      return out(store.get(tx_sig), { notes, recheck: rc });
    }
    const fresh = store.insert({ ...base, verdict: 'valid', reason: 'not_as_offered', liable: 'seller', refund_to: t.source_owner, refund_amount: t.amount, refund_mint: t.mint, refund_decimals: t.decimals });
    let extra = { duplicate: !fresh, notes, recheck: rc };
    try { extra = { ...extra, ...(await payRefund(tx_sig)) }; } catch (e) { extra.refund_error = e.message; }
    return out(store.get(tx_sig), extra);
  }
  const mismatches = (m) => m.length > 0;

  return {
    // One dispute per payment at a time: concurrent filings for the same tx_sig share one decision (and so one refund).
    async dispute(body) {
      const tx = body?.evidence?.record?.payment?.receipt?.tx_sig;
      if (typeof tx !== 'string') return decide(body);
      if (inflight.has(tx)) return inflight.get(tx);
      const p = decide(body).finally(() => inflight.delete(tx));
      inflight.set(tx, p);
      return p;
    },
    stored: (tx) => store.get(tx),
    payRefund,
  };
}
export const verdictId = (v) => sha256Hex(canonicalize({ tx_sig: v.tx_sig, evidence_id: v.evidence_id, verdict: v.verdict, reason: v.reason, liable: v.liable }));
