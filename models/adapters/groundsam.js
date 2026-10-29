// Segmentation path B (open weights end to end, no gated model): Muse Spark Open grounds the noun phrase to boxes, then SAM 2.1 (Apache-2.0, ungated, on Modal)
// turns each box into a mask. Serves `segment` only. The grounding half is REAL (observed 2026-10-29: pixel boxes on the real catalogue photos, "found": false for a
// glass when asked for a red ceramic mug). The SAM 2.1 half (modal/sam2_app.py) is UNTESTED until it is deployed.
//
// segment(image, phrase) -> the same shape as the Meta SAM adapter: { rawOutput, frame, instances[{ id, box (half-open), confidence, mask, areaPx }], diagnostics }
//   confidence = SAM 2.1's predicted IoU for the mask (a mask-quality score). The grounding model gives no detection confidence, and none is invented.
//   rawOutput  = JSON { ground: <the model's answer>, sam: { model, boxes, scores } }, kept in the evidence record so the box and the scores can be inspected.
// Modal wire format: POST { image_b64, boxes: [[x1,y1,x2,y2]...] } -> { model, width, height, instances: [{ box, score, mask_png_b64 }] }
import sharp from 'sharp';
import { ProviderError, unsupported } from '../errors.js';
import { request, parseJson } from '../http.js';

const NAME = 'baseten+modal';
const NAME_GROUND_ONLY = 'baseten-ground';
export const GROUND_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['found', 'boxes'],
  properties: { found: { type: 'boolean' }, boxes: { type: 'array', maxItems: 5, items: { type: 'object', additionalProperties: false, required: ['x1', 'y1', 'x2', 'y2'], properties: { x1: { type: 'number' }, y1: { type: 'number' }, x2: { type: 'number' }, y2: { type: 'number' } } } } },
};
export const groundQuestion = (w, h, phrase) => `The image is ${w} pixels wide and ${h} pixels tall. Find every "${phrase}" in the image (at most 5). Answer with ONE JSON object: {"found": true|false, "boxes": [{"x1": left, "y1": top, "x2": right, "y2": bottom}, ...]} in PIXELS of this image, origin top-left. If there is no "${phrase}" in the image, answer {"found": false, "boxes": []}. Judge the object itself, including its colour and material: a clear glass is not a "red ceramic mug".`;

// Boxes from a model are untrusted numbers: keep only finite boxes inside the image with positive area (clipped), at most 5.
export function cleanBoxes(boxes, w, h) {
  const out = [];
  for (const b of boxes ?? []) {
    const v = [b.x1, b.y1, b.x2, b.y2];
    if (!v.every(Number.isFinite)) continue;
    const x1 = Math.max(0, Math.floor(Math.min(b.x1, b.x2))), y1 = Math.max(0, Math.floor(Math.min(b.y1, b.y2))), x2 = Math.min(w, Math.ceil(Math.max(b.x1, b.x2))), y2 = Math.min(h, Math.ceil(Math.max(b.y1, b.y2)));
    if (x2 - x1 >= 4 && y2 - y1 >= 4) out.push([x1, y1, x2, y2]);
    if (out.length === 5) break;
  }
  return out;
}

// maskless: path C. No SAM at all: the boxes come from Muse Spark Open only and instances carry no mask (mask null, areaPx null, confidence null). The README must
// then say "vision grounding", never "segmentation".
export function createGroundSamAdapter({ ground, url, token, f = globalThis.fetch, timeoutMs = 120_000, maskless = false }) {
  if (!url && !maskless) throw new ProviderError('config', 'MODAL_SAM2_URL is not set', { provider: NAME });
  const no = (job) => async () => { throw unsupported(NAME, job); };
  return {
    name: maskless ? NAME_GROUND_ONLY : NAME,
    async segment(image, phrase, { mime = 'image/png' } = {}) {
      const { width: w, height: h } = await sharp(image).metadata();
      const g = await ground.vision(image, groundQuestion(w, h, phrase), { mime, schema: GROUND_SCHEMA, job: 'ground' });
      const ans = g.value;
      if (typeof ans.found !== 'boolean' || !Array.isArray(ans.boxes)) throw new ProviderError('parse', 'grounding answer has no found/boxes', { provider: NAME, job: 'segment', body: JSON.stringify(ans).slice(0, 300) });
      const boxes = ans.found ? cleanBoxes(ans.boxes, w, h) : [];
      const common = { provider: maskless ? NAME_GROUND_ONLY : NAME, model: g.meta.model, job: 'segment', usage: g.meta.usage, latencyMs: g.meta.latencyMs, reasoningEffort: g.meta.reasoningEffort, reasoningTokens: g.meta.reasoningTokens, groundJob: 'ground' };
      if (boxes.length === 0) return { value: { rawOutput: JSON.stringify({ ground: ans, sam: null }), frame: { w, h }, instances: [], diagnostics: ans.found ? [{ severity: 'warning', code: 'no_valid_box', message: 'the grounding model said found but gave no usable box' }] : [] }, meta: { ...common, images: 0 } };
      if (maskless) return { value: { rawOutput: JSON.stringify({ ground: ans, sam: null }), frame: { w, h }, instances: boxes.map(([x1, y1, x2, y2], i) => ({ id: String(i), box: { x1, y1, x2, y2 }, confidence: null, mask: null, areaPx: null })), diagnostics: [] }, meta: { ...common, images: 0 } };
      const r = await request({ provider: NAME, job: 'segment', url, headers: token ? { authorization: `Bearer ${token}` } : {}, json: { image_b64: Buffer.from(image).toString('base64'), boxes }, timeoutMs, f });
      const j = parseJson(r.text, { provider: NAME, job: 'segment' });
      if (!Array.isArray(j.instances) || j.instances.length !== boxes.length || j.width !== w || j.height !== h) throw new ProviderError('parse', 'the SAM 2.1 endpoint answered something other than one mask per box at the image size', { provider: NAME, job: 'segment', body: r.text.slice(0, 300) });
      const instances = [];
      for (const [i, it] of j.instances.entries()) {
        const { data, info } = await sharp(Buffer.from(it.mask_png_b64, 'base64')).greyscale().raw().toBuffer({ resolveWithObject: true });
        if (info.width !== w || info.height !== h) throw new ProviderError('parse', 'a mask does not have the image size', { provider: NAME, job: 'segment' });
        const bits = new Uint8Array(info.width * info.height); let areaPx = 0;
        for (let k = 0; k < bits.length; k++) { const on = data[k] >= 128 ? 1 : 0; bits[k] = on; areaPx += on; }
        const [x1, y1, x2, y2] = boxes[i];
        instances.push({ id: String(i), box: { x1, y1, x2, y2 }, confidence: Number.isFinite(it.score) ? it.score : null, mask: { left: 0, top: 0, right: w, bottom: h, width: w, height: h, bits }, areaPx });
      }
      return { value: { rawOutput: JSON.stringify({ ground: ans, sam: { model: j.model, boxes, scores: j.instances.map((x) => x.score) } }), frame: { w, h }, instances, diagnostics: [] }, meta: { ...common, sam: j.model, samLatencyMs: r.latencyMs, images: 1 } };
    },
    transcribe: no('transcribe'), compileMandate: no('compileMandate'), vision: no('vision'), agentStep: no('agentStep'), generateImage: no('generateImage'), editImage: no('editImage'),
  };
}
