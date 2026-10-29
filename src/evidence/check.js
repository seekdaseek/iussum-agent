// Run the delivery check on one delivered image: SAM 3.1 (text-prompted masks) + Muse Spark vision on the full image + vision on the crop of the best mask.
// Every model call goes through the provider layer. A failed call is recorded as that check's error and the rule turns it into COULD_NOT_BE_CHECKED; nothing here
// ever fills in a missing answer.
import { createHash } from 'node:crypto';
import Ajv from 'ajv';
import { VISION_SCHEMA, VISION_SYSTEM, visionQuestion } from './prompts.js';
import { applyRule, RULE_VERSION, THRESHOLDS } from './rule.js';
import { makeOverlay, cropBox } from './overlay.js';

const sha = (b) => createHash('sha256').update(b).digest('hex');
const ajv = new Ajv({ allErrors: true, strict: false });
const checkVision = ajv.compile(VISION_SCHEMA);
const errText = (e) => `${e.kind ?? e.name}: ${String(e.message).slice(0, 300)}`;
const modelOf = (meta) => ({ provider: meta.provider, model: meta.model, latency_ms: meta.latencyMs ?? null, cost_usd: meta.costUsd ?? null, fixture_provenance: meta.fixtureProvenance ?? null });

async function judge(provider, image, offer, spec, crop) {
  try {
    const r = await provider.vision(image, visionQuestion({ ...offer, noun_phrase: spec.noun_phrase, must_not: spec.must_not ?? [], crop }), { schema: VISION_SCHEMA, schemaName: 'delivery_check', system: VISION_SYSTEM, mime: 'image/png' });
    if (!checkVision(r.value)) return { error: `answer does not match the schema: ${ajv.errorsText(checkVision.errors)}`, model: modelOf(r.meta), raw_answer: r.value };
    return { answer: r.value, model: modelOf(r.meta), image_sha256: sha(image) };
  } catch (e) { return { error: errText(e) }; }
}

// offer: { shop, sku, title, description }; spec: { noun_phrase, must_not }
export async function runDeliveryCheck({ provider, image, offer, spec, thresholds = THRESHOLDS }) {
  const t0 = Date.now();
  let seg, best = null, frame = null;
  try {
    const r = await provider.segment(image, spec.noun_phrase, { mime: 'image/png' });
    frame = r.value.frame;
    const inst = r.value.instances.map((i) => ({ id: i.id, box: i.box, confidence: i.confidence, area_px: i.areaPx ?? null, mask: i.mask ?? null }));
    seg = { instances: inst.map(({ mask: _m, ...rest }) => rest), raw_output: r.value.rawOutput, frame, phrase: spec.noun_phrase, image_sha256: sha(image), model: modelOf(r.meta), diagnostics: r.value.diagnostics };
    best = inst.filter((i) => i.confidence === null || i.confidence >= thresholds.segMinConfidence).sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0))[0] ?? null;
  } catch (e) { seg = { error: errText(e), phrase: spec.noun_phrase, image_sha256: sha(image) }; }

  const full = await judge(provider, image, offer, spec, false);
  let crop = null, cropImage = null;
  if (best) {
    try { cropImage = await cropBox(image, { instance: best, frame }); crop = await judge(provider, cropImage, offer, spec, true); crop.crop_of = { instance_id: best.id, crop_sha256: sha(cropImage) }; }
    catch (e) { crop = { error: errText(e) }; }
  }
  const rule = applyRule({ seg, full, crop }, thresholds);
  // ILLUSTRATIVE, not part of the rule: when the delivery is not what was offered and nothing matched the offered phrase, look for what the vision model says IS there
  // ("clear glass tumbler") so the overlay can show it. A failure here changes nothing; the rule above has already decided.
  let observed = null, shown = best, shownFrame = frame, shownIs = best ? 'offered' : null;
  const obs = full?.answer?.observed_object;
  if (rule.outcome === 'NOT_AS_OFFERED' && !best && typeof obs === 'string' && obs.trim() && obs.length <= 80) {
    try {
      const r = await provider.segment(image, obs.trim().toLowerCase(), { mime: 'image/png' });
      const inst = r.value.instances.map((i) => ({ id: i.id, box: i.box, confidence: i.confidence, area_px: i.areaPx ?? null, mask: i.mask ?? null }));
      observed = { illustrative: true, phrase: obs.trim().toLowerCase(), instances: inst.map(({ mask: _m, ...rest }) => rest), raw_output: r.value.rawOutput, frame: r.value.frame, model: modelOf(r.meta) };
      const top = inst.slice().sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0))[0] ?? null;
      if (top) { shown = top; shownFrame = r.value.frame; shownIs = 'observed'; }
    } catch (e) { observed = { illustrative: true, phrase: obs.trim().toLowerCase(), error: errText(e) }; }
  }
  const overlay = await makeOverlay(image, { instance: rule.outcome === 'COULD_NOT_BE_CHECKED' && !shown ? null : shown, frame: shownFrame });
  return { checks: { seg, full, crop, ...(observed ? { observed } : {}) }, overlay_shows: shownIs, rule: { version: RULE_VERSION, thresholds, ...rule }, overlay_png: overlay.png, crop_png: cropImage, took_ms: Date.now() - t0 };
}
