import fs from 'node:fs';
import { generateKeyPairSigner } from '@solana/kit';

export const NET = 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1';
export const MINT = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
export const evalSpec = JSON.parse(fs.readFileSync(new URL('../eval/requests.json', import.meta.url), 'utf8'));
const addr = async () => (await generateKeyPairSigner()).address;
export async function makeCtx(over = {}) {
  const shops = [];
  for (const s of evalSpec.shops) shops.push({ ...s, pay_to: await addr(), origin: `https://shops.example/${s.id}` });
  return { shops, principal: await addr(), agent: await addr(), network: NET, asset: MINT, now: 1_800_000_000, nonce: 'ab'.repeat(16), ...over };
}
// a raw model answer with every field present (nulls where nothing was said)
export const raw = (o = {}) => ({ status: 'mandate', clarify_field: null, reject_code: null, total_cap_usdc: null, per_payment_max_usdc: null, valid_for_hours: null, shops: [], item: { noun_phrase: null, count: null, must_not: [] }, ...o, item: { noun_phrase: null, count: null, must_not: [], ...(o.item ?? {}) } });
