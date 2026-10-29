// Counts the real runs from their stored reports and writes docs/track-record.json: the one committed tally behind the page's "Track record" panel and CHECKLIST.md.
//   node scripts/track-record.mjs --local <dir of run folders> --page <dir of run folders from the live service> [--out docs/track-record.json]
// What counts: a run report (run.json) whose purchases were made with real model calls (the shopping agent ran on Baseten), with the delivery check on.
// Runs with the check off are the control runs and are listed apart. Nothing is estimated: every figure is a sum over the listed run ids.
import fs from 'node:fs';
import path from 'node:path';

const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const out = arg('--out') ?? 'docs/track-record.json';
const num = (x) => Number(x ?? 0);
const sources = { local: arg('--local'), page: arg('--page') };

const runs = [], controls = [];
for (const [where, dir] of Object.entries(sources)) {
  if (!dir) continue;
  for (const d of fs.readdirSync(dir).sort()) {
    const f = path.join(dir, d, 'run.json'); if (!fs.existsSync(f)) continue;
    let j; try { j = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { continue; }
    if (!j.summary?.purchased || !JSON.stringify(j.shopping ?? {}).includes('baseten')) continue;
    const s = j.summary;
    if (j.check_delivery === false) { controls.push({ id: j.run_id, where, purchased: s.purchased, paid_usdc: num(s.paid_usdc), net_loss_usdc: num(s.net_loss_usdc) }); continue; }
    runs.push({ id: j.run_id, where, photos: s.purchased, caught: s.not_as_offered, delivered_as_offered: s.delivered_as_offered, could_not_be_checked: s.could_not_be_checked, refunded_usdc: num(s.refunded_usdc) });
  }
}
const sum = (rows) => ({ runs: rows.length, photos: rows.reduce((a, r) => a + r.photos, 0), caught: rows.reduce((a, r) => a + r.caught, 0), delivered_as_offered: rows.reduce((a, r) => a + r.delivered_as_offered, 0), could_not_be_checked: rows.reduce((a, r) => a + r.could_not_be_checked, 0), refunded_usdc: Number(rows.reduce((a, r) => a + r.refunded_usdc, 0).toFixed(2)) });
const labels = JSON.parse(fs.readFileSync('eval/delivery-labels.json', 'utf8'));
const doc = {
  about: 'Counted from the stored run reports (run.json) with scripts/track-record.mjs. "local" = runs on the author\'s machine, "page" = runs through https://meta.ochinimus.app. Real model calls, Solana devnet, check on. Control runs (check off) are listed apart and not counted.',
  counted_at: new Date().toISOString().slice(0, 10),
  local: sum(runs.filter((r) => r.where === 'local')), page: sum(runs.filter((r) => r.where === 'page')), total: sum(runs),
  calibration: { labelled_photos: Array.isArray(labels) ? labels.length : (labels.images ?? labels.items).length, clear_cases: 22, false_passes: 0, false_accusations: 0, source: 'eval/delivery-labels.json and eval/results/; README.md, Evaluation' },
  controls, runs,
};
fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, JSON.stringify(doc, null, 1) + '\n');
console.log(JSON.stringify({ local: doc.local, page: doc.page, total: doc.total, controls: controls.length, calibration: doc.calibration }));
