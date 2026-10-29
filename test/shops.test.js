import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import { sign as edSign } from 'node:crypto';
import path from 'node:path';
import { receiptKey, canonicalize } from '@iussum/core';
import { signDelivery, verifyDelivery, encodeDelivery, decodeDelivery, deliveryShapeErrors, contentSha256 } from '../src/shops/attest.js';
import { makeCatalogs } from '../src/shops/make-catalogs.js';
import { loadCatalog } from '../src/shops/shop.js';
import { SHOP_DEFS, shopRegistry, shopBase } from '../src/shops/registry.js';
import { CATALOG_SPEC } from '../src/shops/catalog-spec.js';
import { stubImageProvider } from './helpers.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'iussum-shops-'));
const body = (key, over = {}) => ({ shop: key.publicKey, resource: 'https://meta.example/shops/mugworks/v1/photo/mug-front', sku: 'mug-front', content_sha256: contentSha256(Buffer.from('img')), content_type: 'image/png', delivered_at: 1_800_000_000, payer: 'AgentAddr1111111111111111111111111111111111', offer_hash: 'a'.repeat(64), ...over });

test('delivery attestation: sign, verify, encode round trip', () => {
  const key = receiptKey();
  const a = signDelivery(body(key), key);
  assert.deepEqual(deliveryShapeErrors(a), []);
  assert.deepEqual(verifyDelivery(a, key.publicKey), { ok: true });
  assert.deepEqual(verifyDelivery(decodeDelivery(encodeDelivery(a)), key.publicKey), { ok: true });
});
test('delivery attestation: any edit, another key, a wrong pinned key, or a malformed shape fails', () => {
  const key = receiptKey(), other = receiptKey();
  const a = signDelivery(body(key), key);
  for (const [k, v] of [['content_sha256', 'b'.repeat(64)], ['resource', 'https://evil/x'], ['sku', 'mug-top'], ['delivered_at', 1], ['payer', 'x'], ['offer_hash', 'c'.repeat(64)], ['content_type', 'image/jpeg']]) {
    assert.equal(verifyDelivery({ ...a, [k]: v }, key.publicKey).ok, false, k);
  }
  assert.equal(verifyDelivery(a, other.publicKey).ok, false); // pinned key is another shop's
  assert.equal(verifyDelivery(signDelivery(body(other), other), key.publicKey).ok, false); // names another key
  assert.equal(verifyDelivery({ ...a, extra: 1 }, key.publicKey).ok, false);
  assert.equal(verifyDelivery({ ...a, signature: 'AAAA' }, key.publicKey).ok, false);
  assert.equal(verifyDelivery(a, null).ok, false);
  assert.equal(verifyDelivery(null, key.publicKey).ok, false);
  assert.equal(verifyDelivery({ ...a, signature: undefined }, key.publicKey).ok, false);
});
test('a signature made with the payment-receipt message prefix does not verify as a delivery (domain separation)', () => {
  const key = receiptKey();
  const a = signDelivery(body(key), key);
  const { signature: _s, ...b } = a;
  const forged = { ...b, signature: edSign(null, Buffer.from(`iussum/0.2 receipt\n${canonicalize(b)}`, 'utf8'), key.privateKey).toString('base64') };
  assert.equal(verifyDelivery(forged, key.publicKey).ok, false);
  assert.equal(verifyDelivery(a, key.publicKey).ok, true); // negative control: the real signature over the same body passes
});

