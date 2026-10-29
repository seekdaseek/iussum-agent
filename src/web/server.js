// The live page and its API. One process: the demo shops (mounted at /shops/<id>), the arbiter, the pipeline and the static page.
// A visitor types or speaks a request -> /api/compile (read-back, nothing granted) -> /api/confirm (grant on devnet, run) -> /api/runs/:id/events (live progress).
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { compileRequest } from '../intent/compile.js';
import { createRateLimiter, createDailyGuard, createSingleFlight, clientIp } from './guards.js';
import { newRunId } from '../run/pipeline.js';
import { explorerTx } from '../chain/chain.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const RUN_FILE = /^(img|overlay)-\d{1,2}\.png$|^evidence-\d{1,2}\.json$|^run\.json$/;
const RUN_ID = /^[0-9]{14}-[a-z0-9]{5}$/;
export const DEFAULT_RULES = { transcribe: { max: 8, windowMs: 600_000 }, compile: { max: 15, windowMs: 600_000 }, run: { max: 3, windowMs: 3_600_000 } };

// cfg: { ctxBase (shops, principal, agent, network, asset), provider, pipeline, arbiter, shopsApp, chain, keys, outDir, webDir, devStubs, trustCf, guards?, now }
export function createWebApp(cfg) {
  const { provider, pipeline, arbiter, shopsApp, chain, keys, outDir, webDir, devStubs = false, trustCf = false } = cfg;
  const now = cfg.now ?? (() => Math.floor(Date.now() / 1000));
  const limiter = createRateLimiter({ rules: cfg.rules ?? DEFAULT_RULES });
  const daily = cfg.daily ?? createDailyGuard({ file: path.join(outDir, 'daily-spend.json'), maxModelUsd: Number(process.env.DAILY_MODEL_USD ?? 8), maxUsdc: Number(process.env.DAILY_USDC ?? 5) });
  const flight = createSingleFlight();
  const pending = new Map(); // compile_id -> { result, expires }
  const runs = new Map();    // run_id -> { events[], listeners:Set, done, report }
  fs.mkdirSync(outDir, { recursive: true });

  const app = express();
  app.set('trust proxy', trustCf);
  app.disable('x-powered-by');
  app.use((_req, res, next) => {
    res.set({ 'Content-Security-Policy': "default-src 'self'; img-src 'self' data: blob:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'", 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' });
    next();
  });
  app.use(shopsApp); // the shops (already mounted under /shops/<id>) speak x402 on their own routes and need no JSON body parser
  app.use(express.json({ limit: '2mb' }));

  const ip = (req) => clientIp(req, trustCf);
  const limited = (req, res, rule) => { const r = limiter.take(rule, ip(req)); if (!r.ok) { res.set('Retry-After', String(r.retryAfterS)).status(429).json({ error: 'rate_limited', retry_after_s: r.retryAfterS }); return true; } return false; };
  const ctxFor = () => ({ ...cfg.ctxBase, now: now() });
  const provNames = () => Object.fromEntries(['transcribe', 'compileMandate', 'vision', 'segment', 'agentStep'].map((j) => { try { return [j, provider.adapterName(j)]; } catch (e) { return [j, `unavailable (${e.kind ?? e.message})`]; } }));

  app.get('/api/status', async (_req, res) => {
    let balances = null;
    try { balances = { principal_usdc: String(await chain.usdc(keys.principal.address)), float_usdc: String(await chain.usdc(keys.float.address)) }; } catch { /* the page shows nothing rather than a wrong number */ }
    res.json({ dev_stubs: devStubs, providers: provNames(), model_spend: provider.ledger.summary(), daily: daily.snapshot(), busy: flight.active ? { since: flight.active.since } : null, network: 'solana devnet', balances, shops: cfg.ctxBase.shops.map((s) => ({ id: s.id, name: s.name })) });
  });

  app.post('/api/transcribe', async (req, res) => {
    if (limited(req, res, 'transcribe')) return;
    const b64 = req.body?.audio_wav_b64;
    if (typeof b64 !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(b64) || b64.length > 1_400_000) return res.status(400).json({ error: 'audio_wav_b64 must be base64 WAV, at most about 1 MB' });
    const audio = Buffer.from(b64, 'base64');
    if (audio.length < 44 || audio.subarray(0, 4).toString() !== 'RIFF' || audio.subarray(8, 12).toString() !== 'WAVE') return res.status(400).json({ error: 'not a WAV file' });
    if (!daily.canCallModel().ok) return res.status(503).json({ error: 'daily_model_budget', message: 'The demo has used its model budget for today.' });
    try { const r = await provider.transcribe(audio); daily.addModel(r.meta.costUsd); res.json({ text: r.value.text, model: { provider: r.meta.provider, model: r.meta.model } }); }
    catch (e) { res.status(502).json({ error: e.kind ?? 'provider_error', message: String(e.message).slice(0, 300) }); }
  });

  app.post('/api/compile', async (req, res) => {
    if (limited(req, res, 'compile')) return;
    const text = req.body?.text;
    if (typeof text !== 'string' || !text.trim() || text.length > 600) return res.status(400).json({ error: 'text must be 1 to 600 characters' });
    if (!daily.canCallModel().ok) return res.status(503).json({ error: 'daily_model_budget', message: 'The demo has used its model budget for today.' });
    const result = await compileRequest(text.trim(), { provider, ctx: ctxFor() });
    if (result.model?.costUsd) daily.addModel(result.model.costUsd);
    if (result.status === 'error') return res.status(502).json({ status: 'error', error: result.error_kind, message: result.message });
    const out = { status: result.status, model: result.model ? { provider: result.model.provider, model: result.model.model, latency_ms: result.model.latencyMs } : null };
    if (result.status === 'mandate') {
      const compile_id = newRunId();
      pending.set(compile_id, { result, expires: Date.now() + 10 * 60_000 });
      for (const [k, v] of pending) if (v.expires < Date.now()) pending.delete(k);
      Object.assign(out, { compile_id, readback: result.readback, limits: result.limits, item: result.item, defaults_applied: result.defaults_applied, mandate_id: result.mandate_id });
    } else if (result.status === 'clarify') Object.assign(out, { clarify_field: result.clarify_field, question: result.question });
    else Object.assign(out, { reject_code: result.reject_code, message: result.message });
    res.json(out);
  });

  app.post('/api/confirm', async (req, res) => {
    const id = req.body?.compile_id, check = req.body?.check_delivery !== false;
    const p = typeof id === 'string' ? pending.get(id) : null;
    if (!p || p.expires < Date.now()) return res.status(404).json({ error: 'unknown_or_expired_compile_id', message: 'Compile the request again.' });
    if (limited(req, res, 'run')) return;
    const total = Number(p.result.limits.total_cap_usdc);
    const g = daily.canStartRun(total);
    if (!g.ok) return res.status(503).json({ error: g.reason, message: 'The demo has reached its limit for today. It resets at 00:00 UTC.' });
    const run_id = id;
    if (!flight.tryStart(run_id)) return res.status(409).json({ error: 'busy', message: 'Another run is in progress (one at a time: each run replaces the single grant on the demo wallet). Try again in a minute.' });
    pending.delete(id);
    const state = { events: [], listeners: new Set(), done: false, report: null, error: null };
    runs.set(run_id, state);
    const push = (e) => { state.events.push(e); for (const l of state.listeners) l(e); };
    res.json({ run_id });
    (async () => {
      try {
        const report = await pipeline.run({ compiled: p.result, checkDelivery: check, runId: run_id, onEvent: push });
        try { report.revoke_tx = await chain.sendRevoke(keys.principal); report.revoke_url = explorerTx(report.revoke_tx); fs.writeFileSync(path.join(outDir, run_id, 'run.json'), JSON.stringify(report, null, 1)); push({ type: 'revoked', revoke_tx: report.revoke_tx, url: report.revoke_url }); } catch (e) { push({ type: 'revoke_failed', message: String(e.message).slice(0, 200) }); }
        state.report = report;
        daily.addModel(report.summary.model_cost_usd);
        daily.addRun(Number(report.summary.net_loss_usdc));
        for (const pu of report.purchases) if (pu.tx_sig) tx2run.set(pu.tx_sig, { run_id, n: pu.n });
      } catch (e) { state.error = String(e.message).slice(0, 400); push({ type: 'run_failed', message: state.error }); }
      finally { state.done = true; flight.end(run_id); push({ type: 'end' }); for (const l of state.listeners) l(null); }
    })();
  });

  app.get('/api/runs/:id/events', (req, res) => {
    const st = RUN_ID.test(req.params.id) ? runs.get(req.params.id) : null;
    if (!st) return res.status(404).json({ error: 'unknown_run' });
    res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
    res.flushHeaders();
    const send = (e) => res.write(`data: ${JSON.stringify(e)}\n\n`);
    for (const e of st.events) send(e);
    if (st.done) return res.end();
    const l = (e) => { if (e === null) { res.end(); } else send(e); };
    st.listeners.add(l);
    req.on('close', () => st.listeners.delete(l));
  });
  app.get('/api/runs/:id', (req, res) => {
    if (!RUN_ID.test(req.params.id)) return res.status(404).json({ error: 'unknown_run' });
    const st = runs.get(req.params.id);
    if (st?.report) return res.json(st.report);
    const f = path.join(outDir, req.params.id, 'run.json');
    if (fs.existsSync(f)) return res.json(JSON.parse(fs.readFileSync(f, 'utf8')));
    res.status(st ? 202 : 404).json({ error: st ? 'running' : 'unknown_run' });
  });
  app.get('/runs/:id/:file', (req, res) => {
    if (!RUN_ID.test(req.params.id) || !RUN_FILE.test(req.params.file)) return res.status(404).end();
    const f = path.join(outDir, req.params.id, req.params.file);
    if (!fs.existsSync(f)) return res.status(404).end();
    res.sendFile(f, { headers: { 'Cache-Control': 'public, max-age=3600' } });
  });

  // ---- the verdict page: the mask overlay next to the offer text, from the stored verdict and the run's files
  const tx2run = new Map();
  for (const d of fs.existsSync(outDir) ? fs.readdirSync(outDir) : []) { try { const r = JSON.parse(fs.readFileSync(path.join(outDir, d, 'run.json'), 'utf8')); for (const p of r.purchases ?? []) if (p.tx_sig) tx2run.set(p.tx_sig, { run_id: r.run_id, n: p.n }); } catch { /* not a run directory */ } }
  app.get('/v/:tx', (req, res) => {
    const row = /^[1-9A-HJ-NP-Za-km-z]{60,100}$/.test(req.params.tx) ? arbiter.stored(req.params.tx) : null;
    const ref = tx2run.get(req.params.tx);
    if (!row || !ref) return res.status(404).type('text/plain').send('No verdict stored for this payment.\n');
    const rec = JSON.parse(row.record_json), run = JSON.parse(fs.readFileSync(path.join(outDir, ref.run_id, 'run.json'), 'utf8')), p = run.purchases.find((x) => x.n === ref.n);
    const a = rec.checks.seg?.instances?.[0], full = rec.checks.full?.answer;
    res.type('html').send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Verdict</title><link rel="stylesheet" href="/app.css"></head><body class="verdict"><main>
<p class="eyebrow">Delivery verdict · Solana devnet</p>
<h1>${esc(row.verdict === 'valid' ? 'Dispute upheld: the seller is liable' : row.verdict === 'invalid' ? 'Dispute not upheld' : row.verdict)}</h1>
<dl class="facts"><dt>Outcome of the check</dt><dd>${esc(row.outcome)}</dd><dt>Reason</dt><dd>${esc(row.reason)}</dd><dt>Liable</dt><dd>${esc(row.liable)}</dd>
<dt>Payment</dt><dd><a href="${esc(explorerTx(req.params.tx))}" rel="noopener">${esc(req.params.tx.slice(0, 16))}…</a> (${esc(row.refund_amount ?? '')} base units of USDC)</dd>
<dt>Refund</dt><dd>${row.refund_tx ? `<a href="${esc(explorerTx(row.refund_tx))}" rel="noopener">${esc(row.refund_tx.slice(0, 16))}…</a>` : 'none'}</dd>
<dt>Evidence id</dt><dd><code>${esc(row.evidence_id)}</code> (<a href="/runs/${esc(ref.run_id)}/evidence-${ref.n}.json">JSON</a>)</dd></dl>
<section class="pair"><figure><figcaption>What the shop offered</figcaption><p class="offer"><b>${esc(rec.offer.title)}</b><br>${esc(rec.offer.description)}</p></figure>
<figure><figcaption>${esc(rec.overlay?.shows === 'observed' ? `What it delivered. Nothing matched the offer; mask of what was found instead: ${rec.checks.observed?.phrase ?? ''}` : rec.overlay?.shows === 'offered' ? 'What it delivered, with the mask of the offered item' : 'What it delivered. Nothing matching the offer was found')}</figcaption><img src="/runs/${esc(ref.run_id)}/${esc(p.overlay)}" alt="delivered image with the mask of the segmented object"></figure></section>
<p>The delivery check looked for <b>${esc(rec.spec.noun_phrase)}</b>. Segmentation found ${rec.checks.seg?.instances?.length ?? 0} match${rec.checks.seg?.instances?.length === 1 ? '' : 'es'}${a ? ` (best confidence ${esc(a.confidence ?? 'n/a')})` : ''}; the vision model saw <b>${esc(full?.observed_object ?? 'n/a')}</b> and answered <b>${esc(full?.matches_offer ?? 'n/a')}</b>. Models: ${esc(rec.checks.seg?.model?.model ?? '-')}, ${esc(rec.checks.full?.model?.model ?? '-')}.</p>
<p><a href="/">Run it yourself</a></p></main></body></html>`);
  });

  app.use(express.static(webDir, { extensions: ['html'], maxAge: '5m' }));
  return { app, daily, flight };
}
