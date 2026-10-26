// Modal adapter: SAM 3.1 open weights behind OUR OWN Modal web endpoint (modal/sam_app.py). It serves segmentation only. UNTESTED: no Modal account, no
// deployed endpoint, no Hugging Face access to the gated weights yet (facebook/sam3.1, SAM License of 2025-11-19, see models/PROVIDERS.md).
//
// Wire format of our endpoint (we define it, so it is documented here, not guessed):
//   POST MODAL_SAM_URL  { image_b64, phrase }  with  Authorization: Bearer <MODAL_SAM_TOKEN>
//   -> { model, instances: [{ box: [x1,y1,x2,y2] (half-open pixel edges), score, mask_png_b64 }], width, height }   mask_png_b64 = full-frame 8-bit PNG, 255 = inside
import sharp from 'sharp';
import { ProviderError, unsupported } from '../errors.js';
import { request, parseJson } from '../http.js';

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
      return { value: { rawOutput: r.text, instances, diagnostics: [] }, meta: { provider: NAME, model: j.model ?? 'sam3.1-open-weights', job: 'segment', latencyMs: r.latencyMs, requestId: r.requestId, images: 1 } };
    },
    transcribe: no('transcribe'), compileMandate: no('compileMandate'), vision: no('vision'), generateImage: no('generateImage'), editImage: no('editImage'),
  };
}
