// The evidence record: everything a third party needs to recompute the outcome. JCS (RFC 8785, via @iussum/core) + sha256 gives the evidence id.
//   record = { v, payment, offer, spec, delivery, checks, rule, outcome, overlay }
// verifyEvidence() recomputes: the id, the hash of every attached file, the shop signatures, the link between the payment receipt and the delivery attestation,
// and the OUTCOME itself by re-applying the rule to the recorded answers. A record whose outcome does not follow from its own checks is invalid.
import { createHash } from 'node:crypto';
import { canonicalize, sha256Hex, verifyReceipt } from '@iussum/core';
import { verifyDelivery } from '../shops/attest.js';
import { applyRule, RULE_VERSION } from './rule.js';
import { readSamResult } from '../../models/adapters/meta.js';

export const EVIDENCE_VERSION = 'iussum-agent/evidence-0.1';
const sha = (b) => createHash('sha256').update(b).digest('hex');
const jcsSha = (x) => sha256Hex(canonicalize(x));

// payment: the signed receipt; delivery: { bytes, content_type, attestation }; run: the object runDeliveryCheck returned.
export function buildEvidence({ receipt, mandate_id, grant_tx, offer, spec, delivery, run, now }) {
  const record = {
    v: EVIDENCE_VERSION,
    created_at: now,
    payment: { tx_sig: receipt.tx_sig, receipt_sha256: jcsSha(receipt), receipt, mandate_id, grant_tx },
    offer, spec,
    delivery: { content_sha256: sha(delivery.bytes), content_type: delivery.content_type ?? 'image/png', bytes: delivery.bytes.length, attestation: delivery.attestation },
    checks: run.checks,
    rule: run.rule,
    outcome: run.rule.outcome,
    overlay: { sha256: sha(run.overlay_png), content_type: 'image/png' },
  };
  return { record, evidence_id: jcsSha(record) };
}

// opts: { shopKey (pinned, base58), overlayPng?, deliveredBytes?, allowFixture }  ->  { ok, problems[], outcome (recomputed) }
export async function verifyEvidence({ record, evidence_id }, { shopKey, overlayPng = null, deliveredBytes = null, allowFixture = false }) {
  const problems = [];
  const bad = (m) => problems.push(m);
  if (record?.v !== EVIDENCE_VERSION) return { ok: false, problems: [`unknown evidence version ${record?.v}`], outcome: null };
  if (jcsSha(record) !== evidence_id) bad('evidence_id does not match the record');
  const { payment, delivery, checks } = record;
  if (jcsSha(payment.receipt) !== payment.receipt_sha256) bad('receipt_sha256 does not match the receipt');
  const rv = verifyReceipt(payment.receipt, shopKey);
  if (!rv.ok) bad(`receipt: ${rv.why}`);
  if (payment.receipt.tx_sig !== payment.tx_sig) bad('receipt tx_sig differs from the record');
  if (payment.receipt.mandate_id !== payment.mandate_id || payment.receipt.grant_tx !== payment.grant_tx) bad('the receipt does not carry the mandate and grant named in the record');
  const dv = verifyDelivery(delivery.attestation, shopKey);
  if (!dv.ok) bad(`delivery attestation: ${dv.why}`);
  else {
    const a = delivery.attestation;
    if (a.content_sha256 !== delivery.content_sha256) bad('the attestation signs other bytes than the record names');
    if (a.resource !== payment.receipt.resource) bad('the attestation and the receipt name different resources');
    if (a.payer !== payment.receipt.payer) bad('the attestation and the receipt name different payers');
    if (a.offer_hash !== payment.receipt.offer_hash) bad('the attestation and the receipt name different offers');
    if (a.sku !== record.offer.sku) bad('the attestation sku differs from the offer sku');
    if (Math.abs(a.delivered_at - payment.receipt.settled_at) > 600) bad('delivery and settlement are more than 10 minutes apart');
  }
  if (deliveredBytes && sha(deliveredBytes) !== delivery.content_sha256) bad('the attached image is not the attested one');
  if (overlayPng && sha(overlayPng) !== record.overlay.sha256) bad('the attached overlay does not match overlay.sha256');
  for (const c of [checks.seg, checks.full, checks.crop]) if (c?.model?.provider === 'fixture' && !allowFixture) bad('a check was answered by the fixture adapter, which is not evidence about any model');
  if (checks.seg?.image_sha256 && checks.seg.image_sha256 !== delivery.content_sha256) bad('the segmentation ran on other bytes than the attested delivery');
  if (checks.full?.image_sha256 && checks.full.image_sha256 !== delivery.content_sha256) bad('the full-image judgement ran on other bytes than the attested delivery');
  // the recorded SAM instances must be what the recorded raw output parses to (Meta's own parser)
  if (checks.seg?.raw_output !== undefined && checks.seg.model?.provider === 'meta') {
    try {
      const re = await readSamResult(checks.seg.raw_output);
      const same = re.instances.length === checks.seg.instances.length && re.instances.every((i, k) => { const r = checks.seg.instances[k]; return i.id === r.id && JSON.stringify(i.box) === JSON.stringify(r.box) && i.confidence === r.confidence && i.areaPx === r.area_px; });
      if (!same) bad('the recorded segmentation instances differ from what the recorded raw output parses to');
    } catch (e) { bad(`the recorded raw segmentation output does not parse: ${e.message}`); }
  }
  // path B (Spark Open box + SAM 2.1 mask): the recorded instances must be the recorded boxes and scores, and "nothing found" must be what the grounding answer said
  if (checks.seg?.raw_output !== undefined && checks.seg.model?.provider === 'baseten+modal') {
    try {
      const raw = JSON.parse(checks.seg.raw_output), boxes = raw.sam?.boxes ?? [], scores = raw.sam?.scores ?? [], inst = checks.seg.instances;
      const same = inst.length === boxes.length && inst.every((i, k) => JSON.stringify([i.box.x1, i.box.y1, i.box.x2, i.box.y2]) === JSON.stringify(boxes[k]) && i.confidence === (scores[k] ?? null));
      if (!same) bad('the recorded segmentation instances differ from the boxes and scores in the recorded raw output');
      if (inst.length === 0 && raw.ground?.found === true && raw.ground?.boxes?.length > 0 && !(checks.seg.diagnostics ?? []).length) bad('the grounding answer found boxes but no instance was recorded and no diagnostic explains it');
    } catch (e) { bad(`the recorded raw segmentation output does not parse: ${e.message}`); }
  }
  if (record.rule.version !== RULE_VERSION) bad(`rule version ${record.rule.version} is not ${RULE_VERSION}`);
  const again = applyRule(checks, record.rule.thresholds);
  if (again.outcome !== record.outcome) bad(`the outcome ${record.outcome} does not follow from the recorded checks (they give ${again.outcome})`);
  return { ok: problems.length === 0, problems, outcome: again.outcome };
}
