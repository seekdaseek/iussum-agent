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

// SYNTHETIC images for engineering tests only (flat shapes drawn with sharp). They are not Muse Image output and never appear in the demo.
import sharp from 'sharp';
export async function syntheticPng(kind) {
  const body = {
    'red-mug': '<rect x="80" y="90" width="90" height="100" rx="10" fill="#c0272d"/><path d="M170 110 h25 a20 20 0 0 1 0 50 h-25" fill="none" stroke="#c0272d" stroke-width="12"/>',
    'glass': '<rect x="80" y="90" width="90" height="100" rx="10" fill="#cfe8f5" fill-opacity="0.5" stroke="#6aa3c4" stroke-width="3"/>',
    'blue-teapot': '<ellipse cx="128" cy="140" rx="60" ry="45" fill="#1f3a93"/>',
    'green-teapot': '<ellipse cx="128" cy="140" rx="60" ry="45" fill="#2e8b57"/>',
  }[kind];
  return sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#fff"/>${body}</svg>`)).png().toBuffer();
}
// a stub of models/provider.js generateImage/editImage that returns synthetic images
export const stubImageProvider = () => {
  const calls = [];
  return {
    calls,
    generateImage: async (prompt) => { calls.push(['generate', prompt]); return { value: { png: await syntheticPng(/teapot/.test(prompt) ? 'green-teapot' : 'red-mug') }, meta: { provider: 'stub' } }; },
    editImage: async (_img, prompt) => { calls.push(['edit', prompt]); return { value: { png: await syntheticPng(/teapot/.test(prompt) ? 'blue-teapot' : 'glass') }, meta: { provider: 'stub' } }; },
  };
};
