// These tests pin what WE send and how WE read answers, using a fake fetch. They say nothing about whether the live services accept the requests:
// no real call has been made (no key). Every adapter is UNTESTED against its service until one real call per job has been logged.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createProvider } from '../models/provider.js';
import { createMetaAdapter, readSamResult } from '../models/adapters/meta.js';
import { createBasetenAdapter } from '../models/adapters/baseten.js';
import { createModalAdapter } from '../models/adapters/modal.js';
import { createFixtureAdapter, fixtureKey } from '../models/adapters/fixture.js';
import { withRecording } from '../models/record.js';
import { CostLedger, priceCall } from '../models/cost.js';
import { extractJsonObject } from '../models/http.js';
import { ProviderError } from '../models/errors.js';
import sharp from 'sharp';

const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
function fakeFetch(...answers) {
  const calls = [];
  const f = async (url, init) => { calls.push({ url, init, body: typeof init.body === 'string' ? JSON.parse(init.body) : init.body }); const a = answers.shift(); return typeof a === 'function' ? a() : a; };
  f.calls = calls; return f;
}
const PNG = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#c33' } }).png().toBuffer();

// Example SAM 3.1 output printed in the README of @meta-sam/parser 0.1.0 (frame 0 of a 320x334 clip, prompt "button", two objects).
const SAM_SAMPLE = '<0f>0<|box;x1=211;y1=228;x2=270;y2=254;w=320;h=334|>' + "<|mask;x=0;y=0;data=27,60,~!!!!M!0c[0o91w?q1!pIH4pPRVp2B3'7`e.ioeAf6-k/#Xd8%dX9x(|>" + ',1<|box;x1=155;y1=228;x2=202;y2=254;w=320;h=334|>' + '<|mask;x=0;y=0;data=27,48,~!!!!J!0c[q=Pj_zs=*4C4(/./x#:/`S_GnD`=o3?X{emCgO$y@|>\n';

