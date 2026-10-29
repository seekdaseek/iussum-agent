// Modal adapter, path A: SAM 3 open weights (facebook/sam3; SAM 3.1 is a drop-in once its gated access is granted) behind OUR OWN Modal web endpoint
// (modal/sam3_app.py). The phrase goes in, instance masks come out. It serves segmentation only.
//
// Wire format of our endpoint (we define it, so it is documented here, not guessed):
//   POST MODAL_SAM_URL  { image_b64, phrase }  with  Authorization: Bearer <MODAL_SAM_TOKEN>
//   -> { model, instances: [{ box: [x1,y1,x2,y2] (half-open pixel edges), score, mask_png_b64 }], width, height }   mask_png_b64 = full-frame 8-bit PNG, 255 = inside
import sharp from 'sharp';
import { ProviderError, unsupported } from '../errors.js';
import { request, parseJson } from '../http.js';
import { segmentationHint } from './groundsam.js';

const NAME = 'modal';

export function createModalAdapter({ url, token, f = globalThis.fetch, timeoutMs = 120_000 } = {}) {
  if (!url) throw new ProviderError('config', 'MODAL_SAM_URL is not set', { provider: NAME });
  const no = (job) => async () => { throw unsupported(NAME, job); };
  return {
    name: NAME,
    async segment(image, phrase) {
      const r = await request({ provider: NAME, job: 'segment', url, headers: token ? { authorization: `Bearer ${token}` } : {}, json: { image_b64: Buffer.from(image).toString('base64'), phrase }, timeoutMs, f });
      const j = parseJson(r.text, { provider: NAME, job: 'segment' });
      if (!Array.isArray(j.instances) || !Number.isInteger(j.width) || !Number.isInteger(j.height)) throw new ProviderError('parse', 'unexpected response shape', { provider: NAME, job: 'segment', body: r.text.slice(0, 400) });
      const instances = [];
      for (const [i, it] of j.instances.entries()) {
        const { data, info } = await sharp(Buffer.from(it.mask_png_b64, 'base64')).greyscale().raw().toBuffer({ resolveWithObject: true });
        const bits = new Uint8Array(info.width * info.height); let areaPx = 0;
        for (let k = 0; k < bits.length; k++) { const on = data[k] >= 128 ? 1 : 0; bits[k] = on; areaPx += on; }
        const [x1, y1, x2, y2] = it.box;
        instances.push({ id: String(i), box: { x1, y1, x2, y2 }, confidence: it.score ?? null, mask: { left: 0, top: 0, right: info.width, bottom: info.height, width: info.width, height: info.height, bits }, areaPx });
      }
      return { value: { rawOutput: r.text, frame: { w: j.width, h: j.height }, instances, diagnostics: [] }, meta: { provider: NAME, model: j.model ?? 'sam3.1-open-weights', job: 'segment', latencyMs: r.latencyMs, requestId: r.requestId, images: 1 } };
    },
    async warm() { // same idea as groundsam.warm(): wake the SAM 3 container with a tiny image
      const t0 = Date.now();
      try {
        const img = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#888' } }).png().toBuffer();
        parseJson((await request({ provider: NAME, job: 'segment', url, headers: token ? { authorization: `Bearer ${token}` } : {}, json: { image_b64: img.toString('base64'), phrase: 'object' }, timeoutMs: 240_000, f })).text, { provider: NAME, job: 'segment' });
        return { ok: true, ms: Date.now() - t0 };
      } catch (e) { return { ok: false, ms: Date.now() - t0, error: `${e.kind ?? e.name}: ${String(e.message).slice(0, 200)}`, hint: segmentationHint(e) }; }
    },
    transcribe: no('transcribe'), compileMandate: no('compileMandate'), vision: no('vision'), agentStep: no('agentStep'), generateImage: no('generateImage'), editImage: no('editImage'),
  };
}
