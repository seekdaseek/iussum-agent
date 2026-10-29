// Baseten adapter for Meta's open weights (Muse Spark Open, model id meta-models/muse-spark-open-1026). Shapes below were OBSERVED with a real key on
// 2026-10-29 (scripts/baseten-smoke.mjs, raw responses in data/smoke/); anything still unobserved is marked.
//  - POST https://inference.baseten.co/v1/chat/completions, Authorization: Bearer <BASETEN_API_KEY>; GET /v1/models lists both
//    meta-models/muse-spark-open and meta-models/muse-spark-open-1026 ("[HACKATHON] Muse Spark Open"), context 1,048,576, fp4, features tools + json_mode + reasoning,
//    input modalities listed as text and image (audio is accepted anyway, see below), price $1.25 / $4.25 per 1M prompt / completion tokens, cached prompt $0.15.
//  - reasoning is always on: the answer is message.content, the reasoning message.reasoning_content, and completion_tokens INCLUDES the reasoning tokens.
//    reasoning_effort: low | medium | high | xhigh (default xhigh). max_tokens caps reasoning + answer, so finish_reason "length" = a cut answer = an error here.
//  - response_format {type:'json_object'} and {type:'json_schema'} are both accepted (HTTP 200). We use json_object plus the schema in the prompt and validate in code.
//  - images: { type:'image_url', image_url:{ url:'data:image/png;base64,...' } } works.   audio: { type:'audio_url', audio_url:{ url:'data:audio/wav;base64,...' } } works
//    (transcription is a prompt to the model, not an endpoint).   tools: native OpenAI-style tool_calls (finish_reason 'tool_calls', arguments is a JSON string).
// Segmentation and image generation are not served here.
import { ProviderError, unsupported } from '../errors.js';
import { request, parseJson, dataUrl, extractJsonObject } from '../http.js';
import { parseStep } from './meta.js';

const NAME = 'baseten';
export const BASETEN_MODEL = 'meta-models/muse-spark-open-1026';
// starting values from the 2026-10-29 smoke test; scripts and the eval can override per job with BASETEN_EFFORT_<JOB> / BASETEN_MAX_TOKENS_<JOB>
export const DEFAULT_EFFORT = { transcribe: 'low', compileMandate: 'low', vision: 'medium', agentStep: 'low', ground: 'medium' };
export const DEFAULT_MAX_TOKENS = { transcribe: 3000, compileMandate: 4000, vision: 6000, agentStep: 4000, ground: 6000 };
const EFFORTS = ['low', 'medium', 'high', 'xhigh'];

