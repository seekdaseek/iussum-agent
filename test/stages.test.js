import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { runDeliveryCheck } from '../src/evidence/check.js';
import { buildEvidence, verifyEvidence } from '../src/evidence/record.js';
import { applyRule } from '../src/evidence/rule.js';
import { createGroundSamAdapter, segmentationHint } from '../models/adapters/groundsam.js';
import { createModalAdapter } from '../models/adapters/modal.js';
import { createBasetenAdapter } from '../models/adapters/baseten.js';
import { createProvider } from '../models/provider.js';
import { CostLedger } from '../models/cost.js';
import { ProviderError } from '../models/errors.js';
import { receiptKey, signReceipt, offerHash } from '@iussum/core';
import { signDelivery, contentSha256 } from '../src/shops/attest.js';
import { makeDevProvider } from '../src/web/dev-stubs.js';
import { syntheticPng } from './helpers.js';

const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
const fakeFetch = (...answers) => { const calls = []; const f = async (url, init) => { calls.push({ url, body: typeof init.body === 'string' ? JSON.parse(init.body) : init.body }); const a = answers.shift(); if (a instanceof Error) throw a; return typeof a === 'function' ? a() : a; }; f.calls = calls; return f; };
const vis = (m, c = 0.97) => ({ observed_object: 'clear glass tumbler', observed_colour: null, observed_material: 'glass', matches_offer: m, violates_must_not: false, confidence: c, reason: 'r' });
const offer = { shop: 'mugworks', sku: 'mug-1', title: 'Red ceramic mug', description: 'd' }, spec = { noun_phrase: 'red ceramic mug', must_not: [] };

