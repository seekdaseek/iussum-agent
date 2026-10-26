import { ProviderError } from './errors.js';

// Fetch with a timeout and typed errors. `f` is injectable so tests never touch the network.
export async function request({ provider, job, url, method = 'POST', headers = {}, json, body, timeoutMs = 60_000, f = globalThis.fetch }) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  const t0 = Date.now();
  let res;
  try {
    res = await f(url, { method, headers: json !== undefined ? { 'content-type': 'application/json', ...headers } : headers, body: json !== undefined ? JSON.stringify(json) : body, signal: ctl.signal });
  } catch (e) {
    throw new ProviderError(e.name === 'AbortError' ? 'timeout' : 'network', e.message, { provider, job });
  } finally { clearTimeout(timer); }
  const text = await res.text();
  const latencyMs = Date.now() - t0;
  if (!res.ok) throw new ProviderError('http', `HTTP ${res.status}: ${text.slice(0, 400)}`, { provider, job, status: res.status, body: text.slice(0, 2000) });
  return { text, latencyMs, requestId: res.headers.get('x-request-id') ?? res.headers.get('request-id') ?? null };
}
export function parseJson(text, { provider, job }) {
  try { return JSON.parse(text); } catch (e) { throw new ProviderError('parse', `response is not JSON: ${e.message}`, { provider, job, body: text.slice(0, 400) }); }
}
export const dataUrl = (bytes, mime) => `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`;
// The first balanced {...} in a model answer that has no structured-output mode (Baseten Muse Spark Open). The caller still validates it.
export function extractJsonObject(s) {
  const start = s.indexOf('{');
  if (start < 0) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true; else if (c === '{') depth++; else if (c === '}' && --depth === 0) return s.slice(start, i + 1);
  }
  return null;
}
