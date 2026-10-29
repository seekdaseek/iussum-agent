import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import express from 'express';
import { createWebApp } from '../src/web/server.js';
import { createDailyGuard } from '../src/web/guards.js';
import { makeCtx, raw } from './helpers.js';

const ctxBase = await makeCtx();
const goodRaw = raw({ total_cap_usdc: '2', per_payment_max_usdc: '0.8', valid_for_hours: 24, shops: ['kiln'], item: { noun_phrase: 'red mug', count: 3 } });

async function boot({ rules, runMs = 20, daily, provider } = {}) {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iussum-web-'));
  const calls = { runs: [], revokes: 0 };
  const prov = provider ?? {
    ledger: { summary: () => ({ calls: 0, spentUsd: 0 }) }, adapterName: () => 'stub',
    compileMandate: async (text) => ({ value: /nothing/.test(text) ? raw({ status: 'clarify', clarify_field: 'shops' }) : /unlimited/.test(text) ? raw({ status: 'reject', reject_code: 'unbounded' }) : goodRaw, meta: { provider: 'stub', model: 'stub', latencyMs: 1, costUsd: 0.001 } }),
    transcribe: async () => ({ value: { text: 'buy a mug' }, meta: { provider: 'stub', model: 'stub-asr', costUsd: 0.0001 } }),
  };
  const pipeline = { run: async ({ compiled, runId, onEvent }) => { calls.runs.push({ runId, compiled }); onEvent({ type: 'grant_start' }); await new Promise((r) => setTimeout(r, runMs)); onEvent({ type: 'run_done' }); fs.mkdirSync(path.join(outDir, runId), { recursive: true }); return { run_id: runId, purchases: [{ n: 1, tx_sig: 'T'.repeat(88) }], summary: { model_cost_usd: 0.01, net_loss_usdc: '0.45' } }; } };
  const { app } = createWebApp({ ctxBase, provider: prov, pipeline, arbiter: { stored: () => null }, shopsApp: express(), chain: { usdc: async () => 1_000_000n, sendRevoke: async () => { calls.revokes++; return 'REV'.repeat(30); } }, keys: { principal: { address: 'P' }, float: { address: 'F' } }, outDir, webDir: path.join(process.cwd(), 'web'), rules, daily });
  const server = http.createServer(app); await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const j = (p, body) => fetch(base + p, body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { base, j, calls, outDir, close: () => server.close() };
}
const WAV = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVE'), Buffer.alloc(40)]).toString('base64');

test('status, security headers and the static page', async () => {
  const s = await boot();
  const st = await (await s.j('/api/status')).json();
  assert.equal(st.dev_stubs, false); assert.equal(st.providers.compileMandate, 'stub'); assert.equal(st.busy, null); assert.deepEqual(st.shops.map((x) => x.id), ['kiln', 'mugworks', 'glazed']);
  const page = await fetch(`${s.base}/`);
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-security-policy'), /script-src 'self'/);
  assert.equal(page.headers.get('x-content-type-options'), 'nosniff');
  assert.match(await page.text(), /Say what your agent may spend/);
  s.close();
});
test('compile: validation, the three answer kinds, and nothing sensitive in the response', async () => {
  const s = await boot();
  for (const bad of [{}, { text: '' }, { text: '   ' }, { text: 5 }, { text: 'x'.repeat(601) }]) assert.equal((await s.j('/api/compile', bad)).status, 400, JSON.stringify(bad).slice(0, 40));
  const ok = await (await s.j('/api/compile', { text: 'buy mugs' })).json();
  assert.equal(ok.status, 'mandate'); assert.match(ok.compile_id, /^\d{14}-[a-z0-9]{5}$/); assert.match(ok.readback, /at most 2 USDC/);
  assert.equal('mandate' in ok, false); assert.equal('raw_model_output' in ok, false); assert.equal(JSON.stringify(ok).includes('nonce'), false);
  const cl = await (await s.j('/api/compile', { text: 'nothing named' })).json();
  assert.deepEqual([cl.status, cl.clarify_field, cl.question], ['clarify', 'shops', 'Which shops may the agent buy from?']);
  assert.equal('compile_id' in cl, false);
  const rj = await (await s.j('/api/compile', { text: 'unlimited please' })).json();
  assert.deepEqual([rj.status, rj.reject_code], ['reject', 'unbounded']);
  s.close();
});
test('a provider failure is a 502, never a mandate', async () => {
  const s = await boot({ provider: { ledger: { summary: () => ({}) }, adapterName: () => 'x', compileMandate: async () => { throw Object.assign(new Error('boom'), { kind: 'http' }); } } });
  const r = await s.j('/api/compile', { text: 'buy mugs' });
  assert.equal(r.status, 502); assert.equal((await r.json()).status, 'error');
  s.close();
});
test('confirm: unknown id 404; one run at a time (409); the run is single use; events stream to the end; the grant is revoked afterwards', async () => {
  const s = await boot({ runMs: 150 });
  assert.equal((await s.j('/api/confirm', { compile_id: '20261026000000-aaaaa' })).status, 404);
  assert.equal((await s.j('/api/confirm', {})).status, 404);
  const a = (await (await s.j('/api/compile', { text: 'buy mugs' })).json()).compile_id, b = (await (await s.j('/api/compile', { text: 'buy mugs' })).json()).compile_id;
  const first = await s.j('/api/confirm', { compile_id: a, check_delivery: false });
  assert.equal(first.status, 200); const { run_id } = await first.json(); assert.equal(run_id, a);
  assert.equal(s.calls.runs[0].compiled.status, 'mandate');
  const busy = await s.j('/api/confirm', { compile_id: b });
  assert.equal(busy.status, 409); assert.equal((await busy.json()).error, 'busy');
  assert.equal((await s.j('/api/confirm', { compile_id: a })).status, 404); // consumed
  const ev = await (await fetch(`${s.base}/api/runs/${run_id}/events`)).text(); // resolves when the stream ends
  const types = ev.split('\n').filter((l) => l.startsWith('data: ')).map((l) => JSON.parse(l.slice(6)).type);
  assert.deepEqual(types.slice(0, 2), ['grant_start', 'run_done']);
  assert.ok(types.includes('revoked')); assert.equal(types.at(-1), 'end');
  assert.equal(s.calls.revokes, 1);
  const rep = await (await s.j(`/api/runs/${run_id}`)).json();
  assert.equal(rep.summary.net_loss_usdc, '0.45');
  const again = await s.j('/api/confirm', { compile_id: b, check_delivery: true }); // the lock is free again
  assert.equal(again.status, 200);
  s.close();
});
test('rate limits answer 429 with Retry-After', async () => {
  const s = await boot({ rules: { transcribe: { max: 1, windowMs: 60000 }, compile: { max: 2, windowMs: 60000 }, run: { max: 1, windowMs: 60000 } } });
  assert.equal((await s.j('/api/compile', { text: 'buy mugs' })).status, 200);
  assert.equal((await s.j('/api/compile', { text: 'buy mugs' })).status, 200);
  const r = await s.j('/api/compile', { text: 'buy mugs' });
  assert.equal(r.status, 429); assert.ok(Number(r.headers.get('retry-after')) > 0);
  assert.equal((await s.j('/api/transcribe', { audio_wav_b64: WAV })).status, 200);
  assert.equal((await s.j('/api/transcribe', { audio_wav_b64: WAV })).status, 429);
  s.close();
});
test('daily budgets: no compile after the model budget, no run that could cross the USDC budget', async () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iussum-daily-'));
  const s = await boot({ daily: createDailyGuard({ file: path.join(outDir, 'd.json'), maxModelUsd: 0.0015, maxUsdc: 1.5 }) });
  const c = await (await s.j('/api/compile', { text: 'buy mugs' })).json(); // costs 0.001 of 0.0015
  const refused = await s.j('/api/confirm', { compile_id: c.compile_id });    // total_cap 2 USDC > 1.5 USDC budget
  assert.equal(refused.status, 503); assert.equal((await refused.json()).error, 'daily_usdc_budget');
  assert.equal((await s.j('/api/compile', { text: 'buy mugs' })).status, 200); // 0.001 < 0.0015 still allowed (0.002 spent after it)
  const off = await s.j('/api/compile', { text: 'buy mugs' });
  assert.equal(off.status, 503); assert.equal((await off.json()).error, 'daily_model_budget');
  s.close();
});
test('transcribe: only a real, bounded WAV is accepted', async () => {
  const s = await boot();
  assert.equal((await s.j('/api/transcribe', {})).status, 400);
  assert.equal((await s.j('/api/transcribe', { audio_wav_b64: 'not base64!!' })).status, 400);
  assert.equal((await s.j('/api/transcribe', { audio_wav_b64: Buffer.from('this is not a wav file at all, but long enough to pass 44 bytes').toString('base64') })).status, 400);
  assert.equal((await s.j('/api/transcribe', { audio_wav_b64: 'A'.repeat(1_400_004) })).status, 400);
  assert.equal((await s.j('/api/transcribe', { audio_wav_b64: WAV })).status, 200);
  s.close();
});
test('run files: only the known file names of a well-formed run id are served; traversal and unknown ids are 404', async () => {
  const s = await boot();
  const id = '20261026000000-abcde'; fs.mkdirSync(path.join(s.outDir, id), { recursive: true });
  fs.writeFileSync(path.join(s.outDir, id, 'img-1.png'), 'png'); fs.writeFileSync(path.join(s.outDir, id, 'secret.txt'), 'nope'); fs.writeFileSync(path.join(s.outDir, 'daily-spend.json'), '{}');
  assert.equal((await fetch(`${s.base}/runs/${id}/img-1.png`)).status, 200);
  for (const p of [`/runs/${id}/secret.txt`, `/runs/${id}/..%2Fdaily-spend.json`, `/runs/..%2F${id}/img-1.png`, '/runs/20261026000000-abcde/img-9.png', '/runs/bad/img-1.png', '/api/runs/bad', '/api/runs/20261026000000-zzzzz', '/v/short', `/v/${'1'.repeat(88)}`]) assert.equal((await fetch(s.base + p)).status, 404, p);
  s.close();
});

test('the track record endpoint serves the committed tally; a missing file is a 404, not a crash', async () => {
  const s = await boot();
  const r = await s.j('/api/track-record');
  if (r.status === 200) { const t = await r.json(); assert.equal(t.total.runs, t.local.runs + t.page.runs); assert.equal(t.total.photos, t.local.photos + t.page.photos); assert.equal(t.total.caught + t.total.delivered_as_offered + t.total.could_not_be_checked, t.total.photos); assert.equal(t.runs.length, t.total.runs); }
  else assert.equal(r.status, 404);
  const page = await (await fetch(`${s.base}/`)).text(); assert.match(page, /id="track"/);
});

test('verdict check line names the models by what the record says was used', async () => {
  const { checkLine } = await import('../src/web/server.js');
  assert.equal(checkLine({ checks: { full: { model: { model: 'meta-models/muse-spark-open-1026' } }, seg: { model: { provider: 'baseten+modal' } } } }), "Muse Spark Open finds the item, Meta's SAM 2.1 cuts the mask (Modal), Muse Spark Open judges it.");
  assert.doesNotMatch(checkLine({ checks: { full: { model: { model: 'meta-models/muse-spark-open-1026' } }, seg: { model: { provider: 'baseten' } } } }), /SAM/);
});