test('meta chat: structured output request shape and parse', async () => {
  const f = fakeFetch(json({ choices: [{ message: { content: '{"status":"clarify"}' } }], usage: { prompt_tokens: 100, completion_tokens: 20 } }));
  const a = createMetaAdapter({ apiKey: 'k'.repeat(8), f });
  const r = await a.compileMandate('hello', { system: 'sys', schema: { type: 'object' } });
  const c = f.calls[0];
  assert.equal(c.url, 'https://api.meta.ai/v1/chat/completions');
  assert.equal(c.init.headers.authorization, `Bearer ${'k'.repeat(8)}`);
  assert.equal(c.body.model, 'muse-spark-1.3');
  assert.deepEqual(c.body.response_format, { type: 'json_schema', json_schema: { name: 'intent', schema: { type: 'object' } } });
  assert.deepEqual(c.body.messages.map((m) => m.role), ['system', 'user']);
  assert.deepEqual(r.value, { status: 'clarify' });
  assert.equal(r.meta.provider, 'meta');
});
test('meta chat: refusal, empty content and non-JSON are typed errors, never a value', async () => {
  const mk = (resp) => createMetaAdapter({ apiKey: 'k', f: fakeFetch(resp) }).compileMandate('x', { system: 's', schema: {} });
  await assert.rejects(mk(json({ choices: [{ message: { refusal: 'no' } }] })), { kind: 'refusal' });
  await assert.rejects(mk(json({ choices: [{ message: { content: '' } }] })), { kind: 'parse' });
  await assert.rejects(mk(json({ choices: [{ message: { content: 'not json' } }] })), { kind: 'parse' });
  await assert.rejects(mk(json({ error: { message: 'bad' } }, 400)), { kind: 'http', status: 400 });
  await assert.rejects(mk(new Response('<html>', { status: 200 })), { kind: 'parse' });
});
test('meta vision: image goes as a data URL in an image_url part', async () => {
  const f = fakeFetch(json({ choices: [{ message: { content: '{"matches":true}' } }] }));
  await createMetaAdapter({ apiKey: 'k', f }).vision(PNG, 'is it a mug?', { schema: { type: 'object' } });
  const part = f.calls[0].body.messages.at(-1).content;
  assert.equal(part[0].type, 'text');
  assert.equal(part[1].type, 'image_url');
  assert.match(part[1].image_url.url, /^data:image\/png;base64,/);
});
test('meta transcribe: multipart with a JSON request part and a wav audio part, Accept json', async () => {
  const f = fakeFetch(json({ sessionId: 's', transcript: 'buy a mug', audioDurationMs: 2500, turns: [] }));
  const r = await createMetaAdapter({ apiKey: 'k', f }).transcribe(Buffer.from('RIFFxxxx'));
  const c = f.calls[0];
  assert.equal(c.url, 'https://api.meta.ai/v1/asr/transcribe');
  assert.equal(c.init.headers.accept, 'application/json');
  assert.ok(c.body instanceof FormData);
  assert.deepEqual(JSON.parse(await c.body.get('request').text()), { model: 'muse-voice-transcribe-1.0', audioEncoding: 'WAV', mode: 'PUSH_TO_TALK' });
  assert.equal(c.body.get('audio').type, 'audio/wav');
  assert.deepEqual(r.value, { text: 'buy a mug', audioDurationMs: 2500 });
  assert.equal(r.meta.audioMs, 2500);
});
test('meta segment: Responses API request shape; answer parsed by the Meta parser', async () => {
  const f = fakeFetch(json({ output: [{ type: 'message', content: [{ type: 'output_text', text: SAM_SAMPLE }] }] }));
  const r = await createMetaAdapter({ apiKey: 'k', f }).segment(PNG, 'button');
  const c = f.calls[0];
  assert.equal(c.url, 'https://api.meta.ai/v1/responses');
  assert.equal(c.body.model, 'sam-3.1');
  assert.deepEqual(c.body.input[0].content.map((x) => x.type), ['input_text', 'input_image']);
  assert.equal(c.body.input[0].content[0].text, 'button');
  assert.deepEqual(r.value.frame, { w: 320, h: 334 });
  assert.equal(r.value.instances.length, 2);
  assert.deepEqual(r.value.instances[0].box, { x1: 211, y1: 228, x2: 271, y2: 255 });
  assert.equal(r.value.instances[0].mask.width, 60);
  assert.equal(r.value.instances[0].mask.height, 27);
  assert.ok(r.value.instances[0].areaPx > 0 && r.value.instances[0].areaPx <= 27 * 60);
  assert.equal(r.value.rawOutput, SAM_SAMPLE);
});
test('meta segment: empty output_text is zero matches, a missing output array is an error', async () => {
  const none = await createMetaAdapter({ apiKey: 'k', f: fakeFetch(json({ output: [{ type: 'message', content: [{ type: 'output_text', text: '' }] }] })) }).segment(PNG, 'mug');
  assert.deepEqual(none.value.instances, []);
  await assert.rejects(createMetaAdapter({ apiKey: 'k', f: fakeFetch(json({ nothing: 1 })) }).segment(PNG, 'mug'), { kind: 'parse' });
});
test('readSamResult on the Meta docs sample', async () => {
  const r = await readSamResult(SAM_SAMPLE);
  assert.equal(r.instances.length, 2);
  assert.equal(r.instances[1].box.x1, 155);
  assert.equal(r.instances[0].confidence, null); // the sample has no c= field: absent is null, never zero
  assert.deepEqual(r.diagnostics, []);
});
test('meta images: generation and edit request shapes', async () => {
  const f = fakeFetch(json({ data: [{ b64_json: PNG.toString('base64') }] }), json({ data: [{ b64_json: PNG.toString('base64') }] }));
  const a = createMetaAdapter({ apiKey: 'k', f });
  const g = await a.generateImage('a red ceramic mug on white', { size: '1024x1024' });
  assert.equal(f.calls[0].url, 'https://api.meta.ai/v1/images/generations');
  assert.deepEqual({ ...f.calls[0].body }, { model: 'muse-image-1.0', prompt: 'a red ceramic mug on white', n: 1, size: '1024x1024', response_format: 'b64_json', output_format: 'png' });
  assert.deepEqual(g.value.png, PNG);
  await a.editImage(PNG, 'turn the mug into a glass');
  assert.equal(f.calls[1].url, 'https://api.meta.ai/v1/images/edits');
  assert.equal(f.calls[1].init.headers['content-type'], 'application/json'); // the Meta JSON form: multipart-less, or the service answers 415
  assert.match(f.calls[1].body.images[0].image_url, /^data:image\/png;base64,/);
});
test('meta: no key is a config error at construction', () => {
  assert.throws(() => createMetaAdapter({}), { kind: 'config' });
});

