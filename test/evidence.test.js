import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { receiptKey, signReceipt, offerHash } from '@iussum/core';
import { applyRule, THRESHOLDS, OUTCOMES } from '../src/evidence/rule.js';
import { makeOverlay, cropBox, boxInImage } from '../src/evidence/overlay.js';
import { runDeliveryCheck } from '../src/evidence/check.js';
import { buildEvidence, verifyEvidence } from '../src/evidence/record.js';
import { signDelivery, contentSha256 } from '../src/shops/attest.js';
import { readSamResult } from '../models/adapters/meta.js';
import { syntheticPng } from './helpers.js';

const SAM_SAMPLE = '<0f>0<|box;x1=211;y1=228;x2=270;y2=254;w=320;h=334|>' + "<|mask;x=0;y=0;data=27,60,~!!!!M!0c[0o91w?q1!pIH4pPRVp2B3'7`e.ioeAf6-k/#Xd8%dX9x(|>" + ',1<|box;x1=155;y1=228;x2=202;y2=254;w=320;h=334|>' + '<|mask;x=0;y=0;data=27,48,~!!!!J!0c[q=Pj_zs=*4C4(/./x#:/`S_GnD`=o3?X{emCgO$y@|>\n';
const sha = (b) => createHash('sha256').update(b).digest('hex');

const ans = (matches_offer, confidence = 0.9, violates_must_not = false) => ({ answer: { observed_object: 'x', observed_colour: null, observed_material: null, matches_offer, violates_must_not, confidence, reason: 'r' } });
const inst = (confidence = 0.9) => ({ instances: [{ id: '0', confidence }] });

test('rule: the full table', () => {
  const R = (seg, full, crop = null) => applyRule({ seg, full, crop }).outcome;
  const D = 'DELIVERED_AS_OFFERED', N = 'NOT_AS_OFFERED', C = 'COULD_NOT_BE_CHECKED';
  assert.equal(R(inst(), ans('yes'), ans('yes')), D);
  assert.equal(R(inst(), ans('yes'), null), D);
  assert.equal(R({ instances: [] }, ans('no')), N);
  assert.equal(R(inst(), ans('no'), ans('no')), N);
  assert.equal(R(inst(), ans('yes'), ans('no')), C);          // crop disagrees with the full image
  assert.equal(R(inst(), ans('no'), ans('yes')), C);          // SAM found it and the crop is fine: models disagree
  assert.equal(R({ instances: [] }, ans('yes')), C);         // vision says yes but nothing segmented
  assert.equal(R(inst(), ans('unsure')), C);
  assert.equal(R(inst(), ans('yes', 0.69), ans('yes')), C);  // below the vision threshold
  assert.equal(R(inst(), ans('yes', 0.7), ans('yes')), D);   // at the threshold
  assert.equal(R({ instances: [] }, ans('no', 0.5)), C);
  assert.equal(R(inst(0.49), ans('yes'), ans('yes')), C);    // below the SAM threshold counts as not found
  assert.equal(R(inst(0.49), ans('no')), N);
  assert.equal(R(inst(null), ans('yes'), ans('yes')), D);    // a missing confidence is accepted, never read as zero
  assert.equal(R(inst(), ans('yes', 0.95, true), ans('yes', 0.95, true)), N); // says yes but violates must_not: counts as no, and the crop says the same
  assert.equal(R(inst(), ans('yes', 0.95, true), ans('yes')), C);             // the crop sees no violation: the checks disagree
  assert.equal(R({ instances: [] }, ans('yes', 0.95, true)), N);               // must_not violation and no object: not as offered
  // errors never become a pass or a fail
  for (const [s, f, c] of [[{ error: 'x' }, ans('yes'), null], [inst(), { error: 'x' }, null], [inst(), ans('yes'), { error: 'x' }], [{ error: 'x' }, { error: 'y' }, null]]) {
    const r = applyRule({ seg: s, full: f, crop: c });
    assert.equal(r.outcome, C); assert.equal(r.code, 'check_error');
  }
  assert.deepEqual(OUTCOMES, [D, N, C]);
});

