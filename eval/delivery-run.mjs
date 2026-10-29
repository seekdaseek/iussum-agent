// Runs the REAL delivery check on the labelled set and prints the confusion table: node --env-file=.env eval/delivery-run.mjs [--seg-conf 0.5] [--vis-conf 0.7] [--limit N]
// Providers from env (MODEL_PROVIDER=baseten MODEL_PROVIDER_SEGMENT=ground|groundsam, BASETEN_EFFORT_*). Refuses the fixture/stub adapters. Writes eval/results/delivery-<provider>-<ts>.json.
import fs from 'node:fs';
import { createProvider } from '../models/provider.js';
import { runDeliveryCheck } from '../src/evidence/check.js';
import { THRESHOLDS, applyRule } from '../src/evidence/rule.js';

const arg = (k, d) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : d);
const spec = JSON.parse(fs.readFileSync(new URL('./delivery-labels.json', import.meta.url), 'utf8'));
const thresholds = { segMinConfidence: Number(arg('--seg-conf', THRESHOLDS.segMinConfidence)), visionMinConfidence: Number(arg('--vis-conf', THRESHOLDS.visionMinConfidence)) };
const provider = createProvider();
const names = { segment: provider.adapterName('segment'), vision: provider.adapterName('vision') };
if (Object.values(names).some((n) => n === 'fixture')) { console.error('refusing: a fixture adapter is selected'); process.exit(2); }
const images = spec.images.slice(0, Number(arg('--limit', spec.images.length)));
const dir = new URL('../data/delivery-set/', import.meta.url);
const rows = [];
let next = 0;
async function worker() {
  while (next < images.length) {
    const im = images[next++];
    const file = new URL(`${im.id}.png`, dir);
    if (!fs.existsSync(file)) { rows.push({ id: im.id, label: im.label, error: 'image not downloaded' }); continue; }
    const run = await runDeliveryCheck({ provider, image: fs.readFileSync(file), offer: { shop: 'calibration', sku: im.id, title: spec.offer.title, description: spec.offer.description }, spec: { noun_phrase: spec.noun_phrase, must_not: [] }, thresholds });
    rows.push({ id: im.id, label: im.label, note: im.note, outcome: run.rule.outcome, code: run.rule.code, facts: run.rule.facts ?? null, checks: run.checks, took_ms: run.took_ms });
    console.log(`${im.id} ${im.label.padEnd(15)} -> ${run.rule.outcome.padEnd(21)} ${run.rule.code}  seg=${run.checks.seg?.error ? 'ERR' : run.checks.seg.instances.length} full=${run.checks.full?.answer?.matches_offer ?? 'ERR'}/${run.checks.full?.answer?.confidence ?? '-'} crop=${run.checks.crop?.answer?.matches_offer ?? '-'}  ${run.took_ms} ms`);
  }
}
await Promise.all([worker(), worker(), worker(), worker()]);
rows.sort((a, b) => a.id.localeCompare(b.id));
const OUT = ['DELIVERED_AS_OFFERED', 'NOT_AS_OFFERED', 'COULD_NOT_BE_CHECKED'], LAB = ['as_offered', 'not_as_offered', 'unclear'];
console.log(`\nConfusion (rows = my label, columns = outcome)  thresholds ${JSON.stringify(thresholds)}  segment=${names.segment} vision=${names.vision}`);
console.log(`${''.padEnd(16)}${OUT.map((o) => o.slice(0, 12).padStart(14)).join('')}`);
for (const l of LAB) console.log(`${l.padEnd(16)}${OUT.map((o) => String(rows.filter((r) => r.label === l && r.outcome === o).length).padStart(14)).join('')}`);
const falsePass = rows.filter((r) => r.label === 'not_as_offered' && r.outcome === 'DELIVERED_AS_OFFERED'), falseAccuse = rows.filter((r) => r.label === 'as_offered' && r.outcome === 'NOT_AS_OFFERED');
console.log(`false pass (not_as_offered -> DELIVERED): ${falsePass.length} ${falsePass.map((r) => r.id).join(' ')}`);
console.log(`false accusation (as_offered -> NOT_AS_OFFERED): ${falseAccuse.length} ${falseAccuse.map((r) => r.id).join(' ')}`);
console.log(`errors: ${rows.filter((r) => r.checks && (r.checks.seg?.error || r.checks.full?.error || r.checks.crop?.error)).length}; spend ${JSON.stringify(provider.ledger.summary())}`);
const out = { when: new Date().toISOString(), providers: names, thresholds, efforts: { ground: process.env.BASETEN_EFFORT_GROUND ?? process.env.BASETEN_EFFORT ?? 'default', vision: process.env.BASETEN_EFFORT_VISION ?? process.env.BASETEN_EFFORT ?? 'default' }, rows };
fs.mkdirSync(new URL('./results/', import.meta.url), { recursive: true });
fs.writeFileSync(new URL(`./results/delivery-${names.segment}-${out.when.replace(/[:.]/g, '-')}.json`, import.meta.url), JSON.stringify(out, null, 1));