test('baseten: JSON is asked for in the prompt (no structured output) and extracted; segment is unsupported', async () => {
  const f = fakeFetch(json({ choices: [{ message: { content: 'Sure! ```json\n{"status":"clarify","note":"a } in a string"}\n``` done' } }] }));
  const a = createBasetenAdapter({ apiKey: 'b', f });
  const r = await a.compileMandate('x', { system: 'sys', schema: { type: 'object' } });
  const c = f.calls[0];
  assert.equal(c.url, 'https://inference.baseten.co/v1/chat/completions');
  assert.equal(c.body.model, 'meta-models/muse-spark-open-1026');
  assert.equal(c.body.response_format, undefined);
  assert.match(c.body.messages[0].content, /ONE JSON object/);
  assert.deepEqual(r.value, { status: 'clarify', note: 'a } in a string' });
  await assert.rejects(a.segment(PNG, 'mug'), { kind: 'unsupported' });
  await assert.rejects(a.generateImage('x'), { kind: 'unsupported' });
  const g = fakeFetch(json({ choices: [{ message: { content: 'no json here' } }] }));
  await assert.rejects(createBasetenAdapter({ apiKey: 'b', f: g }).compileMandate('x', { system: 's', schema: {} }), { kind: 'parse' });
});
test('baseten: audio uses an audio_url part', async () => {
  const f = fakeFetch(json({ choices: [{ message: { content: ' buy a mug ' } }] }));
  const r = await createBasetenAdapter({ apiKey: 'b', f }).transcribe(Buffer.from('RIFF'));
  assert.equal(f.calls[0].body.messages[0].content[1].type, 'audio_url');
  assert.equal(r.value.text, 'buy a mug');
});
test('extractJsonObject handles braces inside strings and returns null when absent', () => {
  assert.equal(extractJsonObject('x {"a":"}"} y'), '{"a":"}"}');
  assert.equal(extractJsonObject('no object'), null);
  assert.equal(extractJsonObject('{"a":1'), null);
});

test('modal: normalises our endpoint answer into the same instance shape', async () => {
  const mask = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#000' } }).composite([{ input: await sharp({ create: { width: 2, height: 2, channels: 3, background: '#fff' } }).png().toBuffer(), left: 1, top: 1 }]).png().toBuffer();
  const f = fakeFetch(json({ model: 'sam3.1', width: 4, height: 4, instances: [{ box: [1, 1, 3, 3], score: 0.9, mask_png_b64: mask.toString('base64') }] }));
  const r = await createModalAdapter({ url: 'https://x.modal.run', token: 't', f }).segment(PNG, 'mug');
  assert.equal(f.calls[0].init.headers.authorization, 'Bearer t');
  assert.equal(f.calls[0].body.phrase, 'mug');
  assert.equal(r.value.instances[0].areaPx, 4);
  assert.deepEqual(r.value.instances[0].box, { x1: 1, y1: 1, x2: 3, y2: 3 });
  assert.equal(r.value.instances[0].confidence, 0.9);
  await assert.rejects(createModalAdapter({ url: 'u', f: fakeFetch(json({ instances: 'x' })) }).segment(PNG, 'm'), { kind: 'parse' });
  await assert.rejects(createModalAdapter({ url: 'u' }).compileMandate('x', {}), { kind: 'unsupported' });
});

test('provider: per-job routing from env, and a job the provider does not serve fails loudly', async () => {
  const env = { MODEL_PROVIDER: 'baseten', MODEL_PROVIDER_SEGMENT: 'modal', BASETEN_API_KEY: 'b', MODAL_SAM_URL: 'https://x.modal.run' };
  const p = createProvider({ env, ledger: new CostLedger() });
  assert.equal(p.adapterName('compileMandate'), 'baseten');
  assert.equal(p.adapterName('vision'), 'baseten');
  assert.equal(p.adapterName('segment'), 'modal');
  await assert.rejects(p.generateImage('x'), { kind: 'unsupported' }); // baseten does not serve it; no silent fallback to meta
  assert.throws(() => createProvider({ env: { MODEL_PROVIDER: 'openai' } }).adapterName('vision'), { kind: 'config' });
  assert.throws(() => createProvider({ env: {} }).adapterName('vision'), { kind: 'config' }); // default meta, no key
});
test('provider: the fixture adapter is refused when DEMO=1', () => {
  assert.throws(() => createProvider({ env: { MODEL_PROVIDER: 'fixture', DEMO: '1' } }).adapterName('vision'), { kind: 'forbidden' });
  assert.equal(createProvider({ env: { MODEL_PROVIDER: 'fixture' } }).adapterName('vision'), 'fixture');
});
test('provider: cost is priced from usage, failed calls are logged unpriced, and the stop threshold refuses further paid calls', async () => {
  const ledger = new CostLedger({ stopAtUsd: 0.001 });
  const f = fakeFetch(json({ choices: [{ message: { content: '{}' } }], usage: { prompt_tokens: 1_000_000, completion_tokens: 100_000 } }), json({ error: 1 }, 500));
  const p = createProvider({ env: { MODEL_PROVIDER: 'meta', MODEL_API_KEY: 'k' }, f, ledger });
  const ok = await p.compileMandate('x', { system: 's', schema: {} });
  assert.equal(ok.meta.costUsd, 1.25 + 0.425);
  assert.equal(ledger.total, 1.675);
  await assert.rejects(p.compileMandate('x', { system: 's', schema: {} }), { code: 'spend_guard' }); // over the threshold: no second call is even sent
  assert.equal(f.calls.length, 1);
  const l2 = new CostLedger({ stopAtUsd: 100 });
  const p2 = createProvider({ env: { MODEL_PROVIDER: 'meta', MODEL_API_KEY: 'k' }, f: fakeFetch(json({}, 500)), ledger: l2 });
  await assert.rejects(p2.vision(PNG, 'q'), { kind: 'http' });
  assert.deepEqual(l2.rows.map((r) => [r.ok, r.costUsd]), [[false, null]]);
  assert.equal(priceCall({ provider: 'meta', model: 'sam-3.1', images: 4 }), 0.01);
  assert.equal(priceCall({ provider: 'meta', model: 'muse-image-1.0', images: 3 }), 0.03);
  assert.equal(priceCall({ provider: 'baseten', model: 'x', usage: { prompt_tokens: 1, completion_tokens: 1 } }), null);
});
test('ledger persists to a file and reloads', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'iussum-cost-')), 'cost.jsonl');
  const a = new CostLedger({ file }); a.add({ job: 'x', costUsd: 0.5 }); a.add({ job: 'y', costUsd: null });
  const b = new CostLedger({ file });
  assert.deepEqual(b.summary(), { calls: 2, spentUsd: 0.5, unpricedCalls: 1, stopAtUsd: 100 });
});

