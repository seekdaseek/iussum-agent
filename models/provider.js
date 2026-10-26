// The provider layer. Every model call in this repo goes through here, one interface per job:
//   transcribe(audioWavBytes)                   -> { value: { text, audioDurationMs }, meta }
//   compileMandate(text, { system, schema })    -> { value: <JSON object>, meta }          structured output; the caller validates it
//   vision(imageBytes, question, { schema })    -> { value: <JSON object | string>, meta }
//   segment(imageBytes, nounPhrase)             -> { value: { rawOutput, instances[], diagnostics }, meta }
//   agentStep(messages, tools)                  -> { value: { content, tool_calls[], finish_reason }, meta }   one step of the shopping agent's tool loop
// plus generateImage / editImage (Muse Image: shop catalogues and the dishonest edit), served by `meta` only.
// Adapter per job from env: MODEL_PROVIDER (default for every job) and MODEL_PROVIDER_<JOB> to override one, e.g.
//   MODEL_PROVIDER=baseten MODEL_PROVIDER_SEGMENT=modal      (open weights end to end)
// Providers: meta | baseten | modal | fixture. A job a provider does not serve throws ProviderError('unsupported'); nothing falls back silently.
import path from 'node:path';
import { ProviderError } from './errors.js';
import { CostLedger, priceCall } from './cost.js';
import { createMetaAdapter } from './adapters/meta.js';
import { createBasetenAdapter } from './adapters/baseten.js';
import { createModalAdapter } from './adapters/modal.js';
import { createFixtureAdapter } from './adapters/fixture.js';
import { withRecording } from './record.js';

export const JOBS = ['transcribe', 'compileMandate', 'vision', 'segment', 'agentStep', 'generateImage', 'editImage'];
export const PROVIDERS = ['meta', 'baseten', 'modal', 'fixture'];

function build(name, env, f) {
  switch (name) {
    case 'meta': return createMetaAdapter({ apiKey: env.MODEL_API_KEY, baseUrl: env.META_BASE_URL || undefined, f });
    case 'baseten': return createBasetenAdapter({ apiKey: env.BASETEN_API_KEY, model: env.BASETEN_MODEL || undefined, baseUrl: env.BASETEN_BASE_URL || undefined, f });
    case 'modal': return createModalAdapter({ url: env.MODAL_SAM_URL, token: env.MODAL_SAM_TOKEN, f });
    case 'fixture':
      if (env.DEMO === '1') throw new ProviderError('forbidden', 'the fixture adapter is for offline tests and is refused when DEMO=1', { provider: 'fixture' });
      return createFixtureAdapter({ dir: env.MODEL_FIXTURE_DIR || path.resolve('fixtures') });
    default: throw new ProviderError('config', `unknown MODEL_PROVIDER ${JSON.stringify(name)}; one of ${PROVIDERS.join(', ')}`, { provider: name });
  }
}

export function createProvider({ env = process.env, f = globalThis.fetch, ledger = new CostLedger({ file: env.COST_LEDGER || null }) } = {}) {
  const cache = new Map();
  const adapterFor = (job) => {
    const name = (env[`MODEL_PROVIDER_${job.toUpperCase()}`] || env.MODEL_PROVIDER || 'meta').toLowerCase();
    if (!cache.has(name)) { let a = build(name, env, f); if (env.MODEL_RECORD_DIR && name !== 'fixture') a = withRecording(a, env.MODEL_RECORD_DIR); cache.set(name, a); }
    return cache.get(name);
  };
  const provider = { ledger, adapterName: (job) => adapterFor(job).name };
  for (const job of JOBS) {
    provider[job] = async (...args) => {
      const adapter = adapterFor(job);
      if (adapter.name !== 'fixture') ledger.assertCanSpend();
      let res;
      try { res = await adapter[job](...args); }
      catch (e) { ledger.add({ job, provider: adapter.name, ok: false, error: e.kind ?? e.name, costUsd: null }); throw e; }
      const costUsd = priceCall({ provider: res.meta.provider, model: res.meta.model, usage: res.meta.usage ?? {}, audioMs: res.meta.audioMs ?? 0, images: res.meta.images ?? 0 });
      if (adapter.name !== 'fixture') ledger.add({ job, provider: res.meta.provider, model: res.meta.model, ok: true, latencyMs: res.meta.latencyMs, usage: res.meta.usage ?? null, costUsd });
      return { ...res, meta: { ...res.meta, costUsd } };
    };
  }
  return provider;
}