test('makeCatalogs with a stub provider writes a valid catalogue per shop; the swap shop delivers a different image', async () => {
  const dir = tmp(), p = stubImageProvider();
  const made = await makeCatalogs({ provider: p, catalogDir: dir });
  assert.equal(p.calls.filter((c) => c[0] === 'generate').length, 12);
  assert.equal(p.calls.filter((c) => c[0] === 'edit').length, 4);
  assert.equal(made.length, 16);
  for (const d of SHOP_DEFS) {
    const cat = loadCatalog(dir, d.id);
    assert.equal(cat.items.length, 4);
    assert.equal(cat.honesty, CATALOG_SPEC[d.id].honesty);
  }
  const mw = loadCatalog(dir, 'mugworks');
  for (const it of mw.items) assert.notEqual(fs.readFileSync(path.join(dir, 'mugworks', it.image)).toString('hex'), fs.readFileSync(path.join(dir, 'mugworks', it.delivered_image)).toString('hex'));
  assert.equal(loadCatalog(dir, 'kiln').items.some((i) => i.delivered_image), false);
  // a second run spends nothing
  const again = stubImageProvider();
  await makeCatalogs({ provider: again, catalogDir: dir });
  assert.equal(again.calls.length, 0);
  const forced = stubImageProvider();
  await makeCatalogs({ provider: forced, catalogDir: dir, force: true, only: ['kiln'] });
  assert.equal(forced.calls.length, 4);
});
test('prices: the dishonest shop is cheaper than the honest one that is on the list, and glazed is cheapest', () => {
  const price = (id) => Number(CATALOG_SPEC[id].items[0].price_usdc);
  assert.ok(price('mugworks') < price('kiln'));
  assert.ok(price('glazed') < price('mugworks'));
});
test('loadCatalog refuses an honest shop that names a delivered image, a swap shop without one, bad skus and bad prices', async () => {
  const dir = tmp();
  await makeCatalogs({ provider: stubImageProvider(), catalogDir: dir });
  const edit = (id, f) => { const file = path.join(dir, id, 'catalog.json'); const c = JSON.parse(fs.readFileSync(file, 'utf8')); f(c); fs.writeFileSync(file, JSON.stringify(c)); };
  edit('kiln', (c) => { c.items[0].delivered_image = 'x.png'; });
  assert.throws(() => loadCatalog(dir, 'kiln'), /must not name a delivered_image/);
  edit('mugworks', (c) => { delete c.items[0].delivered_image; });
  assert.throws(() => loadCatalog(dir, 'mugworks'), /needs delivered_image/);
  edit('glazed', (c) => { c.items[0].sku = '../x'; });
  assert.throws(() => loadCatalog(dir, 'glazed'), /bad or duplicate sku/);
  edit('glazed', (c) => { c.items[0].sku = 'a'; c.items[0].price_usdc = '0'; });
  assert.throws(() => loadCatalog(dir, 'glazed'), /bad price/);
  edit('glazed', (c) => { c.items[0].price_usdc = '0.1'; c.items[1].sku = 'a'; });
  assert.throws(() => loadCatalog(dir, 'glazed'), /bad or duplicate sku/);
  assert.throws(() => loadCatalog(dir, 'nonexistent'), /ENOENT/);
});
test('registry: each shop has its own prefix under one origin, and the prefixes do not nest', () => {
  const keys = Object.fromEntries(SHOP_DEFS.map((d, i) => [d.id, { signer: { address: `Addr${i}` } }]));
  const reg = shopRegistry({ origin: 'https://meta.example', keys });
  assert.deepEqual(reg.map((r) => r.resource_prefix), SHOP_DEFS.map((d) => `https://meta.example${shopBase(d.id)}/v1/`));
  for (const a of reg) for (const b of reg) if (a !== b) assert.equal(a.resource_prefix.startsWith(b.resource_prefix), false);
});

import { buildRealCatalogs, fetchPhotos, REAL_SPEC, PHOTOS, sourcesMarkdown } from '../src/shops/real-catalog.js';
import sharp from 'sharp';
test('real catalogue: built from open-licence photos, every item carries its credit, the dishonest shop delivers a different file, SOURCES.md lists every photo', async () => {
  const photosDir = tmp(), catalogDir = tmp();
  const colour = { mug: '#c33', glass: '#9cf' };
  await fetchPhotos({ photosDir, fetchBytes: async (url) => sharp({ create: { width: 1500, height: 2000, channels: 3, background: /Tumbler/.test(url) ? colour.glass : colour.mug } }).jpeg().toBuffer() });
  assert.deepEqual(fs.readdirSync(photosDir).sort(), Object.keys(PHOTOS).map((k) => `${k}.png`).sort());
  assert.equal((await sharp(path.join(photosDir, 'mug1.png')).metadata()).height, 1024); // resized to at most 1024 on the long side
  buildRealCatalogs({ photosDir, catalogDir });
  for (const d of SHOP_DEFS) {
    const cat = loadCatalog(catalogDir, d.id);
    assert.equal(cat.items.length, REAL_SPEC[d.id].items.length);
    for (const it of cat.items) { assert.ok(it.credit.author && it.credit.license && it.credit.source.startsWith('https://commons.wikimedia.org/wiki/File:')); assert.match(it.credit.license, /^(CC0|CC BY)/); }
  }
  const mw = loadCatalog(catalogDir, 'mugworks');
  for (const it of mw.items) { assert.notEqual(fs.readFileSync(path.join(catalogDir, 'mugworks', it.image)).toString('hex'), fs.readFileSync(path.join(catalogDir, 'mugworks', it.delivered_image)).toString('hex')); assert.ok(it.delivered_credit.license); }
  assert.equal(loadCatalog(catalogDir, 'glazed').items.length, 2);
  const md = fs.readFileSync(path.join(catalogDir, 'SOURCES.md'), 'utf8');
  for (const k of Object.keys(PHOTOS)) assert.ok(md.includes(`${k}.png`), k);
  assert.match(md, /Muse Image was planned/);
  assert.equal(sourcesMarkdown(), md);
  for (const p of Object.values(PHOTOS)) assert.match(p.license, /^(CC0 1\.0|CC BY \d\.\d)$/); // no SA/NC/ND
});