test('overlay: tints the mask, keeps the size, draws a red frame when nothing was found', async () => {
  const img = await syntheticPng('red-mug');
  const seg = await readSamResult(SAM_SAMPLE);
  const o = await makeOverlay(img, { instance: seg.instances[0], frame: seg.frame });
  const meta = await sharp(o.png).metadata();
  assert.deepEqual([meta.width, meta.height], [256, 256]);
  assert.notEqual(sha(o.png), sha(img));
  const none = await makeOverlay(img, { instance: null });
  const px = await sharp(none.png).extract({ left: 0, top: 0, width: 1, height: 1 }).raw().toBuffer();
  assert.ok(px[0] > 150 && px[1] < 60, 'top-left pixel is the red frame');
  assert.equal(none.drawn, 'none');
  assert.deepEqual(boxInImage({ x1: 160, y1: 167, x2: 320, y2: 334 }, { w: 320, h: 334 }, { w: 256, h: 256 }), { x1: 128, y1: 128, x2: 256, y2: 256 });
  const crop = await cropBox(img, { instance: { box: { x1: 80, y1: 90, x2: 170, y2: 190 } }, frame: { w: 256, h: 256 } });
  const cm = await sharp(crop).metadata();
  assert.ok(cm.width >= 90 && cm.width < 120 && cm.height >= 100 && cm.height < 130);
});

// ---- a provider stub with scripted answers; provider tag 'meta' so evidence verification re-parses the raw output
const stub = ({ seg, vision, tag = 'meta' }) => ({
  segment: async () => { if (seg instanceof Error) throw seg; const r = await readSamResult(seg); return { value: r, meta: { provider: tag, model: 'sam-3.1', latencyMs: 1, costUsd: 0.0025 } }; },
  vision: async (_i, _q, o) => { const v = vision.shift(); if (v instanceof Error) throw v; assert.ok(o.schema && o.system); return { value: v, meta: { provider: tag, model: 'muse-spark-1.3', latencyMs: 1, costUsd: 0.001 } }; },
});
const v = (matches_offer, confidence = 0.9, extra = {}) => ({ observed_object: 'mug', observed_colour: 'red', observed_material: 'ceramic', matches_offer, violates_must_not: false, confidence, reason: 'r', ...extra });
const offer = { shop: 'mugworks', sku: 'mug-front', title: 'Red ceramic mug, front view', description: 'Photo of a glossy red ceramic coffee mug.' };
const spec = { noun_phrase: 'red ceramic mug', must_not: [] };

test('runDeliveryCheck: honest delivery, swapped delivery, disagreement, and failures', async () => {
  const img = await syntheticPng('red-mug');
  const ok = await runDeliveryCheck({ provider: stub({ seg: SAM_SAMPLE, vision: [v('yes'), v('yes')] }), image: img, offer, spec });
  assert.equal(ok.rule.outcome, 'DELIVERED_AS_OFFERED');
  assert.ok(ok.crop_png && ok.overlay_png);
  const bad = await runDeliveryCheck({ provider: stub({ seg: SAM_SAMPLE, vision: [v('no', 0.95, { observed_object: 'drinking glass' }), v('no', 0.9)] }), image: img, offer, spec });
  assert.equal(bad.rule.outcome, 'NOT_AS_OFFERED');
  const none = await runDeliveryCheck({ provider: stub({ seg: '', vision: [v('no', 0.95)] }), image: img, offer, spec });
  assert.equal(none.rule.outcome, 'NOT_AS_OFFERED');
  assert.equal(none.checks.crop, null);
  const dis = await runDeliveryCheck({ provider: stub({ seg: SAM_SAMPLE, vision: [v('no', 0.95), v('yes', 0.9)] }), image: img, offer, spec });
  assert.equal(dis.rule.outcome, 'COULD_NOT_BE_CHECKED');
  assert.equal(dis.rule.code, 'models_disagree');
  const segFail = await runDeliveryCheck({ provider: stub({ seg: Object.assign(new Error('503'), { kind: 'http' }), vision: [v('yes')] }), image: img, offer, spec });
  assert.equal(segFail.rule.outcome, 'COULD_NOT_BE_CHECKED');
  assert.match(segFail.checks.seg.error, /http/);
  const visionFail = await runDeliveryCheck({ provider: stub({ seg: SAM_SAMPLE, vision: [Object.assign(new Error('boom'), { kind: 'timeout' })] }), image: img, offer, spec });
  assert.equal(visionFail.rule.outcome, 'COULD_NOT_BE_CHECKED');
  const badShape = await runDeliveryCheck({ provider: stub({ seg: SAM_SAMPLE, vision: [{ matches_offer: 'yes' }, v('yes')] }), image: img, offer, spec });
  assert.equal(badShape.rule.outcome, 'COULD_NOT_BE_CHECKED');
  assert.match(badShape.checks.full.error, /schema/);
  const unknownAnswer = await runDeliveryCheck({ provider: stub({ seg: SAM_SAMPLE, vision: [v('maybe'), v('yes')] }), image: img, offer, spec });
  assert.equal(unknownAnswer.rule.outcome, 'COULD_NOT_BE_CHECKED');
});

