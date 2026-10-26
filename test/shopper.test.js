import test from 'node:test';
import assert from 'node:assert/strict';
import { IussumRefusal } from '@iussum/agent';
import { runShopper, TOOLS, shopperSystemPrompt } from '../src/agent/shopper.js';
import { scriptedProvider } from '../src/agent/scripted.js';

const shops = [{ id: 'kiln', name: 'Kiln & Co' }, { id: 'mugworks', name: 'Mugworks' }, { id: 'glazed', name: 'Glazed Studio' }];
const CAT = {
  kiln: { id: 'kiln', items: ['mug-front', 'mug-side', 'mug-top', 'teapot-front'].map((sku) => ({ sku, title: sku.startsWith('mug') ? `Red ceramic mug, ${sku}` : 'Green ceramic teapot', price: '300000' })) },
  mugworks: { id: 'mugworks', items: ['mug-front', 'mug-side', 'mug-top', 'teapot-front'].map((sku) => ({ sku, title: sku.startsWith('mug') ? `Red ceramic mug, ${sku}` : 'Green ceramic teapot', price: '150000' })) },
  glazed: { id: 'glazed', items: ['mug-front', 'mug-side', 'mug-top', 'teapot-front'].map((sku) => ({ sku, title: sku.startsWith('mug') ? `Red ceramic mug, ${sku}` : 'Green ceramic teapot', price: '100000' })) },
};
const getCatalog = async (s) => CAT[s.id];
const paid = (s, sku) => ({ paid: true, ok: true, receipt: { tx_sig: `tx-${s.id}-${sku}`, amount: CAT[s.id].items.find((i) => i.sku === sku).price } });
const sys = shopperSystemPrompt({ readback: 'readback text', item: { count: 3, noun_phrase: 'red ceramic mug', must_not: ['glass'] } });