test('a failing segmentation service (no credit, token refused, 5xx, timeout, unreachable) is COULD_NOT_BE_CHECKED with the reason, never a pass or an accusation', async () => {
  const img = await syntheticPng('glass');
  const cases = [
    [new ProviderError('http', 'HTTP 402: payment required', { provider: 'baseten+modal', job: 'segment', status: 402 }), /no credit left or is rate limited/],
    [new ProviderError('http', 'HTTP 429: too many', { provider: 'baseten+modal', job: 'segment', status: 429 }), /no credit left or is rate limited/],
    [new ProviderError('http', 'HTTP 401', { provider: 'baseten+modal', job: 'segment', status: 401 }), /refused our token/],
    [new ProviderError('http', 'HTTP 503', { provider: 'baseten+modal', job: 'segment', status: 503 }), /segmentation service failed/],
    [new ProviderError('timeout', 'aborted', { provider: 'baseten+modal', job: 'segment' }), /did not answer in time \(it may still be starting up\)/],
    [new ProviderError('network', 'ECONNREFUSED', { provider: 'baseten+modal', job: 'segment' }), /could not be reached/],
  ];
  for (const [err, re] of cases) {
    const stages = [];
    const provider = { segment: async () => { throw err; }, vision: async () => ({ value: vis('no'), meta: { provider: 'baseten', model: 'm' } }) };
    const run = await runDeliveryCheck({ provider, image: img, offer, spec, onStage: (s) => stages.push(s) });
    assert.equal(run.rule.outcome, 'COULD_NOT_BE_CHECKED', String(err.message)); assert.equal(run.rule.code, 'check_error');
    assert.match(run.rule.reasons.join(' '), re); assert.match(run.rule.reasons.join(' '), new RegExp(String(err.status ?? err.kind)));
    assert.deepEqual(stages, ['segmenting', 'judging']);
    assert.equal(run.checks.observed, undefined); // no "what is there" lookup after a failure
    // the record carries the failure and still verifies; the outcome follows from it
    const key = receiptKey(), url = 'https://m.example/shops/mugworks/v1/photo/mug-1', acc = { a: 1 };
    const receipt = signReceipt({ v: 'iussum/0.2', mandate_id: null, grant_tx: null, offer_hash: offerHash(acc), resource: url, pay_to: key.publicKey, asset: key.publicKey, network: 'n', amount: '1', payer: key.publicKey, tx_sig: 'T'.repeat(88), settled_at: 5, seller: key.publicKey }, key);
    const attestation = signDelivery({ shop: key.publicKey, resource: url, sku: 'mug-1', content_sha256: contentSha256(img), content_type: 'image/png', delivered_at: 5, payer: key.publicKey, offer_hash: offerHash(acc) }, key);
    const ev = buildEvidence({ receipt, mandate_id: null, grant_tx: null, offer, spec, delivery: { bytes: img, attestation }, run, now: 6 });
    assert.equal((await verifyEvidence(ev, { shopKey: key.publicKey })).ok, true);
  }
});
test('a segmentation error and a vision error together still give the third state; a hint-free error keeps the raw text', () => {
  const r = applyRule({ seg: { error: 'parse: weird' }, full: { error: 'timeout: x' }, crop: null });
  assert.equal(r.outcome, 'COULD_NOT_BE_CHECKED'); assert.equal(r.reasons.length, 2); assert.match(r.reasons[0], /segmentation failed \(parse: weird\)/);
  assert.equal(segmentationHint(new ProviderError('parse', 'x')), null);
  assert.match(segmentationHint({ kind: 'http', status: 500, message: 'x' }), /failed/);
  assert.match(segmentationHint({ message: 'your credit is exhausted' }), /no credit/);
});
test('warm(): wakes the endpoint with a tiny image and one box; failures come back as { ok:false, hint }, never thrown; path C has nothing to wake', async () => {
  const ground = createBasetenAdapter({ apiKey: 'b', f: fakeFetch() });
  const mask = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#000' } }).png().toBuffer();
  const f = fakeFetch(json({ model: 'm', width: 64, height: 64, instances: [{ box: [8, 8, 56, 56], score: 0.9, mask_png_b64: mask.toString('base64') }] }), json({ error: 'billing' }, 402), new Error('boom'));
  const a = createGroundSamAdapter({ ground, url: 'https://x.modal.run', token: 't', f });
  const ok = await a.warm();
  assert.equal(ok.ok, true); assert.deepEqual(f.calls[0].body.boxes, [[8, 8, 56, 56]]); assert.ok(f.calls[0].body.image_b64.length > 50);
  const credit = await a.warm();
  assert.equal(credit.ok, false); assert.match(credit.hint, /no credit/); assert.match(credit.error, /http/);
  const net = await a.warm();
  assert.equal(net.ok, false); assert.match(net.hint, /could not be reached/);
  const c = await createGroundSamAdapter({ ground, maskless: true }).warm();
  assert.equal(c.ok, true); assert.ok(c.skipped);
  const mf = fakeFetch(json({ model: 'm', width: 64, height: 64, instances: [] }));
  assert.equal((await createModalAdapter({ url: 'u', token: 't', f: mf }).warm()).ok, true); assert.equal(mf.calls[0].body.phrase, 'object');
});
test('provider.warmSegmenter: delegates to the chosen segment adapter, null when it has none, never throws', async () => {
  const mask = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#000' } }).png().toBuffer();
  const f = fakeFetch(json({ model: 'm', width: 64, height: 64, instances: [{ box: [8, 8, 56, 56], score: 0.9, mask_png_b64: mask.toString('base64') }] }));
  const p = createProvider({ env: { MODEL_PROVIDER: 'baseten', MODEL_PROVIDER_SEGMENT: 'groundsam', BASETEN_API_KEY: 'b', MODAL_SAM2_URL: 'https://x.modal.run' }, f, ledger: new CostLedger() });
  assert.equal((await p.warmSegmenter()).ok, true);
  assert.equal(await createProvider({ env: { MODEL_PROVIDER: 'baseten', BASETEN_API_KEY: 'b' }, f, ledger: new CostLedger() }).warmSegmenter(), null);
  const broken = await createProvider({ env: { MODEL_PROVIDER: 'nonsense' } }).warmSegmenter();
  assert.equal(broken.ok, false);
});
test('dev stubs: the cold-start and failure knobs behave as documented', async () => {
  const fs = await import('node:fs'), os = await import('node:os'), path = await import('node:path');
  const { makeCatalogs } = await import('../src/shops/make-catalogs.js');
  const { stubImageProvider } = await import('./helpers.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'iussum-dev-'));
  await makeCatalogs({ provider: stubImageProvider(), catalogDir: dir });
  const ids = ['kiln', 'mugworks', 'glazed'];
  const slow = makeDevProvider({ catalogDir: dir, shopIds: ids, env: { DEV_WARM_MS: '60', DEV_SEGMENT_MS: '30' } });
  let t = Date.now(); const w = await slow.warmSegmenter(); assert.ok(Date.now() - t >= 55); assert.equal(w.ok, true);
  t = Date.now(); await slow.segment(Buffer.from('x')); assert.ok(Date.now() - t >= 25);
  for (const kind of ['402', 'timeout', 'network', '500']) {
    const bad = makeDevProvider({ catalogDir: dir, shopIds: ids, env: { DEV_SEGMENT_FAIL: kind } });
    await assert.rejects(bad.segment(Buffer.from('x')), { kind: kind === '402' || kind === '500' ? 'http' : kind });
    const w2 = await bad.warmSegmenter(); assert.equal(w2.ok, false); assert.ok(w2.hint);
  }
});
