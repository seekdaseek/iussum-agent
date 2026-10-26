// Devnet integration of the WHOLE money and evidence path with synthetic images and a STUB CHECKER. No Meta model is called.
//   The stub checker is a test double that knows the ground truth (which shop swapped the image); it stands in for SAM 3.1 + Muse Spark so the chain,
//   the shops, the attestation, the evidence record, the arbiter and the refund can be exercised for real. Its answers are NOT evidence about any model.
//   node scripts/devnet-pipeline.mjs [--no-check]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { makeRefundSender } from '@iussum/resolver';
import { makeChain, loadChainKeys, DEVNET, fmtUsdc } from '../src/chain/chain.js';
import { loadShopKeys, shopRegistry, createShopsApp } from '../src/shops/registry.js';
import { makeCatalogs } from '../src/shops/make-catalogs.js';
import { decideIntent } from '../src/intent/compile.js';
import { createPipeline } from '../src/run/pipeline.js';
import { createArbiter } from '../src/dispute/arbiter.js';
import { openDisputeStore } from '../src/dispute/store.js';
import { scriptedProvider } from '../src/agent/scripted.js';
import { stubImageProvider } from '../test/helpers.js';
import { SAM_SAMPLE, vans } from '../test/cases.js';
import { readSamResult } from '../models/adapters/meta.js';

const checkDelivery = !process.argv.includes('--no-check');
const secrets = new URL('../.secrets', import.meta.url).pathname;
const chain = makeChain(), keys = await loadChainKeys(secrets), shopKeys = await loadShopKeys(secrets);
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'iussum-pipe-'));
const catalogDir = path.join(work, 'catalog');
await makeCatalogs({ provider: stubImageProvider(), catalogDir });
const server = http.createServer(); await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;
const { app, close } = createShopsApp({ origin, catalogDir, keys: shopKeys, rpc: chain.rpc, network: DEVNET.network, asset: DEVNET.mint, facilitatorUrl: DEVNET.facilitator, dataDir: path.join(work, 'gate'), log: () => {} });
server.on('request', app);
const shops = shopRegistry({ origin, keys: shopKeys });
const say = (s) => console.log(s);

// refund float: make sure it can cover the worst case (3 x 0.15)
const need = 450000n;
if ((await chain.usdc(keys.float.address)) < need + 100000n) { say(`topping up the refund float: ${await chain.sendUsdc(keys.principal, keys.float.address, 500000)}`); }

// STUB CHECKER: ground truth = whether the delivered bytes are the catalogue's advertised image for that shop
const advertised = new Set(); for (const s of shops) for (const f of fs.readdirSync(path.join(catalogDir, s.id)).filter((f) => f.endsWith('.png') && !f.includes('delivered'))) advertised.add(createHash('sha256').update(fs.readFileSync(path.join(catalogDir, s.id, f))).digest('hex'));
const sha = (b) => createHash('sha256').update(b).digest('hex');
const stubChecker = {
  async segment(img) { const ok = advertised.has(sha(img)); return { value: await readSamResult(ok ? SAM_SAMPLE : ''), meta: { provider: 'stub-checker', model: 'stub', latencyMs: 0 } }; },
  async vision(img) { return { value: advertised.has(sha(img)) ? vans('yes') : vans('no', 0.95, { observed_object: 'drinking glass' }), meta: { provider: 'stub-checker', model: 'stub', latencyMs: 0 } }; },
};
const ctx = { shops, principal: keys.principal.address, agent: keys.agent.address, network: DEVNET.network, asset: DEVNET.mint, now: Math.floor(Date.now() / 1000) };
const compiled = decideIntent({ status: 'mandate', clarify_field: null, reject_code: null, total_cap_usdc: '2', per_payment_max_usdc: '0.80', valid_for_hours: 168, shops: ['kiln', 'mugworks'], item: { noun_phrase: 'red ceramic mug', count: 3, must_not: [] } }, ctx);
const store = openDisputeStore();
let pipeline;
const arbiter = createArbiter({ rpc: chain.rpc, store, sendRefund: makeRefundSender({ rpc: chain.rpc, float: keys.float }), allowFixture: false,
  sellerKey: async (pay_to) => pipeline.pinned(shops.find((s) => s.pay_to === pay_to)) });
pipeline = createPipeline({ chain, keys, shops, provider: stubChecker, shopperProvider: scriptedProvider({ allowedShopIds: ['kiln', 'mugworks'], noun_phrase: 'red ceramic mug', count: 3 }), arbiter, outDir: path.join(work, 'runs') });

say(`checkDelivery=${checkDelivery}  work dir ${work}`);
const t0 = Date.now();
const report = await pipeline.run({ compiled, checkDelivery, onEvent: (e) => say(`  [event] ${e.type}${e.n ? ` #${e.n}` : ''}${e.outcome ? ` ${e.outcome}` : ''}${e.reason ? ` ${e.reason}` : ''}${e.refund_tx ? ` refund ${e.refund_tx.slice(0, 12)}…` : ''}`) });
say(`\nrun took ${((Date.now() - t0) / 1000).toFixed(1)} s`);
for (const p of report.purchases) say(`  #${p.n} ${p.shop}/${p.sku}: ${p.outcome}${p.verdict ? `  verdict ${p.verdict.verdict}/${p.verdict.reason}/${p.verdict.liable}` : ''}${p.verdict?.refund_url ? `\n      refund ${p.verdict.refund_url}` : ''}\n      payment ${p.payment_url}`);
say(`\nsummary ${JSON.stringify(report.summary)}`);
let failed = 0;
const check = (l, ok) => { say(`  ${ok ? 'PASS' : 'FAIL'} ${l}`); if (!ok) failed++; };
const s = report.summary;
if (checkDelivery) {
  check('3 purchases, all from the cheaper shop on the list (mugworks)', s.purchased === 3 && report.purchases.every((p) => p.shop === 'mugworks'));
  check('all 3 caught as NOT_AS_OFFERED', s.not_as_offered === 3);
  check('3 refunds paid on chain', s.refunds_paid === 3);
  check('net loss is 0 USDC', s.net_loss_usdc === '0' && s.paid_usdc === '0.45' && s.refunded_usdc === '0.45');
} else {
  check('control: 3 purchases, nothing checked, nothing refunded', s.purchased === 3 && s.not_checked === 3 && s.refunds_paid === 0);
  check('control: the principal lost 0.45 USDC', s.net_loss_usdc === '0.45');
}
close(); server.close(); store.close();
say(failed ? `\n${failed} CHECK(S) FAILED` : '\nall checks passed');
process.exit(failed ? 1 : 0);
