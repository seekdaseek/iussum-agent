// Meta Model API adapter. Request shapes are read from dev.meta.ai/docs on 2026-10-26 (models, structured-output, image-understanding,
// image-generation, media-segmentation, sam/reading-segmentation, voice transcribe + schemas). NO call has been made with a key yet: every
// request body below is UNTESTED against the live service. Tests pin the shapes we send, not the service's behaviour.
import { ProviderError } from '../errors.js';
import { request, parseJson, dataUrl } from '../http.js';
import { parseImageStream, recordsOfKind, decodeMaskToRaster } from '@meta-sam/parser';

const NAME = 'meta';
export const META_MODELS = { chat: 'muse-spark-1.3', asr: 'muse-voice-transcribe-1.0', sam: 'sam-3.1', image: 'muse-image-1.0' };

export function createMetaAdapter({ apiKey, baseUrl = 'https://api.meta.ai/v1', f = globalThis.fetch, timeoutMs = 90_000, models = META_MODELS } = {}) {
  if (!apiKey) throw new ProviderError('config', 'MODEL_API_KEY is not set', { provider: NAME });
  const auth = { authorization: `Bearer ${apiKey}` };
  const call = (job, path, opts) => request({ provider: NAME, job, url: `${baseUrl}${path}`, headers: { ...auth, ...(opts.headers ?? {}) }, timeoutMs, f, ...opts });
  const wrap = (job, model, value, r, extra = {}) => ({ value, meta: { provider: NAME, model, job, latencyMs: r.latencyMs, requestId: r.requestId, ...extra } });

  async function chat(job, messages, { schema, schemaName = 'result', maxTokens } = {}) {
    const body = { model: models.chat, messages, ...(maxTokens ? { max_tokens: maxTokens } : {}) };
    if (schema) body.response_format = { type: 'json_schema', json_schema: { name: schemaName, schema } };
    const r = await call(job, '/chat/completions', { json: body });
    const j = parseJson(r.text, { provider: NAME, job });
    const msg = j.choices?.[0]?.message;
    if (msg?.refusal) throw new ProviderError('refusal', String(msg.refusal).slice(0, 300), { provider: NAME, job });
    const content = msg?.content;
    if (typeof content !== 'string' || content.length === 0) throw new ProviderError('parse', 'no message content in the response', { provider: NAME, job, body: r.text.slice(0, 400) });
    return { content, usage: j.usage ?? null, r };
  }
  const asJson = (job, content) => { try { return JSON.parse(content); } catch (e) { throw new ProviderError('parse', `structured output is not JSON: ${e.message}`, { provider: NAME, job, body: content.slice(0, 400) }); } };

  return {
    name: NAME,
    // audio: WAV bytes, mono PCM 16 or 24 kHz (the only encoding the endpoint documents). Response: { transcript, audioDurationMs, turns }.
    async transcribe(audio, { languageBias, keywords } = {}) {
      const form = new FormData();
      form.append('request', new Blob([JSON.stringify({ model: models.asr, audioEncoding: 'WAV', mode: 'PUSH_TO_TALK', ...(languageBias ? { languageBias } : {}), ...(keywords ? { keywords } : {}) })], { type: 'application/json' }), 'request.json');
      form.append('audio', new Blob([audio], { type: 'audio/wav' }), 'audio.wav');
      const r = await call('transcribe', '/asr/transcribe', { body: form, headers: { accept: 'application/json' } });
      const j = parseJson(r.text, { provider: NAME, job: 'transcribe' });
      if (typeof j.transcript !== 'string') throw new ProviderError('parse', 'no transcript field', { provider: NAME, job: 'transcribe', body: r.text.slice(0, 400) });
      return wrap('transcribe', models.asr, { text: j.transcript, audioDurationMs: j.audioDurationMs ?? null }, r, { audioMs: j.audioDurationMs ?? 0 });
    },
    // text -> structured JSON. system and schema come from the caller (src/intent): this adapter knows nothing about mandates.
    async compileMandate(text, { system, schema, schemaName = 'intent' }) {
      const { content, usage, r } = await chat('compileMandate', [{ role: 'system', content: system }, { role: 'user', content: text }], { schema, schemaName });
      return wrap('compileMandate', models.chat, asJson('compileMandate', content), r, { usage });
    },
    // image + question -> JSON when a schema is given, else text.
    async vision(image, question, { mime = 'image/png', schema, schemaName = 'check', system } = {}) {
      const user = { role: 'user', content: [{ type: 'text', text: question }, { type: 'image_url', image_url: { url: dataUrl(image, mime) } }] };
      const { content, usage, r } = await chat('vision', [...(system ? [{ role: 'system', content: system }] : []), user], { schema, schemaName });
      return wrap('vision', models.chat, schema ? asJson('vision', content) : content, r, { usage });
    },
    // noun phrase + image -> instances. Responses API, `input_text` + `input_image`; the answer is special-token text parsed by @meta-sam/parser.
    // Whether a base64 data URL is accepted for sam-3.1 is NOT documented (docs show an https URL): a 400 here is reported as is.
    async segment(image, phrase, { mime = 'image/png' } = {}) {
      const body = { model: models.sam, input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: phrase }, { type: 'input_image', image_url: dataUrl(image, mime) }] }], metadata: { include_confidence: 'true', mask_encoding: 'lossless' } };
      const r = await call('segment', '/responses', { json: body });
      const j = parseJson(r.text, { provider: NAME, job: 'segment' });
      if (!Array.isArray(j.output)) throw new ProviderError('parse', 'no output array in the response', { provider: NAME, job: 'segment', body: r.text.slice(0, 400) });
      const text = j.output.filter((o) => o.type === 'message').flatMap((o) => o.content ?? []).filter((c) => c.type === 'output_text').map((c) => c.text).join(''); // empty = zero matches, not an error
      return wrap('segment', models.sam, await readSamResult(text), r, { images: 1 });
    },
    async generateImage(prompt, { size = '1024x1024' } = {}) {
      const r = await call('generateImage', '/images/generations', { json: { model: models.image, prompt, n: 1, size, response_format: 'b64_json', output_format: 'png' } });
      const j = parseJson(r.text, { provider: NAME, job: 'generateImage' });
      const b64 = j.data?.[0]?.b64_json;
      if (!b64) throw new ProviderError('parse', 'no data[0].b64_json', { provider: NAME, job: 'generateImage', body: r.text.slice(0, 400) });
      return wrap('generateImage', models.image, { png: Buffer.from(b64, 'base64') }, r, { images: 1 });
    },
    // The Meta-specific JSON form: an `images` array of { image_url } (public URL or base64 data URL). Must be application/json (else 415).
    async editImage(image, prompt, { mime = 'image/png', size } = {}) {
      const r = await call('editImage', '/images/edits', { json: { model: models.image, prompt, images: [{ image_url: dataUrl(image, mime) }], n: 1, response_format: 'b64_json', output_format: 'png', ...(size ? { size } : {}) } });
      const j = parseJson(r.text, { provider: NAME, job: 'editImage' });
      const b64 = j.data?.[0]?.b64_json;
      if (!b64) throw new ProviderError('parse', 'no data[0].b64_json', { provider: NAME, job: 'editImage', body: r.text.slice(0, 400) });
      return wrap('editImage', models.image, { png: Buffer.from(b64, 'base64') }, r, { images: 1 });
    },
  };
}