// ---- evidence record end to end with real signatures
async function makeCase(over = {}) {
  const key = receiptKey();
  const img = await syntheticPng('glass');
  const url = 'https://meta.example/shops/mugworks/v1/photo/mug-front';
  const accepted = { scheme: 'exact', network: 'solana:x', amount: '150000' };
  const receipt = signReceipt({ v: 'iussum/0.2', mandate_id: 'a'.repeat(64), grant_tx: 'G'.repeat(88), offer_hash: offerHash(accepted), resource: url, pay_to: key.publicKey, asset: key.publicKey, network: 'solana:x', amount: '150000', payer: key.publicKey, tx_sig: 'T'.repeat(88), settled_at: 1_800_000_100, seller: key.publicKey }, key);
  const attestation = signDelivery({ shop: key.publicKey, resource: url, sku: 'mug-front', content_sha256: contentSha256(img), content_type: 'image/png', delivered_at: 1_800_000_099, payer: key.publicKey, offer_hash: offerHash(accepted), ...over }, key);
  const run = await runDeliveryCheck({ provider: stub({ seg: SAM_SAMPLE, vision: [v('no', 0.95), v('no', 0.9)] }), image: img, offer, spec });
  const ev = buildEvidence({ receipt, mandate_id: receipt.mandate_id, grant_tx: receipt.grant_tx, offer, spec, delivery: { bytes: img, attestation }, run, now: 1_800_000_200 });
  return { key, img, run, ev, receipt, attestation };
}
const clone = (x) => JSON.parse(JSON.stringify(x));

