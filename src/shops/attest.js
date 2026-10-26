// Delivery attestation (NEW in this repo; the prior iussum receipt proves the PAYMENT, not what was delivered).
// The shop signs, with the same Ed25519 key it signs payment receipts with (published at /.well-known/iussum.json), a statement of what bytes it sent:
//   body = { v, shop, resource, sku, content_sha256, content_type, delivered_at, payer, offer_hash }
// message = "iussum-agent delivery/0.1\n" + JCS(body). Without it a dispute would rest on the buyer's word about what arrived.
// Binding to the payment: x402 settles AFTER the handler runs, so the settlement transaction id does not exist yet when the shop signs. The attestation therefore
// binds to the payment by (resource, payer, offer_hash), the same three values the payment receipt carries. Documented limit: two payments by the same payer for the
// same resource and offer cannot be told apart by the attestation alone; the evidence record adds the receipt's tx_sig and the delivery time.
import { createPublicKey, sign as edSign, verify as edVerify } from 'node:crypto';
import { getAddressEncoder } from '@solana/kit';
import { canonicalize, sha256Hex } from '@iussum/core';

export const DELIVERY_VERSION = 'iussum-agent/delivery-0.1';
const SPKI = Buffer.from('302a300506032b6570032100', 'hex');
const FIELDS = ['v', 'shop', 'resource', 'sku', 'content_sha256', 'content_type', 'delivered_at', 'payer', 'offer_hash'];
const message = (body) => Buffer.from(`iussum-agent delivery/0.1\n${canonicalize(body)}`, 'utf8');

export function signDelivery(body, key) {
  const b = Object.fromEntries(FIELDS.map((k) => [k, body[k]]));
  b.v = DELIVERY_VERSION;
  return { ...b, signature: edSign(null, message(b), key.privateKey).toString('base64') };
}
export function deliveryShapeErrors(d) {
  if (d === null || typeof d !== 'object' || Array.isArray(d)) return ['attestation is not an object'];
  const e = [];
  for (const k of [...FIELDS, 'signature']) if (!(k in d)) e.push(`missing ${k}`);
  for (const k of Object.keys(d)) if (![...FIELDS, 'signature'].includes(k)) e.push(`unknown key ${k}`);
  if (e.length) return e;
  if (d.v !== DELIVERY_VERSION) e.push('bad v');
  if (!/^[0-9a-f]{64}$/.test(d.content_sha256)) e.push('content_sha256 is not 64 hex');
  if (!/^[0-9a-f]{64}$/.test(d.offer_hash)) e.push('offer_hash is not 64 hex');
  if (!Number.isSafeInteger(d.delivered_at)) e.push('delivered_at is not unix seconds');
  for (const k of ['shop', 'resource', 'sku', 'content_type', 'payer', 'signature']) if (typeof d[k] !== 'string' || !d[k]) e.push(`${k} must be a non-empty string`);
  return e;
}
// pubkeyB58 comes from the shop's pinned .well-known, never from the attestation.
export function verifyDelivery(d, pubkeyB58) {
  const shape = deliveryShapeErrors(d);
  if (shape.length) return { ok: false, why: `shape: ${shape.join('; ')}` };
  if (!pubkeyB58) return { ok: false, why: 'shop key unknown' };
  if (d.shop !== pubkeyB58) return { ok: false, why: 'attestation names another shop key' };
  const { signature, ...body } = d;
  let key;
  try { key = createPublicKey({ key: Buffer.concat([SPKI, Buffer.from(getAddressEncoder().encode(pubkeyB58))]), format: 'der', type: 'spki' }); } catch { return { ok: false, why: 'shop key is not a valid public key' }; }
  return edVerify(null, message(body), key, Buffer.from(signature, 'base64')) ? { ok: true } : { ok: false, why: 'bad signature' };
}
export const encodeDelivery = (d) => Buffer.from(canonicalize(d), 'utf8').toString('base64url');
export const decodeDelivery = (s) => JSON.parse(Buffer.from(s, 'base64url').toString('utf8'));
export const contentSha256 = (bytes) => sha256Hex(Buffer.from(bytes));
