// One real call per job against Baseten, raw (not through the adapter), so the true request/response shapes are recorded.
//   node --env-file=.env scripts/baseten-smoke.mjs
// Saves each raw response to data/smoke/<name>.json (no key in them) and prints status, latency, tokens, reasoning share and a trimmed answer.
// The speech WAV in data/smoke/ is macOS text-to-speech converted to 16 kHz mono 16-bit: synthetic speech, not a human recording.
import fs from 'node:fs';
import { INTENT_SCHEMA, buildSystemPrompt } from '../src/intent/schema.js';
import { VISION_SCHEMA, VISION_SYSTEM, visionQuestion } from '../src/evidence/prompts.js';
import { TOOLS } from '../src/agent/shopper.js';
import { syntheticPng } from '../test/helpers.js';

const key = process.env.BASETEN_API_KEY;
if (!key) { console.error('BASETEN_API_KEY not set (run with node --env-file=.env)'); process.exit(2); }
const MODEL = process.env.BASETEN_MODEL || 'meta-models/muse-spark-open-1026';
const URL_ = 'https://inference.baseten.co/v1/chat/completions';
const dir = new URL('../data/smoke/', import.meta.url);

async function post(name, body) {
  const t0 = Date.now();
  let res, text;
  try { res = await fetch(URL_, { method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: JSON.stringify(body) }); text = await res.text(); }
  catch (e) { console.log(`${name}: NETWORK ${e.message}`); return null; }
  const ms = Date.now() - t0;
  fs.writeFileSync(new URL(`${name}.json`, dir), text);
  let j = null; try { j = JSON.parse(text); } catch { /* shown below */ }
  const m = j?.choices?.[0]?.message, u = j?.usage;
  console.log(`\n== ${name}  HTTP ${res.status}  ${ms} ms  effort=${body.reasoning_effort ?? '(default)'}`);
  if (!j) { console.log('  not JSON:', text.slice(0, 300)); return { status: res.status, ms }; }
  if (j.error || !m) { console.log('  error:', JSON.stringify(j.error ?? j).slice(0, 400)); return { status: res.status, ms, j }; }
  console.log(`  finish_reason=${j.choices[0].finish_reason}  usage=${JSON.stringify(u)}`);
  console.log(`  message keys: ${Object.keys(m).join(',')}`);
  const reasoningChars = (m.reasoning_content ?? m.reasoning ?? '').length;
  console.log(`  content chars ${(m.content ?? '').length}, reasoning chars ${reasoningChars}, tool_calls ${m.tool_calls?.length ?? 0}`);
  console.log(`  content: ${JSON.stringify(m.content)?.slice(0, 500)}`);
  if (m.tool_calls?.length) console.log(`  tool_calls: ${JSON.stringify(m.tool_calls).slice(0, 500)}`);
  return { status: res.status, ms, j, m, u };
}

const only = process.argv[2]; // optional: compile | vision | audio | tools
const efforts = (process.env.EFFORTS || 'low,medium').split(',');
const canonical = 'Buy me three product photos of a red ceramic mug, under 2 USDC in total, at most 0.80 each, only from Kiln & Co and Mugworks, this week.';
const shops = [{ id: 'kiln', name: 'Kiln & Co', aliases: ['Kiln and Co', 'Kiln'] }, { id: 'mugworks', name: 'Mugworks', aliases: [] }, { id: 'glazed', name: 'Glazed Studio', aliases: ['Glazed'] }];

if (!only || only === 'compile') {
  for (const effort of efforts) {
    const sys = buildSystemPrompt({ shops });
    const msgs = [{ role: 'system', content: `${sys}\n\nAnswer with ONE JSON object and nothing else, matching this JSON Schema:\n${JSON.stringify(INTENT_SCHEMA)}` }, { role: 'user', content: canonical }];
    await post(`compile-prompt-${effort}`, { model: MODEL, messages: msgs, max_tokens: 4000, reasoning_effort: effort, temperature: 0 });
    // json mode and json_schema: the models list says json_mode is supported; whether json_schema is accepted is what this shows
    await post(`compile-jsonobject-${effort}`, { model: MODEL, messages: msgs, max_tokens: 4000, reasoning_effort: effort, response_format: { type: 'json_object' } });
    await post(`compile-jsonschema-${effort}`, { model: MODEL, messages: [{ role: 'system', content: sys }, { role: 'user', content: canonical }], max_tokens: 4000, reasoning_effort: effort, response_format: { type: 'json_schema', json_schema: { name: 'intent', schema: INTENT_SCHEMA } } });
  }
}
if (!only || only === 'vision') {
  const png = await syntheticPng('red-mug');
  const q = visionQuestion({ title: 'Red ceramic mug, front view', description: 'Photo of a glossy red ceramic coffee mug.', noun_phrase: 'red ceramic mug', must_not: ['glass'] });
  for (const effort of efforts) {
    await post(`vision-dataurl-${effort}`, { model: MODEL, max_tokens: 3000, reasoning_effort: effort, messages: [{ role: 'system', content: `${VISION_SYSTEM}\n\nAnswer with ONE JSON object and nothing else, matching this JSON Schema:\n${JSON.stringify(VISION_SCHEMA)}` }, { role: 'user', content: [{ type: 'text', text: q }, { type: 'image_url', image_url: { url: `data:image/png;base64,${png.toString('base64')}` } }] }] });
  }
}
if (!only || only === 'audio') {
  const wav = fs.readFileSync(new URL('speech.wav', dir));
  for (const effort of efforts) {
    await post(`audio-audiourl-${effort}`, { model: MODEL, max_tokens: 3000, reasoning_effort: effort, messages: [{ role: 'user', content: [{ type: 'text', text: 'Transcribe this audio. Answer with the transcript only, no commentary.' }, { type: 'audio_url', audio_url: { url: `data:audio/wav;base64,${wav.toString('base64')}` } }] }] });
  }
}
if (!only || only === 'tools') {
  for (const effort of efforts) {
    const system = 'You are a shopping agent. Use the tools. Start by listing the shops.';
    await post(`tools-${effort}`, { model: MODEL, max_tokens: 3000, reasoning_effort: effort, tools: TOOLS, tool_choice: 'auto', messages: [{ role: 'system', content: system }, { role: 'user', content: 'Start shopping.' }] });
  }
}
