// The live demo server: node scripts/serve.mjs
//   ORIGIN        public origin the shops and the page are served from (default http://127.0.0.1:$PORT); https in production
//   PORT          default 8790, bound to 127.0.0.1 (the Cloudflare tunnel connects to it)
//   MODEL_PROVIDER / MODEL_PROVIDER_<JOB> / MODEL_API_KEY / BASETEN_API_KEY / MODAL_SAM_URL   see models/PROVIDERS.md
//   DEV_STUBS=1   no model key: stubs for the model calls (refused when DEMO=1); the page shows a red banner
//   DATA_DIR      default ./data (catalogue, runs, verdict database, cost ledger)   SECRETS_DIR  default ./.secrets
//   TRUST_CF=1    honour CF-Connecting-IP for the per-IP limits (only behind the tunnel)
//   RECHECK=1     the arbiter re-runs the delivery check itself before ruling
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { makeRefundSender } from '@iussum/resolver';
import { makeChain, loadChainKeys, DEVNET } from '../src/chain/chain.js';
import { loadShopKeys, shopRegistry, createShopsApp } from '../src/shops/registry.js';
import { makeCatalogs } from '../src/shops/make-catalogs.js';
import { createPipeline } from '../src/run/pipeline.js';
import { createArbiter } from '../src/dispute/arbiter.js';
import { openDisputeStore } from '../src/dispute/store.js';
import { createProvider } from '../models/provider.js';
import { CostLedger } from '../models/cost.js';
import { createWebApp } from '../src/web/server.js';
import { makeDevProvider } from '../src/web/dev-stubs.js';
import { stubImageProvider } from '../test/helpers.js';

const env = process.env, root = new URL('..', import.meta.url).pathname;
const PORT = Number(env.PORT ?? 8790), origin = env.ORIGIN ?? `http://127.0.0.1:${PORT}`;
const dataDir = path.resolve(env.DATA_DIR ?? path.join(root, 'data')), secrets = path.resolve(env.SECRETS_DIR ?? path.join(root, '.secrets'));
const devStubs = env.DEV_STUBS === '1';
if (devStubs && env.DEMO === '1') { console.error('refusing to start: DEV_STUBS=1 together with DEMO=1'); process.exit(2); }
fs.mkdirSync(dataDir, { recursive: true });

const chain = makeChain(), keys = await loadChainKeys(secrets), shopKeys = await loadShopKeys(secrets);
const catalogDir = path.join(dataDir, 'catalog');
if (!fs.existsSync(path.join(catalogDir, 'kiln', 'catalog.json'))) {
  if (!devStubs) { console.error(`no catalogue in ${catalogDir}: run  node scripts/make-catalogs.mjs  first (needs the Muse Image provider)`); process.exit(2); }
  await makeCatalogs({ provider: stubImageProvider(), catalogDir }); // SYNTHETIC images, dev stubs only
}
const shopIds = ['kiln', 'mugworks', 'glazed'];
const provider = devStubs ? makeDevProvider({ catalogDir, shopIds }) : createProvider({ env, ledger: new CostLedger({ file: path.join(dataDir, 'cost.jsonl'), stopAtUsd: Number(env.STOP_AT_USD ?? 70) }) });
const shopsApp = createShopsApp({ origin, catalogDir, keys: shopKeys, rpc: chain.rpc, network: DEVNET.network, asset: DEVNET.mint, facilitatorUrl: DEVNET.facilitator, dataDir: path.join(dataDir, 'gate') });
const shops = shopRegistry({ origin, keys: shopKeys });

let pipeline;
const store = openDisputeStore(path.join(dataDir, 'disputes.db'));
const arbiter = createArbiter({ rpc: chain.rpc, store, sendRefund: makeRefundSender({ rpc: chain.rpc, float: keys.float }), provider: env.RECHECK === '1' ? provider : null, recheck: env.RECHECK === '1', allowFixture: false,
  sellerKey: async (pay_to) => { const s = shops.find((x) => x.pay_to === pay_to); return s ? pipeline.pinned(s) : null; } });
const shopper = devStubs ? provider.scripted({ allowedShopIds: ['kiln', 'mugworks'], noun_phrase: 'red ceramic mug', count: 3 }) : provider;
pipeline = createPipeline({ chain, keys, shops, provider, shopperProvider: shopper, arbiter, outDir: path.join(dataDir, 'runs') });
const ctxBase = { shops, principal: keys.principal.address, agent: keys.agent.address, network: DEVNET.network, asset: DEVNET.mint };
const { app } = createWebApp({ ctxBase, provider, pipeline, arbiter, shopsApp: shopsApp.app, chain, keys, outDir: path.join(dataDir, 'runs'), webDir: path.join(root, 'web'), devStubs, trustCf: env.TRUST_CF === '1' });
const server = http.createServer(app);
server.listen(PORT, '127.0.0.1', () => console.log(`iussum-agent on http://127.0.0.1:${PORT}  origin ${origin}  ${devStubs ? 'DEV STUBS (no model is called)' : `providers ${JSON.stringify(Object.fromEntries(['compileMandate', 'vision', 'segment', 'agentStep', 'transcribe'].map((j) => [j, provider.adapterName(j)])))}`}`));
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => { server.close(); shopsApp.close(); store.close(); process.exit(0); });
