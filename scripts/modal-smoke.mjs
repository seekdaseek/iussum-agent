// Calls a deployed SAM endpoint with 3 catalogue photos and known boxes (from the grounding experiment), saves the mask overlays and prints latency.
//   node --env-file=.env scripts/modal-smoke.mjs <url> [boxes|phrase]     boxes: SAM 2.1 endpoint (box prompt)   phrase: SAM 3 endpoint (noun-phrase prompt)
import fs from 'node:fs';
import sharp from 'sharp';
import { makeOverlay } from '../src/evidence/overlay.js';
import { readSamResult } from '../models/adapters/meta.js';
const [url, mode = 'boxes'] = process.argv.slice(2);
const cases = [['mug1', 'red ceramic mug', [[168, 485, 472, 830]]], ['mug3', 'red ceramic mug', [[0, 28, 672, 762]]], ['glass2', 'clear glass tumbler', [[200, 285, 570, 740]]]];
fs.mkdirSync('data/modal-smoke', { recursive: true });
for (const [name, phrase, boxes] of cases) {
  const img = fs.readFileSync(`assets/photos/${name}.png`);
  const body = mode === 'phrase' ? { image_b64: img.toString('base64'), phrase } : { image_b64: img.toString('base64'), boxes };
  const t0 = Date.now();
  const r = await fetch(url, { method: 'POST', headers: { authorization: `Bearer ${process.env.MODAL_SAM_TOKEN}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const ms = Date.now() - t0, text = await r.text();
  if (!r.ok) { console.log(`${name}: HTTP ${r.status} ${ms} ms ${text.slice(0, 300)}`); continue; }
  const j = JSON.parse(text);
  const inst = j.instances.map((it, i) => ({ id: String(i), box: { x1: it.box[0], y1: it.box[1], x2: it.box[2], y2: it.box[3] }, confidence: it.score, mask: null }));
  const m = j.instances[0] && await sharp(Buffer.from(j.instances[0].mask_png_b64, 'base64')).greyscale().raw().toBuffer({ resolveWithObject: true });
  let area = 0; if (m) for (const v of m.data) if (v >= 128) area++;
  console.log(`${name} "${phrase}" [${mode}] HTTP ${r.status} ${ms} ms  model=${j.model} instances=${j.instances.length} score=${j.instances[0]?.score?.toFixed?.(3)} maskArea=${area} (${m ? (100 * area / (m.info.width * m.info.height)).toFixed(1) : '-'}% of image)`);
  if (m) { const bits = new Uint8Array(m.data.length); for (let k = 0; k < bits.length; k++) bits[k] = m.data[k] >= 128 ? 1 : 0; const o = await makeOverlay(img, { instance: { box: inst[0].box, mask: { left: 0, top: 0, right: m.info.width, bottom: m.info.height, width: m.info.width, height: m.info.height, bits } }, frame: { w: m.info.width, h: m.info.height } }); fs.writeFileSync(`data/modal-smoke/${mode}-${name}.png`, o.png); }
}
