import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRateLimiter, createDailyGuard, createSingleFlight, clientIp } from '../src/web/guards.js';

test('rate limiter: the (max+1)th hit in the window is refused with a retry time; other IPs and rules are independent; the window slides', () => {
  let t = 0;
  const rl = createRateLimiter({ rules: { compile: { max: 2, windowMs: 1000 }, run: { max: 1, windowMs: 5000 } }, now: () => t });
  assert.equal(rl.take('compile', 'a').ok, true);
  assert.equal(rl.take('compile', 'a').ok, true);
  const third = rl.take('compile', 'a');
  assert.equal(third.ok, false); assert.equal(third.retryAfterS, 1);
  assert.equal(rl.take('compile', 'b').ok, true);
  assert.equal(rl.take('run', 'a').ok, true);
  assert.equal(rl.take('run', 'a').ok, false);
  t = 1001;
  assert.equal(rl.take('compile', 'a').ok, true);
  assert.throws(() => rl.take('nope', 'a'), /no rate rule/);
});
test('daily guard: refuses a run that could cross today\'s USDC limit, stops model calls at the model budget, persists, and rolls over at UTC midnight', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'iussum-guard-')), 'spend.json');
  let d = new Date('2026-11-02T10:00:00Z');
  const g = createDailyGuard({ file, maxModelUsd: 1, maxUsdc: 2, now: () => d });
  assert.equal(g.canStartRun(2).ok, true);
  assert.equal(g.canStartRun(2.01).ok, false);
  g.addRun(0.45); g.addRun(0.45);
  assert.equal(g.canStartRun(1.2).ok, false);
  assert.equal(g.canStartRun(1.1).ok, true);
  g.addRun(-5); // a negative net (refund larger than payment) never lowers the day's total
  assert.equal(Number(g.snapshot().usdc_spent.toFixed(2)), 0.9);
  g.addModel(0.6); assert.equal(g.canCallModel().ok, true);
  g.addModel(0.5); assert.deepEqual(g.canCallModel(), { ok: false, reason: 'daily_model_budget' });
  assert.equal(g.canStartRun(0.1).reason, 'daily_model_budget');
  const again = createDailyGuard({ file, maxModelUsd: 1, maxUsdc: 2, now: () => d });
  assert.equal(again.canCallModel().ok, false); // reloaded from disk
  d = new Date('2026-11-03T00:00:01Z');
  assert.equal(again.canCallModel().ok, true);
  assert.equal(again.snapshot().usdc_spent, 0);
});
test('single flight: one run at a time', () => {
  const sf = createSingleFlight();
  assert.equal(sf.tryStart('a'), true);
  assert.equal(sf.tryStart('b'), false);
  sf.end('b'); assert.equal(sf.tryStart('c'), false); // a stranger cannot end it
  sf.end('a'); assert.equal(sf.tryStart('b'), true);
});
test('client ip: the Cloudflare header is honoured only when trusted', () => {
  const req = { headers: { 'cf-connecting-ip': '203.0.113.9' }, socket: { remoteAddress: '127.0.0.1' } };
  assert.equal(clientIp(req, false), '127.0.0.1');
  assert.equal(clientIp(req, true), '203.0.113.9');
  assert.equal(clientIp({ headers: {}, socket: {} }, true), 'unknown');
});