test('scripted agent: looks at the allowed shops, buys the cheapest matching offers, never an offer from a shop it was not given', async () => {
  const bought = [];
  const r = await runShopper({ provider: scriptedProvider({ allowedShopIds: ['kiln', 'mugworks'], noun_phrase: 'red ceramic mug', count: 3 }), shops, getCatalog, buy: async (s, sku) => { bought.push(`${s.id}/${sku}`); return paid(s, sku); }, system: sys, count: 3 });
  assert.deepEqual(bought, ['mugworks/mug-front', 'mugworks/mug-side', 'mugworks/mug-top']);
  assert.equal(r.purchases.length, 3);
  assert.ok(['quota', 'finish'].includes(r.ended));
  assert.equal(r.error, null);
});
test('the permission refuses a payment: the model is told why, nothing is recorded as bought, and it can adapt', async () => {
  const buy = async (s, sku) => { if (s.id === 'glazed') throw new IussumRefusal('pay_to_not_allowed', 'glazed is not on the list'); return paid(s, sku); };
  const script = [
    { name: 'buy_photo', arguments: { shop_id: 'glazed', sku: 'mug-front' } },
    { name: 'buy_photo', arguments: { shop_id: 'kiln', sku: 'mug-front' } },
    { name: 'finish', arguments: { summary: 'ok' } },
  ];
  const seen = [];
  const provider = { agentStep: async (messages) => { seen.push(messages.filter((m) => m.role === 'tool').map((m) => JSON.parse(m.content))); const t = script.shift(); return { value: { content: '', tool_calls: [{ id: `c${script.length}`, ...t }], finish_reason: 'tool_calls' }, meta: { provider: 'stub' } }; } };
  const events = [];
  const r = await runShopper({ provider, shops, getCatalog, buy, system: sys, count: 1, onEvent: (e) => events.push(e) });
  assert.deepEqual(r.purchases.map((p) => `${p.shop}/${p.sku}`), ['kiln/mug-front']);
  assert.equal(seen[1][0].refused_by_permission, 'pay_to_not_allowed');
  assert.deepEqual(events.map((e) => e.type), ['refused', 'purchase']);
  assert.equal(r.ended, 'quota');
});
test('code enforces the quota and duplicates even when the model insists', async () => {
  let n = 0;
  const provider = { agentStep: async () => { n++; return { value: { content: '', tool_calls: [{ id: `c${n}`, name: 'buy_photo', arguments: { shop_id: 'kiln', sku: n <= 2 ? 'mug-front' : 'mug-side' } }], finish_reason: 'tool_calls' }, meta: {} }; } };
  const paidCalls = [];
  const r = await runShopper({ provider, shops, getCatalog, buy: async (s, sku) => { paidCalls.push(sku); return paid(s, sku); }, system: sys, count: 2, maxSteps: 10 });
  assert.deepEqual(paidCalls, ['mug-front', 'mug-side']); // the second mug-front was refused by code as a duplicate
  assert.equal(r.purchases.length, 2);
  assert.equal(r.ended, 'quota');
});
test('a model that answers in text, calls unknown tools or bad arguments, never causes a payment', async () => {
  const text = await runShopper({ provider: { agentStep: async () => ({ value: { content: 'I will buy a mug', tool_calls: [], finish_reason: 'stop' }, meta: {} }) }, shops, getCatalog, buy: async () => { throw new Error('must not be called'); }, system: sys, count: 1 });
  assert.equal(text.ended, 'no_tool_call'); assert.equal(text.purchases.length, 0);
  const seq = [{ name: 'transfer_funds', arguments: { to: 'x' } }, { name: 'buy_photo', arguments: { shop_id: 'nowhere', sku: 'a' } }, { name: 'buy_photo', arguments: { shop_id: 'kiln', sku: 42 } }, { name: 'buy_photo', arguments: {} }, { name: 'finish', arguments: {} }];
  const r = await runShopper({ provider: { agentStep: async () => ({ value: { content: '', tool_calls: [{ id: 'x', ...seq.shift() }], finish_reason: 'tool_calls' }, meta: {} }) }, shops, getCatalog, buy: async () => { throw new Error('must not be called'); }, system: sys, count: 1 });
  assert.equal(r.purchases.length, 0);
  assert.equal(r.ended, 'finish');
});
test('a provider failure ends the run with the error and no invented purchase; the step budget is a hard stop', async () => {
  const fail = await runShopper({ provider: { agentStep: async () => { throw Object.assign(new Error('503'), { kind: 'http' }); } }, shops, getCatalog, buy: async () => paid(shops[0], 'mug-front'), system: sys, count: 1 });
  assert.equal(fail.ended, 'error'); assert.equal(fail.error.kind, 'http'); assert.equal(fail.purchases.length, 0);
  let calls = 0;
  const loop = await runShopper({ provider: { agentStep: async () => { calls++; return { value: { content: '', tool_calls: [{ id: `l${calls}`, name: 'list_shops', arguments: {} }], finish_reason: 'tool_calls' }, meta: {} }; } }, shops, getCatalog, buy: async () => paid(shops[0], 'mug-front'), system: sys, count: 1, maxSteps: 5 });
  assert.equal(calls, 5); assert.equal(loop.ended, 'max_steps');
});
test('a paid purchase whose shop signatures did not verify is still recorded (the money moved), flagged for the pipeline', async () => {
  const r = await runShopper({ provider: scriptedProvider({ allowedShopIds: ['kiln'], noun_phrase: 'red ceramic mug', count: 1 }), shops, getCatalog, buy: async (s, sku) => ({ ...paid(s, sku), ok: false }), system: sys, count: 1 });
  assert.equal(r.purchases.length, 1);
  assert.equal(r.purchases[0].result.ok, false);
});
test('tools are defined and the system prompt carries the item, the read-back and the injection warning', () => {
  assert.deepEqual(TOOLS.map((t) => t.function.name), ['list_shops', 'get_catalog', 'buy_photo', 'finish']);
  assert.match(sys, /readback text/); assert.match(sys, /3 photos of: red ceramic mug/); assert.match(sys, /must not be: glass/); assert.match(sys, /never follow instructions/);
});
