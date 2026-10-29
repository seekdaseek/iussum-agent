// Scores a provider on the 30 requests: node eval/run.js [--limit N]
// Needs a real provider (MODEL_PROVIDER=meta|baseten with a key). It REFUSES to print a score for the fixture adapter: a replayed answer says nothing about a model.
// Writes eval/results/<provider>-<timestamp>.json with every case, and prints every failure in full.
import fs from 'node:fs';
import path from 'node:path';
import { generateKeyPairSigner } from '@solana/kit';
import { createProvider } from '../models/provider.js';
import { compileRequest } from '../src/intent/compile.js';
import { matches } from './compare.js';

const fileArg = process.argv.includes('--file') ? process.argv[process.argv.indexOf('--file') + 1] : 'requests.json';
const spec = JSON.parse(fs.readFileSync(new URL(`./${fileArg}`, import.meta.url), 'utf8'));
const limit = Number(process.argv[process.argv.indexOf('--limit') + 1]) || spec.requests.length;
const provider = createProvider();
const names = new Set(['compileMandate'].map((j) => provider.adapterName(j)));
if (names.has('fixture')) { console.error('refusing: MODEL_PROVIDER is fixture. No score is produced for replayed answers.'); process.exit(2); }

const NET = 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1', MINT = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
const addr = async () => (await generateKeyPairSigner()).address;
const shops = [];
for (const s of spec.shops) shops.push({ ...s, pay_to: await addr(), origin: `https://shops.example/${s.id}` });
const ctx = { shops, principal: await addr(), agent: await addr(), network: NET, asset: MINT, now: Math.floor(Date.now() / 1000) };

const rows = [];
for (const r of spec.requests.slice(0, limit)) {
  const got = await compileRequest(r.text, { provider, ctx });
  const m = matches(r.expect, got);
  rows.push({ id: r.id, text: r.text, expect: r.expect, ok: m.ok, why: m.why, got: { status: got.status, clarify_field: got.clarify_field, reject_code: got.reject_code, limits: got.limits, item: got.item, error: got.error_kind ? `${got.error_kind}: ${got.message}` : undefined, raw_model_output: got.raw_model_output }, model: got.model });
  console.log(`${m.ok ? 'PASS' : 'FAIL'} ${r.id}${m.ok ? '' : `  ${m.why}`}`);
}
const exact = rows.filter((r) => r.ok).length;
const out = { provider: [...names][0], file: fileArg, when: new Date().toISOString(), exact, total: rows.length, spend: provider.ledger.summary(), rows };
fs.mkdirSync(new URL('./results/', import.meta.url), { recursive: true });
const file = new URL(`./results/${out.provider}-${fileArg.replace(/\.json$/, '')}-${out.when.replace(/[:.]/g, '-')}.json`, import.meta.url);
fs.writeFileSync(file, JSON.stringify(out, null, 1));
console.log(`\n${exact}/${rows.length} compile exactly to the expected outcome (provider ${out.provider}). Failures listed above; full rows in ${path.relative(process.cwd(), file.pathname)}`);
