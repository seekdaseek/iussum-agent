// The three-state delivery rule. PURE: it reads the recorded answers of the checks and returns an outcome, so anyone holding an evidence record can recompute it.
//   DELIVERED_AS_OFFERED  - SAM found the object, the vision model says the image matches the offer, and (when a crop was judged) the crop agrees.
//   NOT_AS_OFFERED        - the vision model says it does NOT match with enough confidence, and SAM either found no such object or the crop judgement agrees it is wrong.
//   COULD_NOT_BE_CHECKED  - anything else: an API error, a low-confidence answer, or two checks that disagree. Never collapsed into either of the first two.
// Thresholds are data, recorded in the evidence next to the outcome. visionMinConfidence 0.9 was chosen on 2026-10-29 from a sweep over 28 hand-labelled images
// (eval/delivery-labels.json, results in eval/results/): from 0.7 to 0.9 the 22 clear cases do not change at all, and at 0.9 one of the six genuinely ambiguous
// images moves from a verdict to COULD_NOT_BE_CHECKED (four of six at 0.95), which is the safe direction for a refund. Small set, labels by one person: treat it as a sanity check, not a guarantee.
// segMinConfidence 0.5 applies to SAM 2.1's predicted IoU (path B); the grounding-only path C gives no segmentation confidence (null is accepted, never read as 0).
export const RULE_VERSION = 'delivery-rule/0.1';
export const THRESHOLDS = { segMinConfidence: 0.5, visionMinConfidence: 0.9 };
export const OUTCOMES = ['DELIVERED_AS_OFFERED', 'NOT_AS_OFFERED', 'COULD_NOT_BE_CHECKED'];

// seg:   { error } | { instances: [{ confidence|null, ... }] }
// full:  { error } | { answer: { matches_offer: 'yes'|'no'|'unsure', confidence: number, violates_must_not: boolean } }
// crop:  null (not run: nothing to crop) | { error } | { answer: same shape as full }
export function applyRule({ seg, full, crop }, th = THRESHOLDS) {
  const why = [];
  if (seg?.error) why.push(`segmentation failed${seg.error_hint ? `: ${seg.error_hint}` : ''} (${seg.error})`);
  if (full?.error) why.push(`vision check failed: ${full.error}`);
  if (crop?.error) why.push(`crop check failed: ${crop.error}`);
  if (why.length) return { outcome: 'COULD_NOT_BE_CHECKED', reasons: why, code: 'check_error' };

  const found = (seg.instances ?? []).filter((i) => i.confidence === null || i.confidence >= th.segMinConfidence);
  const best = found.slice().sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0))[0] ?? null;
  const verdictOf = (c) => {
    const a = c.answer;
    if (a.matches_offer === 'unsure' || !(a.confidence >= th.visionMinConfidence)) return 'unsure';
    if (a.violates_must_not === true) return 'no';
    return a.matches_offer;
  };
  const f = verdictOf(full);
  const c = crop?.answer ? verdictOf(crop) : null;
  const facts = { segFound: found.length, segBestConfidence: best?.confidence ?? null, full: f, crop: c };
  if (f === 'unsure') return { outcome: 'COULD_NOT_BE_CHECKED', reasons: ['the vision model was unsure or below the confidence threshold'], code: 'low_confidence', facts };
  if (f === 'yes' && best && (c === null || c === 'yes')) return { outcome: 'DELIVERED_AS_OFFERED', reasons: ['the object was found and the image matches the offer'], code: 'match', facts };
  if (f === 'no' && (!best || c === 'no')) return { outcome: 'NOT_AS_OFFERED', reasons: [best ? 'the vision model says the image does not match the offer and the crop of the segmented object agrees' : 'the vision model says the image does not match the offer and no such object was segmented'], code: best ? 'mismatch_crop' : 'mismatch_no_object', facts };
  return { outcome: 'COULD_NOT_BE_CHECKED', reasons: [`the checks disagree (segmentation found ${found.length}, full image ${f}, crop ${c ?? 'not judged'})`], code: 'models_disagree', facts };
}
