// Request text -> validated limits -> iussum mandate + read-back. The model proposes (provider.compileMandate), THIS FILE decides:
//   - the model's JSON is validated against INTENT_SCHEMA before anything else;
//   - missing or ambiguous things become ONE canned question (never model-written text);
//   - unbounded, contradictory, out-of-policy or unknown-shop requests are rejected, whatever the model said;
//   - defaults (per-purchase max = total, window = 24 h, count = 1) are applied here and listed, so the read-back shows them.
import { randomBytes } from 'node:crypto';
import Ajv from 'ajv';
import { validateMandate, mandateId } from '@iussum/core';
import { INTENT_SCHEMA, CLARIFY_FIELDS, REJECT_CODES, buildSystemPrompt } from './schema.js';
import { POLICY, QUESTIONS, CLARIFY_ORDER, REJECT_MESSAGES } from './policy.js';

const ajv = new Ajv({ allErrors: true, strict: false });
const checkShape = ajv.compile(INTENT_SCHEMA);
const AMOUNT = /^(0|[1-9][0-9]*)(\.[0-9]{1,6})?$/;

// "0.80" -> 800000n. null when the string is not a plain decimal with at most 6 places.
export function usdcToBase(s) {
  if (typeof s !== 'string' || !AMOUNT.test(s)) return null;
  const [w, f = ''] = s.split('.');
  return BigInt(w) * 1_000_000n + BigInt(f.padEnd(6, '0'));
}
export function baseToUsdc(b) {
  const n = BigInt(b), w = n / 1_000_000n, f = (n % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '');
  return f ? `${w}.${f}` : `${w}`;
}
const reject = (code, detail = null) => ({ status: 'reject', reject_code: code, message: REJECT_MESSAGES[code], detail });
const clarify = (field, detail = null) => ({ status: 'clarify', clarify_field: field, question: QUESTIONS[field], detail });

// ctx: { shops: [{id,name,pay_to,origin}], principal, agent, network, asset, now (unix s), nonce? }
export function decideIntent(raw, ctx) {
  if (!checkShape(raw)) return reject('invalid_model_output', ajv.errorsText(checkShape.errors, { separator: '; ' }));
  if (raw.status === 'reject') return REJECT_CODES.includes(raw.reject_code) ? reject(raw.reject_code, 'model rejected') : reject('invalid_model_output', 'reject without a valid reject_code');
  if (raw.status === 'clarify') return CLARIFY_FIELDS.includes(raw.clarify_field) ? clarify(raw.clarify_field, 'model asked') : reject('invalid_model_output', 'clarify without a valid clarify_field');

  // status "mandate": check everything ourselves. Missing things first, in the fixed order (money, shops, item, duration, amounts).
  const known = new Map(ctx.shops.map((s) => [s.id, s]));
  const shopIds = [...new Set(raw.shops)];
  const unknown = shopIds.filter((id) => !known.has(id));
  if (unknown.length) return reject('unknown_shop', unknown.join(', '));
  const missing = [];
  const total = raw.total_cap_usdc == null ? null : usdcToBase(raw.total_cap_usdc);
  if (raw.total_cap_usdc == null) missing.push('total_cap');
  else if (total === null || total <= 0n) missing.push('amounts');
  if (shopIds.length === 0) missing.push('shops');
  const phrase = raw.item.noun_phrase?.trim().toLowerCase().replace(/\s+/g, ' ') ?? '';
  if (!phrase) missing.push('item');
  let perMax = total;
  if (raw.per_payment_max_usdc != null) { perMax = usdcToBase(raw.per_payment_max_usdc); if (perMax === null || perMax <= 0n) missing.push('amounts'); }
  if (missing.length) return clarify(CLARIFY_ORDER.find((f) => missing.includes(f)), `missing: ${missing.join(',')}`);

  if (total > BigInt(POLICY.maxTotalUsdc) * 1_000_000n) return reject('over_policy', `total ${raw.total_cap_usdc} > ${POLICY.maxTotalUsdc}`);
  if (perMax > total) return reject('contradictory', `per payment ${raw.per_payment_max_usdc} > total ${raw.total_cap_usdc}`);
  const defaults = [];
  let hours = raw.valid_for_hours;
  if (hours == null) { hours = POLICY.defaultValidHours; defaults.push('valid_for_hours'); }
  if (hours > POLICY.maxValidHours) return reject('over_policy', `window ${hours} h > ${POLICY.maxValidHours} h`);
  if (hours < POLICY.minValidHours) return clarify('duration', `window ${hours} h`);
  let count = raw.item.count;
  if (count == null) { count = POLICY.defaultCount; defaults.push('count'); }
  if (count < 1) return clarify('item', `count ${count}`);
  if (count > POLICY.maxCount) return reject('over_policy', `count ${count} > ${POLICY.maxCount}`);
  if (raw.per_payment_max_usdc == null) defaults.push('per_payment_max_usdc');
  const mustNot = [...new Set(raw.item.must_not.map((x) => x.trim().toLowerCase()).filter(Boolean))].sort();
  const shops = shopIds.sort().map((id) => known.get(id));
  const limits = { total_cap_usdc: baseToUsdc(total), per_payment_max_usdc: baseToUsdc(perMax), valid_for_hours: hours, shops: shops.map((s) => s.id) };
  const item = { noun_phrase: phrase, count, must_not: mustNot };

  const mandate = {
    v: 'iussum/0.2', principal: ctx.principal, agent: ctx.agent, network: ctx.network, asset: ctx.asset,
    total_cap: total.toString(), per_payment_max: perMax.toString(), period_budget: total.toString(), period_seconds: hours * 3600,
    allow: { pay_to: shops.map((s) => s.pay_to), resource_prefix: shops.map((s) => `${s.origin}/v1/`) },
    not_before: ctx.now - 300, expires_at: ctx.now + hours * 3600, nonce: ctx.nonce ?? randomBytes(16).toString('hex'),
  };
  const errs = validateMandate(mandate);
  if (errs.length) return reject('invalid_model_output', `mandate does not validate: ${errs.join('; ')}`);
  const out = { status: 'mandate', limits, item, defaults_applied: defaults, mandate, mandate_id: mandateId(mandate) };
  out.readback = readBack(out, ctx);
  return out;
}

