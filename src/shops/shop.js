// One demo shop: an Express router that sells product photos over x402 on Solana devnet, with the prior iussum seller gate mounted ahead of
// x402's paymentMiddleware (prior/iussum/packages/seller, used as a library). NEW here: file-based catalogues, the signed delivery attestation,
// and the `swap` honesty mode in which the shop delivers a different image from the one it advertised (generated with Muse Image edits, see scripts/make-catalogs.js).
//
// Catalogue on disk (catalogDir/<id>/): catalog.json + the image files it names.
//   { id, name, honesty: 'honest' | 'swap', items: [{ sku, title, description, price_usdc, image, delivered_image? }] }
//   `image` is what the catalogue preview shows and the offer describes; `delivered_image` (swap shops only) is what is actually sent after payment.
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { x402ResourceServer, HTTPFacilitatorClient } from '@x402/core/server';
import { paymentMiddleware } from '@x402/express';
import { registerExactSvmScheme } from '@x402/svm/exact/server';
import { createSellerGate, readPaymentHeader, decodePayment } from '@iussum/seller';
import { receiptKey, offerHash } from '@iussum/core';
import { usdcToBase } from '../intent/compile.js';
import { signDelivery, encodeDelivery, contentSha256 } from './attest.js';

export function loadCatalog(catalogDir, id) {
  const dir = path.join(catalogDir, id);
  const cat = JSON.parse(fs.readFileSync(path.join(dir, 'catalog.json'), 'utf8'));
  if (cat.id !== id) throw new Error(`catalog ${dir}: id is ${cat.id}, expected ${id}`);
  if (!['honest', 'swap'].includes(cat.honesty)) throw new Error(`catalog ${id}: honesty must be honest or swap`);
  const seen = new Set();
  for (const it of cat.items) {
    if (!/^[a-z0-9-]{1,40}$/.test(it.sku) || seen.has(it.sku)) throw new Error(`catalog ${id}: bad or duplicate sku ${it.sku}`);
    seen.add(it.sku);
    if (usdcToBase(it.price_usdc) === null || usdcToBase(it.price_usdc) <= 0n) throw new Error(`catalog ${id}: bad price for ${it.sku}`);
    if (cat.honesty === 'swap' && !it.delivered_image) throw new Error(`catalog ${id}: a swap shop needs delivered_image for ${it.sku}`);
    if (cat.honesty === 'honest' && it.delivered_image) throw new Error(`catalog ${id}: an honest shop must not name a delivered_image (${it.sku})`);
  }
  return { ...cat, dir };
}
const readImage = (cat, file) => { const p = path.join(cat.dir, file); if (path.dirname(p) !== cat.dir) throw new Error('image path escapes the catalogue'); return fs.existsSync(p) ? fs.readFileSync(p) : null; };

// cfg: { catalog, signer (pay_to), seed (32-byte receipt key seed, persisted by the caller), origin, base ('/shops/kiln'), network, asset, rpc, facilitatorUrl, mode, dataDir, now, log }
export function createShop(cfg) {
  const { catalog: cat, signer, origin, base = '', network, asset, rpc, facilitatorUrl, mode = 'enforce', now = () => Math.floor(Date.now() / 1000), log = () => {} } = cfg;
  const key = receiptKey(cfg.seed);
  const gate = createSellerGate({ mode, payTo: signer.address, asset, network, rpc, origin, dataDir: cfg.dataDir, key, log });
  const router = express.Router();
  router.get('/.well-known/iussum.json', gate.wellKnown);
  router.get('/v1/catalog', (_req, res) => res.json({ shop: cat.name, id: cat.id, pay_to: signer.address, network, asset, items: cat.items.map((i) => ({ sku: i.sku, title: i.title, description: i.description, price_usdc: i.price_usdc, price: usdcToBase(i.price_usdc).toString(), preview: `${origin}${base}/v1/preview/${i.sku}`, resource: `${origin}${base}/v1/photo/${i.sku}` })) }));
  router.get('/v1/preview/:sku', (req, res) => {
    const it = cat.items.find((i) => i.sku === req.params.sku);
    const img = it && readImage(cat, it.image);
    if (!img) return res.status(it ? 503 : 404).json({ error: it ? 'catalog_image_missing' : 'unknown_sku' });
    res.type('image/png').send(img);
  });
  const server = new x402ResourceServer(new HTTPFacilitatorClient({ url: facilitatorUrl }));
  registerExactSvmScheme(server, { networks: [network] });
  const routes = Object.fromEntries(cat.items.map((i) => [`GET /v1/photo/${i.sku}`, { accepts: [{ scheme: 'exact', price: { amount: usdcToBase(i.price_usdc).toString(), asset }, network, payTo: signer.address }], description: `${cat.name}: ${i.title}`, mimeType: 'image/png' }]));
  router.use(gate.middleware);
  router.use(paymentMiddleware(routes, server));
  router.get('/v1/photo/:sku', (req, res) => {
    const it = cat.items.find((i) => i.sku === req.params.sku);
    if (!it) return res.status(404).json({ error: 'unknown_sku' });
    const file = cat.honesty === 'swap' ? it.delivered_image : it.image;
    const img = readImage(cat, file);
    if (!img) return res.status(503).json({ error: 'catalog_image_missing' }); // never a placeholder: a shop with no image does not pretend to have one
    let payer = null, offer = null;
    try { const p = readPaymentHeader(req); payer = p?.payload?.transaction ? (decodePayment(p.payload.transaction).authority ?? null) : null; offer = p?.accepted ? offerHash(p.accepted) : null; } catch { /* x402 already validated the header */ }
    const att = signDelivery({ shop: key.publicKey, resource: `${origin}${req.originalUrl.split('?')[0]}`, sku: it.sku, content_sha256: contentSha256(img), content_type: 'image/png', delivered_at: now(), payer: payer ?? 'unknown', offer_hash: offer ?? '0'.repeat(64) }, key);
    res.set('X-DELIVERY-ATTESTATION', encodeDelivery(att)).type('image/png').send(img);
  });
  return { router, gate, key, address: signer.address, publicKey: key.publicKey, catalog: cat, close: () => gate.close() };
}
