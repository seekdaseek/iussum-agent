// Exact comparison of what the code decided against what the eval file expects. The noun phrase is compared after the same normalisation the code applies.
const norm = (s) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
export function matches(expect, got) {
  if (got.status === 'error') return { ok: false, why: `provider error: ${got.message}` };
  if (got.status !== expect.status) return { ok: false, why: `status ${got.status}, expected ${expect.status}${got.reject_code ? ` (${got.reject_code})` : ''}${got.clarify_field ? ` (${got.clarify_field})` : ''}` };
  if (expect.status === 'clarify') return got.clarify_field === expect.clarify_field ? { ok: true } : { ok: false, why: `clarify_field ${got.clarify_field}, expected ${expect.clarify_field}` };
  if (expect.status === 'reject') return got.reject_code === expect.reject_code ? { ok: true } : { ok: false, why: `reject_code ${got.reject_code}, expected ${expect.reject_code}` };
  const diffs = [];
  for (const k of ['total_cap_usdc', 'per_payment_max_usdc', 'valid_for_hours']) if (got.limits[k] !== expect.limits[k]) diffs.push(`${k} ${got.limits[k]} != ${expect.limits[k]}`);
  if (JSON.stringify([...got.limits.shops].sort()) !== JSON.stringify([...expect.limits.shops].sort())) diffs.push(`shops ${got.limits.shops} != ${expect.limits.shops}`);
  if (norm(got.item.noun_phrase) !== norm(expect.item.noun_phrase)) diffs.push(`noun_phrase "${got.item.noun_phrase}" != "${expect.item.noun_phrase}"`);
  if (got.item.count !== expect.item.count) diffs.push(`count ${got.item.count} != ${expect.item.count}`);
  if (JSON.stringify([...got.item.must_not].sort()) !== JSON.stringify([...expect.item.must_not].sort())) diffs.push(`must_not ${got.item.must_not} != ${expect.item.must_not}`);
  return diffs.length ? { ok: false, why: diffs.join('; ') } : { ok: true };
}