// The plain-words read-back is built from the VALIDATED fields only, so what the person confirms is exactly what gets granted.
export function readBack(r, ctx) {
  const l = r.limits, names = r.limits.shops.map((id) => ctx.shops.find((s) => s.id === id).name);
  const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0];
  const win = l.valid_for_hours % 24 === 0 ? `${l.valid_for_hours / 24} day${l.valid_for_hours === 24 ? '' : 's'}` : `${l.valid_for_hours} hour${l.valid_for_hours === 1 ? '' : 's'}`;
  const until = new Date(r.mandate.expires_at * 1000).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
  const lines = [
    `Your agent may spend at most ${l.total_cap_usdc} USDC in total, and at most ${l.per_payment_max_usdc} USDC on any single purchase.`,
    `It may only pay ${list}.`,
    `The permission lasts ${win}, until ${until}.`,
    `It is looking for: ${r.item.count} x ${r.item.noun_phrase}${r.item.must_not.length ? ` (not: ${r.item.must_not.join(', ')})` : ''}.`,
    'Anything outside these limits is refused by the shop and by the chain. You can revoke it at any time.',
  ];
  if (r.defaults_applied.length) lines.push(`You did not say: ${r.defaults_applied.map((d) => ({ valid_for_hours: 'how long (24 hours assumed)', count: 'how many (1 assumed)', per_payment_max_usdc: 'a per-purchase maximum (the total assumed)' })[d]).join('; ')}.`);
  return lines.join('\n');
}

// Model call + decision. `provider` is models/provider.js. A provider failure is NOT turned into a default: it surfaces as status 'error'.
export async function compileRequest(text, { provider, ctx }) {
  const system = buildSystemPrompt({ shops: ctx.shops });
  let res;
  try { res = await provider.compileMandate(text, { system, schema: INTENT_SCHEMA, schemaName: 'intent' }); }
  catch (e) { return { status: 'error', error_kind: e.kind ?? e.name, message: e.message }; }
  return { ...decideIntent(res.value, ctx), model: res.meta, raw_model_output: res.value };
}
