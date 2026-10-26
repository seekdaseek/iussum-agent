// Cost ledger for model calls. Prices are from https://dev.meta.ai/docs/pricing-rate-limits read 2026-10-26 (muse-spark-1.3 Standard, voice, SAM, image).
// Baseten and Modal are not priced here: their calls are logged with costUsd null, never with a guessed number.
import fs from 'node:fs';
import path from 'node:path';

export const PRICES = {
  'muse-spark-1.3': { inPerM: 1.25, outPerM: 4.25 },
  'muse-voice-transcribe-1.0': { perHour: 0.18 },
  'sam-3.1': { perImage: 0.0025 },
  'muse-image-1.0': { perImage: 0.01 },
};
export function priceCall({ provider, model, usage = {}, audioMs = 0, images = 0 }) {
  if (provider !== 'meta') return null;
  const p = PRICES[model];
  if (!p) return null;
  if (p.inPerM) {
    const i = usage.input_tokens ?? usage.prompt_tokens, o = usage.output_tokens ?? usage.completion_tokens;
    if (!Number.isFinite(i) || !Number.isFinite(o)) return null;
    return (i * p.inPerM + o * p.outPerM) / 1e6;
  }
  if (p.perHour) return Number.isFinite(audioMs) && audioMs > 0 ? (audioMs / 3_600_000) * p.perHour : null;
  if (p.perImage) return images > 0 ? images * p.perImage : null;
  return null;
}

export class CostLedger {
  constructor({ file = null, stopAtUsd = 100, budgetUsd = 150 } = {}) { this.file = file; this.stopAtUsd = stopAtUsd; this.budgetUsd = budgetUsd; this.rows = []; this.total = 0; this.unpriced = 0; this.load(); }
  load() {
    if (!this.file || !fs.existsSync(this.file)) return;
    for (const l of fs.readFileSync(this.file, 'utf8').split('\n')) { if (!l) continue; try { const r = JSON.parse(l); this.rows.push(r); if (r.costUsd != null) this.total += r.costUsd; else this.unpriced++; } catch { /* a torn last line */ } }
  }
  // Called before a call: at the stop threshold every further paid call is refused, so the credit cannot be drained by accident or by a visitor.
  assertCanSpend() {
    if (this.total >= this.stopAtUsd) throw Object.assign(new Error(`model spend ${this.total.toFixed(2)} USD reached the stop threshold ${this.stopAtUsd}`), { code: 'spend_guard' });
  }
  add(row) {
    const r = { ts: new Date().toISOString(), ...row };
    this.rows.push(r);
    if (r.costUsd != null) this.total += r.costUsd; else this.unpriced++;
    if (this.file) { fs.mkdirSync(path.dirname(this.file), { recursive: true }); fs.appendFileSync(this.file, `${JSON.stringify(r)}\n`); }
    return r;
  }
  summary() { return { calls: this.rows.length, spentUsd: Number(this.total.toFixed(6)), unpricedCalls: this.unpriced, stopAtUsd: this.stopAtUsd }; }
}
