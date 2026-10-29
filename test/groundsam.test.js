import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { createGroundSamAdapter, cleanBoxes, groundQuestion, GROUND_SCHEMA } from '../models/adapters/groundsam.js';
import { createBasetenAdapter } from '../models/adapters/baseten.js';
import { createProvider } from '../models/provider.js';
import { CostLedger } from '../models/cost.js';
import { runDeliveryCheck } from '../src/evidence/check.js';
import { buildEvidence, verifyEvidence } from '../src/evidence/record.js';
import { receiptKey, signReceipt, offerHash } from '@iussum/core';
import { signDelivery, contentSha256 } from '../src/shops/attest.js';
import { syntheticPng } from './helpers.js';

const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
const fakeFetch = (...answers) => { const calls = []; const f = async (url, init) => { calls.push({ url, init, body: typeof init.body === 'string' ? JSON.parse(init.body) : init.body }); const a = answers.shift(); return typeof a === 'function' ? a() : a; }; f.calls = calls; return f; };
const chat = (obj) => json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(obj), reasoning_content: 'r' } }], usage: { prompt_tokens: 600, completion_tokens: 250, completion_tokens_details: { reasoning_tokens: 200 } } });
const maskPng = (w, h, rect) => sharp({ create: { width: w, height: h, channels: 3, background: '#000' } }).composite([{ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect x="${rect[0]}" y="${rect[1]}" width="${rect[2]}" height="${rect[3]}" fill="#fff"/></svg>`) }]).png().toBuffer();

test('cleanBoxes: only finite, positive-area boxes inside the image, clipped, at most 5', () => {
  assert.deepEqual(cleanBoxes([{ x1: -10, y1: 5, x2: 300, y2: 400 }], 256, 256), [[0, 5, 256, 256]]);
  assert.deepEqual(cleanBoxes([{ x1: 50, y1: 60, x2: 10, y2: 20 }], 256, 256), [[10, 20, 50, 60]]); // swapped corners
  assert.deepEqual(cleanBoxes([{ x1: 'a', y1: 0, x2: 10, y2: 10 }, { x1: 0, y1: 0, x2: 2, y2: 2 }, { x1: 5, y1: 5, x2: 5, y2: 90 }, { x1: NaN, y1: 0, x2: 9, y2: 9 }, null].filter(Boolean), 100, 100), []);
  assert.equal(cleanBoxes(Array.from({ length: 9 }, () => ({ x1: 0, y1: 0, x2: 50, y2: 50 })), 100, 100).length, 5);
  assert.deepEqual(cleanBoxes(undefined, 10, 10), []);
});
test('groundsam: Spark Open grounds the phrase (job ground, JSON mode), SAM 2.1 returns one mask per box, result has the Meta SAM shape', async () => {
  const img = await syntheticPng('red-mug'); // 256 x 256
  const gf = fakeFetch(chat({ found: true, boxes: [{ x1: 80, y1: 90, x2: 195, y2: 190 }] }));
  const mf = fakeFetch(json({ model: 'facebook/sam2.1-hiera-large', width: 256, height: 256, instances: [{ box: [80, 90, 195, 190], score: 0.93, mask_png_b64: (await maskPng(256, 256, [80, 90, 100, 100])).toString('base64') }] }));
  const a = createGroundSamAdapter({ ground: createBasetenAdapter({ apiKey: 'b', f: gf }), url: 'https://x.modal.run', token: 't', f: mf });
  const r = await a.segment(img, 'red ceramic mug');
  const gb = gf.calls[0].body;
  assert.equal(gb.reasoning_effort, 'medium'); assert.deepEqual(gb.response_format, { type: 'json_object' });
  assert.match(gb.messages[0].content[0].text, /256 pixels wide and 256 pixels tall/); assert.match(gb.messages[0].content[0].text, /"red ceramic mug"/);
  assert.equal(mf.calls[0].init.headers.authorization, 'Bearer t'); assert.deepEqual(mf.calls[0].body.boxes, [[80, 90, 195, 190]]);
  assert.equal(r.value.instances.length, 1);
  const i = r.value.instances[0];
  assert.deepEqual(i.box, { x1: 80, y1: 90, x2: 195, y2: 190 }); assert.equal(i.confidence, 0.93); assert.equal(i.areaPx, 100 * 100); assert.equal(i.mask.width, 256);
  assert.deepEqual(r.value.frame, { w: 256, h: 256 });
  assert.deepEqual(JSON.parse(r.value.rawOutput).sam.scores, [0.93]);
  assert.equal(r.meta.provider, 'baseten+modal'); assert.equal(r.meta.reasoningTokens, 200); assert.equal(r.meta.images, 1);
  assert.match(groundQuestion(10, 20, 'mug'), /clear glass is not/); assert.ok(GROUND_SCHEMA.required.includes('boxes'));
});
test('groundsam: "not found" is zero instances and never calls SAM; a "found" with unusable boxes is zero instances with a diagnostic', async () => {
  const img = await syntheticPng('glass');
  const mf = fakeFetch();
  const none = await createGroundSamAdapter({ ground: createBasetenAdapter({ apiKey: 'b', f: fakeFetch(chat({ found: false, boxes: [] })) }), url: 'u', f: mf }).segment(img, 'red ceramic mug');
  assert.deepEqual(none.value.instances, []); assert.equal(mf.calls.length, 0); assert.equal(none.meta.images, 0);
  const bad = await createGroundSamAdapter({ ground: createBasetenAdapter({ apiKey: 'b', f: fakeFetch(chat({ found: true, boxes: [{ x1: 1, y1: 1, x2: 2, y2: 2 }] })) }), url: 'u', f: mf }).segment(img, 'red ceramic mug');
  assert.deepEqual(bad.value.instances, []); assert.equal(bad.value.diagnostics[0].code, 'no_valid_box');
});
test('groundsam: a malformed grounding answer, a wrong SAM answer, an endpoint error are errors, never an instance', async () => {
  const img = await syntheticPng('red-mug');
  const mk = (g, m) => createGroundSamAdapter({ ground: createBasetenAdapter({ apiKey: 'b', f: fakeFetch(g) }), url: 'u', f: fakeFetch(m) }).segment(img, 'mug');
  const goodGround = () => chat({ found: true, boxes: [{ x1: 80, y1: 90, x2: 195, y2: 190 }] });
  await assert.rejects(mk(chat({ boxes: [] })), { kind: 'parse' });
  await assert.rejects(mk(goodGround(), json({ width: 256, height: 256, instances: [] })), { kind: 'parse' });
  await assert.rejects(mk(goodGround(), json({ width: 100, height: 100, instances: [{ score: 1, mask_png_b64: '' }] })), { kind: 'parse' });
  await assert.rejects(mk(goodGround(), json({ error: 'gpu' }, 500)), { kind: 'http', status: 500 });
  await assert.rejects(mk(goodGround(), json({ width: 256, height: 256, instances: [{ score: 0.9, mask_png_b64: (await maskPng(64, 64, [0, 0, 10, 10])).toString('base64') }] })), { kind: 'parse' }); // mask of the wrong size
  assert.throws(() => createGroundSamAdapter({ ground: {}, url: '' }), { kind: 'config' });
});
test('provider: MODEL_PROVIDER_SEGMENT=groundsam; the call is priced from the grounding tokens', async () => {
  const img = await syntheticPng('red-mug');
  const f = fakeFetch(chat({ found: true, boxes: [{ x1: 80, y1: 90, x2: 195, y2: 190 }] }), json({ model: 'm', width: 256, height: 256, instances: [{ score: 0.9, mask_png_b64: (await maskPng(256, 256, [80, 90, 20, 20])).toString('base64') }] }));
  const ledger = new CostLedger();
  const p = createProvider({ env: { MODEL_PROVIDER: 'baseten', MODEL_PROVIDER_SEGMENT: 'groundsam', BASETEN_API_KEY: 'b', MODAL_SAM2_URL: 'https://x.modal.run' }, f, ledger });
  assert.equal(p.adapterName('segment'), 'baseten+modal'); assert.equal(p.adapterName('vision'), 'baseten');
  const r = await p.segment(img, 'red ceramic mug');
  assert.ok(r.meta.costUsd > 0); assert.equal(ledger.summary().tokens.completion, 250);
  assert.throws(() => createProvider({ env: { MODEL_PROVIDER: 'groundsam', BASETEN_API_KEY: 'b' } }).adapterName('segment'), { kind: 'config' });
});
test('evidence from path B verifies, and a doctored box, score or "found" is caught', async () => {
  const key = receiptKey(), img = await syntheticPng('glass');
  const vis = (m, c) => ({ observed_object: 'x', observed_colour: null, observed_material: null, matches_offer: m, violates_must_not: false, confidence: c, reason: 'r' });
  const provider = {
    segment: async () => ({ value: { rawOutput: JSON.stringify({ ground: { found: true, boxes: [{ x1: 80, y1: 90, x2: 195, y2: 190 }] }, sam: { model: 'm', boxes: [[80, 90, 195, 190]], scores: [0.9] } }), frame: { w: 256, h: 256 }, instances: [{ id: '0', box: { x1: 80, y1: 90, x2: 195, y2: 190 }, confidence: 0.9, areaPx: 1000, mask: { left: 0, top: 0, right: 256, bottom: 256, width: 256, height: 256, bits: new Uint8Array(256 * 256).fill(1) } }], diagnostics: [] }, meta: { provider: 'baseten+modal', model: 'meta-models/muse-spark-open-1026' } }),
    vision: async (_i, _q, o) => ({ value: vis('no', 0.9), meta: { provider: 'baseten', model: 'meta-models/muse-spark-open-1026' } }),
  };
  const url = 'https://m.example/shops/mugworks/v1/photo/mug-1', accepted = { a: 1 };
  const run = await runDeliveryCheck({ provider, image: img, offer: { shop: 'mugworks', sku: 'mug-1', title: 't', description: 'd' }, spec: { noun_phrase: 'red ceramic mug', must_not: [] } });
  assert.equal(run.rule.outcome, 'NOT_AS_OFFERED');
  const receipt = signReceipt({ v: 'iussum/0.2', mandate_id: null, grant_tx: null, offer_hash: offerHash(accepted), resource: url, pay_to: key.publicKey, asset: key.publicKey, network: 'n', amount: '1', payer: key.publicKey, tx_sig: 'T'.repeat(88), settled_at: 5, seller: key.publicKey }, key);
  const attestation = signDelivery({ shop: key.publicKey, resource: url, sku: 'mug-1', content_sha256: contentSha256(img), content_type: 'image/png', delivered_at: 5, payer: key.publicKey, offer_hash: offerHash(accepted) }, key);
  const ev = buildEvidence({ receipt, mandate_id: null, grant_tx: null, offer: run.checks.seg ? { shop: 'mugworks', sku: 'mug-1', title: 't', description: 'd' } : null, spec: { noun_phrase: 'red ceramic mug', must_not: [] }, delivery: { bytes: img, attestation }, run, now: 6 });
  assert.equal((await verifyEvidence(ev, { shopKey: key.publicKey })).ok, true);
  const tamper = async (f) => { const e = JSON.parse(JSON.stringify(ev)); f(e.record); return verifyEvidence(e, { shopKey: key.publicKey }); };
  assert.ok((await tamper((r) => { r.checks.seg.instances[0].box.x2 = 190; })).problems.some((p) => /differ from the boxes and scores/.test(p)));
  assert.ok((await tamper((r) => { r.checks.seg.instances[0].confidence = 0.99; })).problems.some((p) => /differ from the boxes and scores/.test(p)));
  assert.ok((await tamper((r) => { r.checks.seg.instances = []; })).problems.some((p) => /differ from the boxes and scores|no instance was recorded/.test(p)));
});

test('path C (maskless): boxes from Spark Open only, no mask and no confidence, nothing sent to Modal; the overlay draws the box alone', async () => {
  const img = await syntheticPng('red-mug');
  const mf = fakeFetch();
  const a = createGroundSamAdapter({ ground: createBasetenAdapter({ apiKey: 'b', f: fakeFetch(chat({ found: true, boxes: [{ x1: 80, y1: 90, x2: 195, y2: 190 }] })) }), maskless: true, f: mf });
  assert.equal(a.name, 'baseten-ground');
  const r = await a.segment(img, 'red ceramic mug');
  assert.equal(mf.calls.length, 0);
  assert.deepEqual(r.value.instances, [{ id: '0', box: { x1: 80, y1: 90, x2: 195, y2: 190 }, confidence: null, mask: null, areaPx: null }]);
  assert.equal(JSON.parse(r.value.rawOutput).sam, null);
  assert.equal(r.meta.provider, 'baseten-ground'); assert.equal(r.meta.images, 0);
  const { makeOverlay } = await import('../src/evidence/overlay.js');
  const o = await makeOverlay(img, { instance: r.value.instances[0], frame: r.value.frame });
  assert.equal(o.drawn, 'box');
  const p = createProvider({ env: { MODEL_PROVIDER: 'baseten', MODEL_PROVIDER_SEGMENT: 'ground', BASETEN_API_KEY: 'b' }, f: fakeFetch(), ledger: new CostLedger() });
  assert.equal(p.adapterName('segment'), 'baseten-ground');
});