test('evidence: a pristine record verifies and its outcome is recomputed', async () => {
  const { key, ev, img, run } = await makeCase();
  const r = await verifyEvidence(ev, { shopKey: key.publicKey, overlayPng: run.overlay_png, deliveredBytes: img });
  assert.deepEqual(r.problems, []);
  assert.equal(r.ok, true);
  assert.equal(r.outcome, 'NOT_AS_OFFERED');
  assert.match(ev.evidence_id, /^[0-9a-f]{64}$/);
});
test('evidence: every tamper is caught, each for its own reason', async () => {
  const { key, ev, img, run } = await makeCase();
  const verify = (mutate, extra = {}) => { const e = clone(ev); mutate(e.record); return verifyEvidence(e, { shopKey: key.publicKey, ...extra }); };
  const has = async (p, re) => { const r = await p; assert.equal(r.ok, false); assert.ok(r.problems.some((x) => re.test(x)), `${re}: ${r.problems.join(' | ')}`); };
  await has(verify((r) => { r.outcome = 'DELIVERED_AS_OFFERED'; }), /does not follow from the recorded checks/);
  await has(verify((r) => { r.checks.full.answer.matches_offer = 'yes'; }), /evidence_id does not match/);
  const forged = clone(ev); forged.record.outcome = 'DELIVERED_AS_OFFERED'; forged.evidence_id = (await import('@iussum/core')).sha256Hex((await import('@iussum/core')).canonicalize(forged.record));
  await has(verifyEvidence(forged, { shopKey: key.publicKey }), /does not follow from the recorded checks/); // even with a re-computed id the outcome must follow
  await has(verify((r) => { r.payment.receipt.amount = '1'; }), /receipt/);
  await has(verify((r) => { r.delivery.attestation.content_sha256 = 'b'.repeat(64); }), /delivery attestation/);
  await has(verify((r) => { r.payment.tx_sig = 'X'.repeat(88); }), /tx_sig differs/);
  await has(verify((r) => { r.checks.seg.instances[0].confidence = 0.99; }), /instances differ/);
  await has(verify(() => {}, { deliveredBytes: Buffer.from('another image') }), /not the attested one/);
  await has(verify(() => {}, { overlayPng: Buffer.from('another overlay') }), /overlay does not match/);
  await has(verify((r) => { r.checks.full.model.provider = 'fixture'; }), /fixture adapter/);
  await has(verify((r) => { r.checks.seg.image_sha256 = 'c'.repeat(64); }), /ran on other bytes/);
  await has(verifyEvidence(ev, { shopKey: receiptKey().publicKey }), /receipt: receipt names another seller key|delivery attestation/);
  const okFixture = await verifyEvidence((() => { const e = clone(ev); return e; })(), { shopKey: key.publicKey, deliveredBytes: img, overlayPng: run.overlay_png });
  assert.equal(okFixture.ok, true); // negative control for the loop above
});
test('evidence: attestation and receipt that disagree about resource, payer, offer, sku or timing are refused', async () => {
  for (const [over, re] of [[{ resource: 'https://meta.example/shops/mugworks/v1/photo/mug-top' }, /different resources/], [{ offer_hash: 'd'.repeat(64) }, /different offers/], [{ sku: 'mug-top' }, /sku differs/], [{ delivered_at: 1_800_009_999 }, /10 minutes apart/]]) {
    const { key, ev } = await makeCase(over);
    const r = await verifyEvidence(ev, { shopKey: key.publicKey });
    assert.ok(r.problems.some((x) => re.test(x)), `${JSON.stringify(over)}: ${r.problems.join(' | ')}`);
  }
  const { key, ev } = await makeCase({ payer: receiptKey().publicKey });
  assert.ok((await verifyEvidence(ev, { shopKey: key.publicKey })).problems.some((x) => /different payers/.test(x)));
});
test('evidence: a record built from fixture answers is refused unless fixtures are explicitly allowed', async () => {
  const key = receiptKey(), img = await syntheticPng('glass');
  const run = await runDeliveryCheck({ provider: stub({ seg: SAM_SAMPLE, vision: [v('no', 0.95), v('no', 0.9)], tag: 'fixture' }), image: img, offer, spec });
  const url = 'https://meta.example/shops/mugworks/v1/photo/mug-front';
  const receipt = signReceipt({ v: 'iussum/0.2', mandate_id: null, grant_tx: null, offer_hash: 'a'.repeat(64), resource: url, pay_to: key.publicKey, asset: key.publicKey, network: 'n', amount: '1', payer: key.publicKey, tx_sig: 'T'.repeat(88), settled_at: 5, seller: key.publicKey }, key);
  const attestation = signDelivery({ shop: key.publicKey, resource: url, sku: 'mug-front', content_sha256: contentSha256(img), content_type: 'image/png', delivered_at: 5, payer: key.publicKey, offer_hash: 'a'.repeat(64) }, key);
  const ev = buildEvidence({ receipt, mandate_id: null, grant_tx: null, offer, spec, delivery: { bytes: img, attestation }, run, now: 6 });
  assert.ok((await verifyEvidence(ev, { shopKey: key.publicKey })).problems.some((x) => /fixture adapter/.test(x)));
  assert.equal((await verifyEvidence(ev, { shopKey: key.publicKey, allowFixture: true })).ok, true);
});