export function createBasetenAdapter({ apiKey, baseUrl = 'https://inference.baseten.co/v1', model = BASETEN_MODEL, f = globalThis.fetch, timeoutMs = 180_000, effort = {}, maxTokens = {} } = {}) {
  if (!apiKey) throw new ProviderError('config', 'BASETEN_API_KEY is not set', { provider: NAME });
  const eff = (job) => { const e = effort[job] ?? DEFAULT_EFFORT[job]; if (!EFFORTS.includes(e)) throw new ProviderError('config', `reasoning_effort ${e} for ${job} is not one of ${EFFORTS.join(', ')}`, { provider: NAME, job }); return e; };
  const meta = (job, r, usage, extra = {}) => ({ provider: NAME, model, job, latencyMs: r.latencyMs, requestId: r.requestId, usage: usage ?? null, reasoningEffort: eff(job), reasoningTokens: usage?.completion_tokens_details?.reasoning_tokens ?? null, ...extra });
  const wrap = (job, value, r, usage, extra) => ({ value, meta: meta(job, r, usage, extra) });

  // one chat completion; a cut answer (finish_reason length) or an empty one is an error, never a value
  async function chat(job, messages, { json = false, tools = null } = {}) {
    const body = { model, messages, temperature: 0, max_tokens: maxTokens[job] ?? DEFAULT_MAX_TOKENS[job], reasoning_effort: eff(job), ...(json ? { response_format: { type: 'json_object' } } : {}), ...(tools ? { tools, tool_choice: 'auto' } : {}) };
    const r = await request({ provider: NAME, job, url: `${baseUrl}/chat/completions`, headers: { authorization: `Bearer ${apiKey}` }, json: body, timeoutMs, f });
    const j = parseJson(r.text, { provider: NAME, job });
    const choice = j.choices?.[0];
    if (choice?.finish_reason === 'length') throw new ProviderError('truncated', `the answer was cut by max_tokens=${body.max_tokens} (reasoning ${j.usage?.completion_tokens_details?.reasoning_tokens ?? '?'} tokens)`, { provider: NAME, job, body: r.text.slice(0, 300) });
    return { j, choice, usage: j.usage, r };
  }
  const contentOf = (job, choice, r) => {
    const c = choice?.message?.content;
    if (typeof c !== 'string' || !c.trim()) throw new ProviderError('parse', 'no message content', { provider: NAME, job, body: r.text.slice(0, 400) });
    return c;
  };
  const jsonFrom = (job, content) => {
    const raw = extractJsonObject(content);
    if (!raw) throw new ProviderError('parse', 'no JSON object in the answer', { provider: NAME, job, body: content.slice(0, 400) });
    try { return JSON.parse(raw); } catch (e) { throw new ProviderError('parse', `JSON does not parse: ${e.message}`, { provider: NAME, job, body: raw.slice(0, 400) }); }
  };
  const asking = (schema) => `\n\nAnswer with ONE JSON object and nothing else, matching this JSON Schema:\n${JSON.stringify(schema)}`;

  return {
    name: NAME,
    // keywords: names that may be spoken (shop names), given to the model as a hint because it mishears them ("Kiln" -> "Kill")
    async transcribe(audio, { mime = 'audio/wav', keywords = [] } = {}) {
      const hint = keywords.length ? ` Names that may be spoken: ${keywords.join(', ')}.` : '';
      const { choice, usage, r } = await chat('transcribe', [{ role: 'user', content: [{ type: 'text', text: `Transcribe this audio word for word. Answer with the transcript only, no commentary.${hint}` }, { type: 'audio_url', audio_url: { url: dataUrl(audio, mime) } }] }]);
      return wrap('transcribe', { text: contentOf('transcribe', choice, r).trim(), audioDurationMs: null }, r, usage);
    },
    async compileMandate(text, { system, schema }) {
      const { choice, usage, r } = await chat('compileMandate', [{ role: 'system', content: system + asking(schema) }, { role: 'user', content: text }], { json: true });
      return wrap('compileMandate', jsonFrom('compileMandate', contentOf('compileMandate', choice, r)), r, usage);
    },
    // `job` lets a caller (the grounding step) use its own reasoning effort and max_tokens: 'vision' (default) or 'ground'
    async vision(image, question, { mime = 'image/png', schema, system, job = 'vision' } = {}) {
      const q = schema ? question + asking(schema) : question;
      const { choice, usage, r } = await chat(job, [...(system ? [{ role: 'system', content: system }] : []), { role: 'user', content: [{ type: 'text', text: q }, { type: 'image_url', image_url: { url: dataUrl(image, mime) } }] }], { json: Boolean(schema) });
      const c = contentOf(job, choice, r);
      return wrap(job, schema ? jsonFrom(job, c) : c, r, usage);
    },
    // native tool calling (observed: finish_reason 'tool_calls', tool_calls[{id, type:'function', function:{name, arguments:'<json>'}}])
    async agentStep(messages, tools) {
      const { j, usage, r } = await chat('agentStep', messages, { tools });
      return wrap('agentStep', parseStep(j, 'agentStep', NAME), r, usage);
    },
    async segment() { throw unsupported(NAME, 'segment'); },
    async generateImage() { throw unsupported(NAME, 'generateImage'); },
    async editImage() { throw unsupported(NAME, 'editImage'); },
  };
}
