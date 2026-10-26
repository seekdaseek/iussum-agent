// Shared builders: a signed receipt + delivery attestation + evidence record, and a fake chain that serves the matching payment transaction.
import { receiptKey, signReceipt, offerHash } from '@iussum/core';
import { generateKeyPairSigner } from '@solana/kit';
import { TOKEN_PROGRAM_ADDRESS } from '@solana-program/token';
import { signDelivery, contentSha256 } from '../src/shops/attest.js';
import { runDeliveryCheck } from '../src/evidence/check.js';
import { buildEvidence } from '../src/evidence/record.js';
import { readSamResult } from '../models/adapters/meta.js';
import { syntheticPng } from './helpers.js';

export const SAM_SAMPLE = '<0f>0<|box;x1=211;y1=228;x2=270;y2=254;w=320;h=334|>' + "<|mask;x=0;y=0;data=27,60,~!!!!M!0c[0o91w?q1!pIH4pPRVp2B3'7`e.ioeAf6-k/#Xd8%dX9x(|>" + ',1<|box;x1=155;y1=228;x2=202;y2=254;w=320;h=334|>' + '<|mask;x=0;y=0;data=27,48,~!!!!J!0c[q=Pj_zs=*4C4(/./x#:/`S_GnD`=o3?X{emCgO$y@|>\n';
export const vans = (matches_offer, confidence = 0.9, extra = {}) => ({ observed_object: 'mug', observed_colour: 'red', observed_material: 'ceramic', matches_offer, violates_must_not: false, confidence, reason: 'r', ...extra });
export const stubProvider = ({ seg = SAM_SAMPLE, vision, tag = 'meta' }) => ({
  calls: [],
  async segment() { if (seg instanceof Error) throw seg; return { value: await readSamResult(seg), meta: { provider: tag, model: 'sam-3.1', latencyMs: 1, costUsd: 0.0025 } }; },
  async vision() { const v = vision.shift(); if (v instanceof Error) throw v; return { value: v, meta: { provider: tag, model: 'muse-spark-1.3', latencyMs: 1, costUsd: 0.001 } }; },
});
export const OFFER = { shop: 'mugworks', sku: 'mug-front', title: 'Red ceramic mug, front view', description: 'Photo of a glossy red ceramic coffee mug.' };
export const SPEC = { noun_phrase: 'red ceramic mug', must_not: [] };

// vision: the scripted answers for [full, crop]; txSig must be unique per case
export async function makeCase({ vision = [vans('no', 0.95), vans('no', 0.9)], seg = SAM_SAMPLE, txSig = `T${Math.random().toString(36).slice(2)}`.padEnd(88, 'T'), amount = '150000', mandate = null } = {}) {
  const key = receiptKey();
  const principal = (await generateKeyPairSigner()).address, srcAta = (await generateKeyPairSigner()).address, dstAta = (await generateKeyPairSigner()).address, agent = (await generateKeyPairSigner()).address, mint = (await generateKeyPairSigner()).address;
  const img = await syntheticPng('glass');
  const url = 'https://meta.example/shops/mugworks/v1/photo/mug-front';
  const accepted = { scheme: 'exact', network: 'solana:x', amount };
  const receipt = signReceipt({ v: 'iussum/0.2', mandate_id: mandate?.id ?? null, grant_tx: mandate ? 'G'.repeat(88) : null, offer_hash: offerHash(accepted), resource: url, pay_to: key.publicKey, asset: mint, network: 'solana:x', amount, payer: agent, tx_sig: txSig, settled_at: 1_800_000_100, seller: key.publicKey }, key);
  const attestation = signDelivery({ shop: key.publicKey, resource: url, sku: 'mug-front', content_sha256: contentSha256(img), content_type: 'image/png', delivered_at: 1_800_000_099, payer: agent, offer_hash: offerHash(accepted) }, key);
  const run = await runDeliveryCheck({ provider: stubProvider({ seg, vision: [...vision] }), image: img, offer: OFFER, spec: SPEC });
  const ev = buildEvidence({ receipt, mandate_id: receipt.mandate_id, grant_tx: receipt.grant_tx, offer: OFFER, spec: SPEC, delivery: { bytes: img, attestation }, run, now: 1_800_000_200 });
  // what getTransaction (jsonParsed) returns for the payment
  const tx = { slot: 1, blockTime: 1_800_000_100, transaction: { signatures: [txSig], message: { accountKeys: [{ pubkey: srcAta }, { pubkey: dstAta }, { pubkey: agent }], instructions: [{ programId: TOKEN_PROGRAM_ADDRESS, parsed: { type: 'transferChecked', info: { source: srcAta, destination: dstAta, mint, authority: agent, tokenAmount: { amount, decimals: 6 } } } }] } }, meta: { err: null, fee: 5000, preTokenBalances: [{ accountIndex: 0, owner: principal, mint, uiTokenAmount: { amount: '1000000' } }, { accountIndex: 1, owner: key.publicKey, mint, uiTokenAmount: { amount: '0' } }], postTokenBalances: [{ accountIndex: 0, owner: principal, mint, uiTokenAmount: { amount: String(1_000_000 - Number(amount)) } }, { accountIndex: 1, owner: key.publicKey, mint, uiTokenAmount: { amount } }] } };
  return { key, img, run, ev, receipt, tx, principal, mint, txSig, payload: { evidence: ev, overlay_png_b64: run.overlay_png.toString('base64'), delivered_b64: img.toString('base64') } };
}
export const fakeRpc = (txs, statuses = {}) => ({
  getTransaction: async (sig) => txs[sig] ?? null,
  call: async (method, params) => { if (method === 'getSignatureStatuses') return { value: params[0].map((s) => statuses[s] ?? null) }; throw new Error(`unexpected rpc ${method}`); },
});
