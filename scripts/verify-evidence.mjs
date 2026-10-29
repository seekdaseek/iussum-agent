// Recompute an evidence record from nothing but the record: node scripts/verify-evidence.mjs <evidence.json | https://.../runs/<id>/evidence-<n>.json> [--overlay overlay.png] [--delivered image.png]
// It fetches the shop's public signing key from the shop's own /.well-known/iussum.json (the shop is named by the signed receipt inside the record), then checks the
// evidence id (JCS + sha256), both shop signatures, the link between the receipt and the delivery attestation, the recorded segmentation output, and re-applies the
// three-state rule to the recorded model answers. It does NOT re-run any model and does not check the chain: that is the arbiter's job (src/dispute/arbiter.js).
// Exit code 0 only when the record verifies. With an https URL the .well-known key is trusted over TLS; pass --shop-key <base58> to pin it yourself.
import fs from 'node:fs';
import { verifyEvidence } from '../src/evidence/record.js';

const arg = (k) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : null);
const src = process.argv[2];
if (!src || src.startsWith('--')) { console.error('usage: node scripts/verify-evidence.mjs <evidence.json | url> [--shop-key B58] [--overlay file] [--delivered file]'); process.exit(2); }
const text = /^https?:\/\//.test(src) ? await (await fetch(src)).text() : fs.readFileSync(src, 'utf8');
const ev = JSON.parse(text);
const resource = ev.record?.payment?.receipt?.resource ?? '';
const base = /^(https?:\/\/[^/]+\/(?:[^/]+\/)*?)v1\//.exec(resource)?.[1];
let shopKey = arg('--shop-key');
if (!shopKey) {
  if (!base) { console.error(`cannot derive the shop from the receipt resource "${resource}"; pass --shop-key`); process.exit(2); }
  const r = await fetch(`${base}.well-known/iussum.json`);
  if (!r.ok) { console.error(`${base}.well-known/iussum.json answered HTTP ${r.status}`); process.exit(2); }
  const wk = await r.json();
  if (wk.pay_to !== ev.record.payment.receipt.pay_to) { console.error('the shop\'s .well-known pay_to differs from the receipt pay_to: refusing'); process.exit(1); }
  shopKey = wk.seller;
}
const read = (f) => (f ? fs.readFileSync(f) : null);
const r = await verifyEvidence(ev, { shopKey, overlayPng: read(arg('--overlay')), deliveredBytes: read(arg('--delivered')) });
console.log(`evidence_id   ${ev.evidence_id}`);
console.log(`shop key      ${shopKey}`);
console.log(`payment tx    ${ev.record.payment.tx_sig}`);
console.log(`offer         ${ev.record.offer.title} (${ev.record.offer.shop}/${ev.record.offer.sku})`);
console.log(`recorded      ${ev.record.outcome}   recomputed ${r.outcome}`);
console.log(`models        segment ${ev.record.checks.seg?.model?.provider}/${ev.record.checks.seg?.model?.model ?? '-'}  vision ${ev.record.checks.full?.model?.model ?? '-'}`);
console.log(r.ok ? 'VERIFIED: the record is internally consistent, signed by the shop, and its outcome follows from its recorded checks' : `NOT VERIFIED:\n  - ${r.problems.join('\n  - ')}`);
process.exit(r.ok ? 0 : 1);
