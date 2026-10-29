// The three demo shops and how they are wired together. Ids and names are what the intent compiler knows (eval/requests.json carries the same list).
// kiln: honest, dearer. mugworks: cheaper, DISHONEST (catalogue says one thing, delivery is another). glazed: cheapest, honest, normally NOT on the person's list
// (it tests that the agent never pays a shop outside the mandate).
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import express from 'express';
import { createKeyPairSignerFromBytes } from '@solana/kit';
import { loadCatalog, createShop } from './shop.js';

export const SHOP_DEFS = [
  { id: 'kiln', name: 'Kiln & Co', aliases: ['Kiln and Co', 'Kiln'], keypair: 'seller' },
  { id: 'mugworks', name: 'Mugworks', aliases: ['Mug works', 'Mudworks'], keypair: 'seller2' },
  { id: 'glazed', name: 'Glazed Studio', aliases: ['Glazed'], keypair: 'seller3' },
];

// secretsDir holds <keypair>.json (a 64-byte Solana keypair as a JSON array, devnet throw-away keys) and shop-<id>.seed (32 bytes hex, the receipt/attestation key).
export async function loadShopKeys(secretsDir) {
  const out = {};
  for (const d of SHOP_DEFS) {
    const signer = await createKeyPairSignerFromBytes(new Uint8Array(JSON.parse(fs.readFileSync(path.join(secretsDir, `${d.keypair}.json`), 'utf8'))));
    const seedFile = path.join(secretsDir, `shop-${d.id}.seed`);
    if (!fs.existsSync(seedFile)) fs.writeFileSync(seedFile, randomBytes(32).toString('hex'), { mode: 0o600 });
    out[d.id] = { signer, seed: Buffer.from(fs.readFileSync(seedFile, 'utf8').trim(), 'hex') };
    if (out[d.id].seed.length !== 32) throw new Error(`${seedFile} is not 32 bytes of hex`);
  }
  return out;
}
export const shopBase = (id) => `/shops/${id}`;
// The list the compiler and the agent use: pay_to (devnet address), origin, and the exact resource prefix a mandate allows for that shop.
export function shopRegistry({ origin, keys }) {
  return SHOP_DEFS.map((d) => ({ id: d.id, name: d.name, aliases: d.aliases, pay_to: keys[d.id].signer.address, origin, base: shopBase(d.id), resource_prefix: `${origin}${shopBase(d.id)}/v1/` }));
}
export function createShopsApp({ origin, catalogDir, keys, rpc, network, asset, facilitatorUrl, dataDir, mode = 'enforce', now, log }) {
  const app = express();
  app.set('trust proxy', true); // behind the Cloudflare tunnel the request is https; x402 builds its resource URL from req.protocol
  const shops = {};
  for (const d of SHOP_DEFS) {
    const shop = createShop({ catalog: loadCatalog(catalogDir, d.id), signer: keys[d.id].signer, seed: keys[d.id].seed, origin, base: shopBase(d.id), network, asset, rpc, facilitatorUrl, mode, dataDir: dataDir ? path.join(dataDir, d.id) : undefined, now, log });
    if (dataDir) fs.mkdirSync(path.join(dataDir, d.id), { recursive: true });
    app.use(shopBase(d.id), shop.router);
    shops[d.id] = shop;
  }
  return { app, shops, close: () => Object.values(shops).forEach((s) => s.close()) };
}
