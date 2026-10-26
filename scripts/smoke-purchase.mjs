// Devnet smoke test of the model-free purchase path. REAL devnet transactions and the REAL facilitator; synthetic images (not Muse Image); no model call.
//   node scripts/smoke-purchase.mjs
// 1 compile a mandate from the canonical request using the oracle model output (code path only) -> 2 grant on devnet -> 3 agent buys from kiln (honest) and
// mugworks (swap) -> 4 checks receipts and attestations -> 5 a naive agent tries glazed (not allowed) and the shop refuses.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createAgent, IussumRefusal } from '@iussum/agent';
import { mandateId } from '@iussum/core';
import { makeChain, loadChainKeys, DEVNET, fmtUsdc, explorerTx } from '../src/chain/chain.js';
import { loadShopKeys, shopRegistry, createShopsApp } from '../src/shops/registry.js';
import { makeCatalogs } from '../src/shops/make-catalogs.js';
import { decideIntent } from '../src/intent/compile.js';
import { buyPhoto, shopKey } from '../src/agent/purchase.js';
import { stubImageProvider } from '../test/helpers.js';

const secrets = new URL('../.secrets', import.meta.url).pathname;
const chain = makeChain(), keys = await loadChainKeys(secrets), shopKeys = await loadShopKeys(secrets);
const catalogDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iussum-smoke-cat-'));
await makeCatalogs({ provider: stubImageProvider(), catalogDir });
const server = http.createServer();
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;
const { app, close } = createShopsApp({ origin, catalogDir, keys: shopKeys, rpc: chain.rpc, network: DEVNET.network, asset: DEVNET.mint, facilitatorUrl: DEVNET.facilitator, dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'iussum-smoke-gate-')), log: (e) => e.reason && console.log('   [gate]', JSON.stringify(e)) });
server.on('request', app);
const shops = shopRegistry({ origin, keys: shopKeys });
const byId = Object.fromEntries(shops.map((s) => [s.id, s]));
const ctx = { shops, principal: keys.principal.address, agent: keys.agent.address, network: DEVNET.network, asset: DEVNET.mint, now: Math.floor(Date.now() / 1000) };
const say = (s) => console.log(s);
let failed = 0;
const check = (label, ok, extra = '') => { say(`  ${ok ? 'PASS' : 'FAIL'} ${label}${extra ? `  ${extra}` : ''}`); if (!ok) failed++; };

say(`origin ${origin}  principal ${keys.principal.address}  agent ${keys.agent.address}`);
const c = decideIntent({ status: 'mandate', clarify_field: null, reject_code: null, total_cap_usdc: '2', per_payment_max_usdc: '0.80', valid_for_hours: 168, shops: ['kiln', 'mugworks'], item: { noun_phrase: 'red ceramic mug', count: 3, must_not: [] } }, ctx);
check('mandate compiled', c.status === 'mandate');
say(c.readback);
const before = { principal: await chain.usdc(keys.principal.address), kiln: await chain.usdc(byId.kiln.pay_to), mugworks: await chain.usdc(byId.mugworks.pay_to) };
const grant_tx = await chain.sendGrant(keys.principal, c.mandate);
say(`grant tx ${explorerTx(grant_tx)}  mandate id ${mandateId(c.mandate)}`);
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iussum-smoke-agent-'));
const agent = await createAgent({ mandate: c.mandate, grant_tx, signer: keys.agent, rpc: chain.rpc, dataDir });
const pins = {}; for (const s of shops) pins[s.id] = await shopKey(s);
try {
  say('\n-- kiln (honest)');
  const a = await buyPhoto({ agent, shop: byId.kiln, sku: 'mug-front', pinnedKey: pins.kiln });
  check('kiln purchase ok and every check passes', a.ok, a.ok ? '' : JSON.stringify(a.checks ?? a));
  if (a.receipt) say(`  payment tx ${explorerTx(a.receipt.tx_sig)}`);
  say('\n-- mugworks (swap shop)');
  const b = await buyPhoto({ agent, shop: byId.mugworks, sku: 'mug-front', pinnedKey: pins.mugworks });
  check('mugworks purchase ok and every check passes (the attestation is honest about the swapped bytes)', b.ok, b.ok ? '' : JSON.stringify(b.checks ?? b));
  if (a.bytes && b.bytes) check('mugworks delivered different bytes from the advertised image', Buffer.compare(b.bytes, fs.readFileSync(path.join(catalogDir, 'mugworks', 'mug-front.png'))) !== 0);
  if (b.receipt) say(`  payment tx ${explorerTx(b.receipt.tx_sig)}`);
  say('\n-- glazed (not on the list)');
  try { await buyPhoto({ agent, shop: byId.glazed, sku: 'mug-front', pinnedKey: pins.glazed }); check('diligent agent refuses glazed', false, 'it paid'); }
  catch (e) { check('diligent agent refuses glazed before signing', e instanceof IussumRefusal, `${e.reason ?? e.message}`); }
  const naive = await createAgent({ mandate: c.mandate, grant_tx, signer: keys.agent, rpc: chain.rpc, localChecks: false });
  const g = await naive.fetch(`${byId.glazed.origin}${byId.glazed.base}/v1/photo/mug-front`);
  const gb = await g.json().catch(() => ({}));
  check('a naive agent is stopped by the glazed shop gate (403)', g.status === 403, `HTTP ${g.status} ${gb.error ?? ''} ${gb.reason ?? ''}`);
  await naive.close();
} finally { await agent.close(); }
const after = { principal: await chain.usdc(keys.principal.address), kiln: await chain.usdc(byId.kiln.pay_to), mugworks: await chain.usdc(byId.mugworks.pay_to) };
say(`\nbalances (USDC): principal ${fmtUsdc(before.principal)} -> ${fmtUsdc(after.principal)}; kiln +${fmtUsdc(after.kiln - before.kiln)}; mugworks +${fmtUsdc(after.mugworks - before.mugworks)}`);
check('principal paid exactly 0.45 USDC (0.30 + 0.15)', before.principal - after.principal === 450000n);
check('kiln received 0.30 and mugworks 0.15', after.kiln - before.kiln === 300000n && after.mugworks - before.mugworks === 150000n);
close(); server.close();
say(failed ? `\n${failed} CHECK(S) FAILED` : '\nall checks passed');
process.exit(failed ? 1 : 0);
