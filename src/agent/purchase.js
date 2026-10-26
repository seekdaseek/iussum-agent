// One purchase: pay for a photo through the prior iussum agent (which refuses locally anything outside the mandate), then verify what came back.
// Returns { ok:false, ... } for an HTTP refusal and THROWS the prior agent's IussumRefusal when the agent itself refuses before signing.
import { verifyReceipt } from '@iussum/core';
import { verifyDelivery, decodeDelivery, contentSha256 } from '../shops/attest.js';

export const photoUrl = (shop, sku) => `${shop.origin}${shop.base}/v1/photo/${sku}`;

// The shop's signing key is read from its .well-known ONCE and pinned by the caller (pass `pinned` to reuse it): a receipt or attestation never names its own key.
export async function shopKey(shop, f = globalThis.fetch) {
  const r = await f(`${shop.origin}${shop.base}/.well-known/iussum.json`);
  if (!r.ok) throw new Error(`${shop.id}: .well-known answered HTTP ${r.status}`);
  const j = await r.json();
  if (j.pay_to !== shop.pay_to) throw new Error(`${shop.id}: .well-known pay_to ${j.pay_to} is not the registry's ${shop.pay_to}`);
  return j.seller;
}

export async function buyPhoto({ agent, shop, sku, pinnedKey }) {
  const url = photoUrl(shop, sku);
  const res = await agent.fetch(url);
  if (res.status !== 200) return { ok: false, url, status: res.status, body: (await res.text()).slice(0, 500) };
  const bytes = Buffer.from(await res.arrayBuffer());
  const receipt = res.receipt ?? null;
  const attHeader = res.headers.get('x-delivery-attestation');
  const attestation = attHeader ? decodeDelivery(attHeader) : null;
  const checks = {
    receipt_present: receipt !== null,
    receipt_signature: receipt ? verifyReceipt(receipt, pinnedKey).ok : false,
    receipt_resource: receipt ? receipt.resource === url : false,
    attestation_present: attestation !== null,
    attestation_signature: attestation ? verifyDelivery(attestation, pinnedKey).ok : false,
    attestation_resource: attestation ? attestation.resource === url : false,
    attestation_matches_bytes: attestation ? attestation.content_sha256 === contentSha256(bytes) : false,
    attestation_offer_matches_receipt: attestation && receipt ? attestation.offer_hash === receipt.offer_hash : false,
  };
  return { ok: Object.values(checks).every(Boolean), paid: receipt !== null, url, sku, shop: shop.id, bytes, receipt, attestation, checks };
}
