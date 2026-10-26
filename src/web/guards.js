// Guards so a visitor cannot drain the model credit or the devnet wallets: a per-IP rate limiter, a daily spend guard (model USD and devnet USDC),
// and a single-flight lock (one grant per principal account at a time: a second ApproveChecked would supersede the first, so runs must not overlap).
import fs from 'node:fs';
import path from 'node:path';

export function createRateLimiter({ rules, now = () => Date.now() }) {
  // rules: { compile: { max: 12, windowMs: 600000 }, ... }
  const hits = new Map(); // `${rule}|${ip}` -> [timestamps]
  return {
    // returns { ok, retryAfterS } and records the hit only when allowed
    take(rule, ip) {
      const r = rules[rule]; if (!r) throw new Error(`no rate rule ${rule}`);
      const k = `${rule}|${ip}`, t = now();
      const list = (hits.get(k) ?? []).filter((x) => t - x < r.windowMs);
      if (list.length >= r.max) { hits.set(k, list); return { ok: false, retryAfterS: Math.ceil((r.windowMs - (t - list[0])) / 1000) }; }
      list.push(t); hits.set(k, list);
      if (hits.size > 50_000) for (const [kk, v] of hits) if (!v.some((x) => t - x < 3_600_000)) hits.delete(kk);
      return { ok: true };
    },
  };
}

// Daily totals, persisted so a restart does not reset the day. day = UTC date.
export function createDailyGuard({ file = null, maxModelUsd, maxUsdc, now = () => new Date() }) {
  const dayOf = () => now().toISOString().slice(0, 10);
  let state = { day: dayOf(), model_usd: 0, usdc_spent: 0, runs: 0 };
  if (file && fs.existsSync(file)) { try { const s = JSON.parse(fs.readFileSync(file, 'utf8')); if (s.day === dayOf()) state = s; } catch { /* start the day fresh */ } }
  const roll = () => { if (state.day !== dayOf()) state = { day: dayOf(), model_usd: 0, usdc_spent: 0, runs: 0 }; };
  const save = () => { if (file) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(state)); } };
  return {
    // `usdc` is the most a run can spend (the mandate's total cap); the guard refuses a run that could cross today's limit.
    canStartRun(usdc) { roll(); if (state.model_usd >= maxModelUsd) return { ok: false, reason: 'daily_model_budget' }; if (state.usdc_spent + usdc > maxUsdc) return { ok: false, reason: 'daily_usdc_budget' }; return { ok: true }; },
    canCallModel() { roll(); return state.model_usd < maxModelUsd ? { ok: true } : { ok: false, reason: 'daily_model_budget' }; },
    addModel(usd) { roll(); state.model_usd += usd ?? 0; save(); },
    addRun(netUsdc) { roll(); state.usdc_spent += Math.max(0, netUsdc); state.runs++; save(); },
    snapshot() { roll(); return { ...state, max_model_usd: maxModelUsd, max_usdc: maxUsdc }; },
  };
}

export function createSingleFlight() {
  let active = null;
  return {
    tryStart(id) { if (active) return false; active = { id, since: Date.now() }; return true; },
    end(id) { if (active?.id === id) active = null; },
    get active() { return active; },
  };
}

// Behind the Cloudflare tunnel (TRUST_CF=1, origin bound to 127.0.0.1 so only the tunnel can reach it) the client is CF-Connecting-IP; anywhere else the header is
// attacker-controlled, so the socket address is used.
export const clientIp = (req, trustCf = false) => String((trustCf && req.headers['cf-connecting-ip']) || req.socket?.remoteAddress || 'unknown');
