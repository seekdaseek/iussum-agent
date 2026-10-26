// Baseten adapter for Meta's open weights (Muse Spark Open). UNTESTED: no Baseten key exists yet.
// Facts (docs.baseten.co, read 2026-10-26 by a research subagent, summaries not verified line by line):
//  - base URL https://inference.baseten.co/v1, POST /chat/completions, Authorization: Bearer <BASETEN_API_KEY>
//  - the event guide says to use model id meta-models/muse-spark-open-1026; the Baseten docs say meta-models/muse-spark-open. The -1026 id is UNCONFIRMED:
//    check GET /v1/models with the key before relying on it.
//  - Muse Spark Open has NO structured-output / JSON mode on Baseten: we prompt for JSON, extract it, and the caller validates it.
//  - images: content part { type: 'image_url', image_url: { url } } (base64 data URLs "supported", exact form unconfirmed)
//  - audio: content part { type: 'audio_url', audio_url: { url } } (data: URLs work), WAV/MP3/FLAC/OGG/M4A, up to 5 minutes
// Segmentation and image generation are not served here.
import { ProviderError, unsupported } from '../errors.js';
import { request, parseJson, dataUrl, extractJsonObject } from '../http.js';
import { parseStep } from './meta.js';

const NAME = 'baseten';

export function createBasetenAdapter({ apiKey, baseUrl = 'https://inference.baseten.co/v1', model = 'meta-models/muse-spark-open-1026', f = globalThis.fetch, timeoutMs = 120_000 } = {}) {
  if (!apiKey) throw new ProviderError('config', 'BASETEN_API_KEY is not set', { provider: NAME });
  const wrap = (job, value, r, usage) => ({ value, meta: { provider: NAME, model, job, latencyMs: r.latencyMs, requestId: r.requestId, usage: usage ?? null } });
  async function chat(job, messages) {
    const r = await request({ provider: NAME, job, url: `${baseUrl}/chat/completions`, headers: { authorization: `Bearer ${apiKey}` }, json: { model, messages, temperature: 0 }, timeoutMs, f });
    const j = parseJson(r.text, { provider: NAME, job });
    const content = j.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content) throw new ProviderError('parse', 'no message content', { provider: NAME, job, body: r.text.slice(0, 400) });
    return { content, usage: j.usage, r };
  }
  const jsonFrom = (job, content) => {
    const raw = extractJsonObject(content);
    if (!raw) throw new ProviderError('parse', 'no JSON object in the answer', { provider: NAME, job, body: content.slice(0, 400) });
    try { return JSON.parse(raw); } catch (e) { throw new ProviderError('parse', `JSON does not parse: ${e.message}`, { provider: NAME, job, body: raw.slice(0, 400) }); }
  };
  return {
    name: NAME,
    async transcribe(audio, { mime = 'audio/wav' } = {}) {
      const { content, usage, r } = await chat('transcribe', [{ role: 'user', content: [{ type: 'text', text: 'Transcribe this audio. Answer with the transcript only, no commentary.' }, { type: 'audio_url', audio_url: { url: dataUrl(audio, mime) } }] }]);
      return wrap('transcribe', { text: content.trim(), audioDurationMs: null }, r, usage);
    },
    async compileMandate(text, { system, schema }) {
      const sys = `${system}\n\nAnswer with ONE JSON object and nothing else, matching this JSON Schema:\n${JSON.stringify(schema)}`;
      const { content, usage, r } = await chat('compileMandate', [{ role: 'system', content: sys }, { role: 'user', content: text }]);
      return wrap('compileMandate', jsonFrom('compileMandate', content), r, usage);
    },
    async vision(image, question, { mime = 'image/png', schema, system } = {}) {
      const q = schema ? `${question}\n\nAnswer with ONE JSON object and nothing else, matching this JSON Schema:\n${JSON.stringify(schema)}` : question;
      const { content, usage, r } = await chat('vision', [...(system ? [{ role: 'system', content: system }] : []), { role: 'user', content: [{ type: 'text', text: q }, { type: 'image_url', image_url: { url: dataUrl(image, mime) } }] }]);
      return wrap('vision', schema ? jsonFrom('vision', content) : content, r, usage);
    },
    // Tool calling is documented for Baseten Model APIs in general; the request shape below is the OpenAI-compatible one and is UNTESTED for Muse Spark Open.
    async agentStep(messages, tools) {
      const r = await request({ provider: NAME, job: 'agentStep', url: `${baseUrl}/chat/completions`, headers: { authorization: `Bearer ${apiKey}` }, json: { model, messages, tools, tool_choice: 'auto', temperature: 0 }, timeoutMs, f });
      const j = parseJson(r.text, { provider: NAME, job: 'agentStep' });
      return wrap('agentStep', parseStep(j, 'agentStep', NAME), r, j.usage);
    },
    async segment() { throw unsupported(NAME, 'segment'); },
    async generateImage() { throw unsupported(NAME, 'generateImage'); },
    async editImage() { throw unsupported(NAME, 'editImage'); },
  };
}
