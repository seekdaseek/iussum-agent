// DEV STUBS: lets the live page and the money path be exercised with NO model key. Refused when DEMO=1. The page shows a red banner while they are active.
// None of this is model output: compile answers come from a tiny rule table (the oracle for the demo request), the shopper is the scripted test double, and the
// delivery check is a stub that knows the ground truth. Used only for engineering checks of the plumbing; never in the demo, the video or the evaluation.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { readSamResult } from '../../models/adapters/meta.js';
import { scriptedProvider } from '../agent/scripted.js';
import { ProviderError } from '../../models/errors.js';
import { segmentationHint } from '../../models/adapters/groundsam.js';

const SAM_SAMPLE = '<0f>0<|box;x1=211;y1=228;x2=270;y2=254;w=320;h=334|>' + "<|mask;x=0;y=0;data=27,60,~!!!!M!0c[0o91w?q1!pIH4pPRVp2B3'7`e.ioeAf6-k/#Xd8%dX9x(|>" + '\n';
const sha = (b) => createHash('sha256').update(b).digest('hex');
const answer = (matches_offer, confidence, extra = {}) => ({ observed_object: 'mug', observed_colour: 'red', observed_material: 'ceramic', matches_offer, violates_must_not: false, confidence, reason: 'dev stub', ...extra });

// Knobs to look at the page in the states that are hard to reach for real (env, dev stubs only):
//   DEV_WARM_MS=40000        the segmentation endpoint takes that long to wake (a cold start)
//   DEV_SEGMENT_MS=3000      every segmentation call takes that long
//   DEV_SEGMENT_FAIL=402|403|500|timeout|network   every segmentation call (and the warm-up) fails like that (402 = no credit left)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const failure = (kind) => kind === 'timeout' || kind === 'network' ? new ProviderError(kind, 'dev stub', { provider: 'dev-stub', job: 'segment' }) : new ProviderError('http', `HTTP ${kind}: dev stub`, { provider: 'dev-stub', job: 'segment', status: Number(kind) });
export function makeDevProvider({ catalogDir, shopIds, env = process.env }) {
  const advertised = new Set();
  for (const id of shopIds) for (const f of fs.readdirSync(path.join(catalogDir, id)).filter((f) => f.endsWith('.png') && !f.includes('delivered'))) advertised.add(sha(fs.readFileSync(path.join(catalogDir, id, f))));
  const meta = (job) => ({ provider: 'dev-stub', model: 'dev-stub', job, latencyMs: 0 });
  return {
    ledger: { summary: () => ({ calls: 0, spentUsd: 0, unpricedCalls: 0, stopAtUsd: 0 }) },
    adapterName: () => 'dev-stub',
    // a request that mentions "red ceramic mug" compiles to the oracle answer for it; anything else is a clarify so the page shows that path too
    async compileMandate(text, { system }) {
      const ids = [...system.matchAll(/id "([a-z]+)"/g)].map((m) => m[1]);
      const t = text.toLowerCase();
      const shops = ids.filter((id) => t.includes(id) || (id === 'kiln' && /kiln/.test(t)));
      const num = (re) => (re.exec(text)?.[1] ?? null);
      if (!/mug/.test(t)) return { value: { status: 'clarify', clarify_field: 'item', reject_code: null, total_cap_usdc: null, per_payment_max_usdc: null, valid_for_hours: null, shops: [], item: { noun_phrase: null, count: null, must_not: [] } }, meta: meta('compileMandate') };
      return { value: { status: 'mandate', clarify_field: null, reject_code: null, total_cap_usdc: num(/(\d+(?:\.\d+)?)\s*usdc\s*(?:in total|total|max)/i) ?? '2', per_payment_max_usdc: num(/at most (\d+(?:\.\d+)?)/i) ?? '0.80', valid_for_hours: /week/.test(t) ? 168 : 24, shops: shops.length ? shops : ['kiln', 'mugworks'], item: { noun_phrase: 'red ceramic mug', count: 3, must_not: [] } }, meta: meta('compileMandate') };
    },
    async transcribe() { return { value: { text: 'DEV STUB: no transcription happened', audioDurationMs: 0 }, meta: meta('transcribe') }; },
    async warmSegmenter() { await sleep(Number(env.DEV_WARM_MS ?? 0)); if (env.DEV_SEGMENT_FAIL) { const e = failure(env.DEV_SEGMENT_FAIL); return { ok: false, ms: Number(env.DEV_WARM_MS ?? 0), error: `${e.kind}: ${e.message}`, hint: segmentationHint(e) }; } return { ok: true, ms: Number(env.DEV_WARM_MS ?? 0) }; },
    async segment(img) { await sleep(Number(env.DEV_SEGMENT_MS ?? 0)); if (env.DEV_SEGMENT_FAIL) throw failure(env.DEV_SEGMENT_FAIL); return { value: await readSamResult(advertised.has(sha(img)) ? SAM_SAMPLE : ''), meta: meta('segment') }; },
    async vision(img) { return { value: advertised.has(sha(img)) ? answer('yes', 0.95) : answer('no', 0.95, { observed_object: 'drinking glass', observed_material: 'glass', observed_colour: null }), meta: meta('vision') }; },
    scripted: (args) => scriptedProvider(args),
  };
}
