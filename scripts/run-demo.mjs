// Drives the live server like a visitor: node scripts/run-demo.mjs [--control] [--base http://127.0.0.1:8791] ["request text"]
// Compiles the request, prints the read-back, confirms (or runs the control with the delivery check off), follows the events and prints the report.
const arg = (k) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : null);
const base = arg('--base') ?? 'http://127.0.0.1:8791', control = process.argv.includes('--control');
const text = process.argv.slice(2).filter((a, i, all) => !a.startsWith('--') && all[i - 1] !== '--base').pop() ?? 'Buy me three product photos of a red ceramic mug, under 2 USDC in total, at most 0.80 each, only from Kiln & Co and Mugworks, this week.';
const post = async (p, b) => { const r = await fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }); return { status: r.status, j: await r.json() }; };
const t0 = Date.now(), stamp = () => `${((Date.now() - t0) / 1000).toFixed(1).padStart(6)}s`;
const c = await post('/api/compile', { text });
console.log(`${stamp()} compile -> HTTP ${c.status} status=${c.j.status}${c.j.model ? ` (${c.j.model.provider} ${c.j.model.model}, ${c.j.model.latency_ms} ms)` : ''}`);
if (c.j.status !== 'mandate') { console.log(JSON.stringify(c.j)); process.exit(c.j.status === 'clarify' || c.j.status === 'reject' ? 0 : 1); }
console.log(c.j.readback);
const k = await post('/api/confirm', { compile_id: c.j.compile_id, check_delivery: !control });
if (k.status !== 200) { console.log('confirm failed', k.status, JSON.stringify(k.j)); process.exit(1); }
const res = await fetch(`${base}/api/runs/${k.j.run_id}/events`);
const dec = new TextDecoder(); let buf = '';
for await (const chunk of res.body) {
  buf += dec.decode(chunk, { stream: true });
  let i; while ((i = buf.indexOf('\n\n')) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 2); if (!line.startsWith('data: ')) continue; const e = JSON.parse(line.slice(6)); if (e.type !== 'end') console.log(`${stamp()} ${e.type}${e.n ? ` #${e.n}` : ''}${e.shop ? ` ${e.shop}` : ''}${e.sku ? `/${e.sku}` : ''}${e.outcome ? ` ${e.outcome}` : ''}${e.verdict ? ` ${e.verdict}/${e.reason}/${e.liable}` : ''}${e.message ? ` ${e.message}` : ''}`); }
}
const rep = await (await fetch(`${base}/api/runs/${k.j.run_id}`)).json();
console.log(`\nrun ${rep.run_id} shopping ended: ${rep.shopping?.ended} in ${rep.shopping?.steps} steps${rep.shopping?.error ? ` ERROR ${JSON.stringify(rep.shopping.error)}` : ''}`);
for (const p of rep.purchases ?? []) console.log(`  #${p.n} ${p.shop}/${p.sku} ${p.outcome}${p.outcome_code ? `(${p.outcome_code})` : ''}${p.verdict ? ` verdict=${p.verdict.verdict}/${p.verdict.liable}` : ''}${p.verdict?.refund_tx ? ' refund paid' : ''}${p.verdict?.refund_error ? ` REFUND ERROR ${p.verdict.refund_error}` : ''}`);
console.log('summary', JSON.stringify(rep.summary));
const st = await (await fetch(`${base}/api/status`)).json();
console.log('model spend', JSON.stringify(st.model_spend));