test('recording wraps a real adapter and the fixture adapter replays it; a missing fixture is an error', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'iussum-fx-'));
  const f = fakeFetch(json({ output: [{ type: 'message', content: [{ type: 'output_text', text: SAM_SAMPLE }] }] }), json({ choices: [{ message: { content: '{"matches":true}' } }] }));
  const rec = withRecording(createMetaAdapter({ apiKey: 'k', f }), dir);
  await rec.segment(PNG, 'button');
  await rec.vision(PNG, 'q?', { schema: { type: 'object' } });
  const fx = createFixtureAdapter({ dir });
  const seg = await fx.segment(PNG, 'button');
  assert.equal(seg.value.instances.length, 2);
  assert.equal(seg.meta.provider, 'fixture');
  assert.equal(seg.meta.replayedFrom, 'meta');
  assert.equal(seg.meta.fixtureProvenance, 'recorded');
  assert.deepEqual((await fx.vision(PNG, 'q?', { schema: { type: 'object' } })).value, { matches: true });
  await assert.rejects(fx.segment(PNG, 'another phrase'), (e) => e instanceof ProviderError && e.kind === 'fixture_missing');
  assert.notEqual(fixtureKey('segment', { image: PNG, phrase: 'a' }), fixtureKey('segment', { image: PNG, phrase: 'b' }));
});

test('agentStep: tool calls are parsed from an OpenAI-style answer; bad arguments are a parse error', async () => {
  const tools = [{ type: 'function', function: { name: 'buy', parameters: { type: 'object' } } }];
  const ok = json({ choices: [{ finish_reason: 'tool_calls', message: { content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'buy', arguments: '{"sku":"mug-front"}' } }] } }], usage: { prompt_tokens: 10, completion_tokens: 5 } });
  const f = fakeFetch(ok);
  const r = await createMetaAdapter({ apiKey: 'k', f }).agentStep([{ role: 'user', content: 'go' }], tools);
  assert.equal(f.calls[0].body.tool_choice, 'auto');
  assert.deepEqual(f.calls[0].body.tools, tools);
  assert.deepEqual(r.value, { content: '', tool_calls: [{ id: 'c1', name: 'buy', arguments: { sku: 'mug-front' } }], finish_reason: 'tool_calls' });
  const bad = json({ choices: [{ message: { tool_calls: [{ id: 'c1', function: { name: 'buy', arguments: '{oops' } }] } }] });
  await assert.rejects(createMetaAdapter({ apiKey: 'k', f: fakeFetch(bad) }).agentStep([], tools), { kind: 'parse' });
  await assert.rejects(createMetaAdapter({ apiKey: 'k', f: fakeFetch(json({ choices: [{ message: { refusal: 'no' } }] })) }).agentStep([], tools), { kind: 'refusal' });
  const b = await createBasetenAdapter({ apiKey: 'b', f: fakeFetch(json({ choices: [{ finish_reason: 'stop', message: { content: 'done' } }] })) }).agentStep([], tools);
  assert.deepEqual(b.value, { content: 'done', tool_calls: [], finish_reason: 'stop' });
  await assert.rejects(createModalAdapter({ url: 'u' }).agentStep([], tools), { kind: 'unsupported' });
});