// Parse the SAM answer text with Meta's own parser. Normalised result, shared with the Modal adapter:
// Boxes are HALF-OPEN source-pixel edges [x1,x2) x [y1,y2), as @meta-sam/parser normalises them (the token x2=270 arrives as 271); the Modal endpoint must return the same.
// { rawOutput, instances: [{ id, box: {x1,y1,x2,y2}, confidence|null, mask: {left,top,right,bottom,width,height,bits(Uint8Array 0/1)}, areaPx }], diagnostics }
export async function readSamResult(text) {
  const stream = parseImageStream((async function* () {
    const lane = { item_id: 'm', output_index: 0, content_index: 0 };
    if (text) yield { type: 'response.output_text.delta', ...lane, delta: text };
    yield { type: 'response.output_text.done', ...lane, text }; // an empty lane (zero matches) is still a finalized lane
    yield { type: 'response.completed' };
  })());
  const res = await stream.finalResult;
  if (res.outcome?.status !== 'completed') throw new ProviderError('parse', `SAM answer did not complete: ${JSON.stringify(res.outcome)}`, { provider: NAME, job: 'segment', body: text.slice(0, 400) });
  const boxes = new Map(recordsOfKind(res.records, 'box').map((b) => [b.objectId, b]));
  const instances = [];
  for (const m of recordsOfKind(res.records, 'mask')) {
    const b = boxes.get(m.objectId);
    const bits = decodeMaskToRaster(m.mask);
    let areaPx = 0; for (const v of bits) areaPx += v;
    instances.push({ id: m.objectId, box: b ? { x1: b.left, y1: b.top, x2: b.right, y2: b.bottom } : { x1: m.bounds.left, y1: m.bounds.top, x2: m.bounds.right, y2: m.bounds.bottom }, confidence: m.confidence ?? b?.confidence ?? null, mask: { ...m.bounds, width: m.mask.width, height: m.mask.height, bits }, areaPx });
  }
  return { rawOutput: text, instances, diagnostics: res.diagnostics ?? [] };
}
