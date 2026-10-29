// One purchase run, end to end, after the person has confirmed the read-back:
//   grant (devnet) -> shopping agent (Muse Spark tool loop, or the scripted test double) -> for each paid photo: delivery check (SAM 3.1 + Muse Spark vision)
//   -> evidence record -> dispute to the arbiter when NOT_AS_OFFERED -> verdict and refund.
// checkDelivery:false is the CONTROL: the same agent pays, nobody looks at what arrived.
import fs from 'node:fs';
import path from 'node:path';
import { createAgent } from '@iussum/agent';
import { mandateId } from '@iussum/core';
import { buyPhoto, shopKey } from '../agent/purchase.js';
import { runShopper, shopperSystemPrompt } from '../agent/shopper.js';
import { runDeliveryCheck } from '../evidence/check.js';
import { buildEvidence } from '../evidence/record.js';
import { DEVNET, fmtUsdc, explorerTx } from '../chain/chain.js';

export const newRunId = () => `${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)}-${Math.random().toString(36).slice(2, 7).padEnd(5, "0")}`;

// cfg: { chain, keys:{principal,agent}, shops (registry with origin/base/pay_to), provider (models), shopperProvider (defaults to provider), arbiter, outDir, now, fetch }
export function createPipeline(cfg) {
  const { chain, keys, shops, provider, arbiter, outDir, now = () => Math.floor(Date.now() / 1000), fetchImpl = globalThis.fetch } = cfg;
  const shopperProvider = cfg.shopperProvider ?? provider;
  const byId = new Map(shops.map((s) => [s.id, s]));
  const pins = new Map();
  const pinned = async (shop) => { if (!pins.has(shop.id)) pins.set(shop.id, await shopKey(shop, fetchImpl)); return pins.get(shop.id); };

  // compiled: the object compileRequest/decideIntent returned with status 'mandate'. onEvent(e) gets progress for the page.
  async function run({ compiled, checkDelivery = true, runId = newRunId(), onEvent = () => {}, maxSteps = 12 }) {
    if (compiled?.status !== 'mandate') throw new Error('run needs a compiled mandate');
    const dir = path.join(outDir, runId);
    fs.mkdirSync(dir, { recursive: true });
    const emit = (e) => { try { onEvent({ run_id: runId, at: now(), ...e }); } catch { /* a listener must not break the run */ } };
    const { mandate, item, limits } = compiled;
    const report = { run_id: runId, check_delivery: checkDelivery, started_at: now(), mandate_id: mandateId(mandate), limits, item, readback: compiled.readback, purchases: [], summary: null, error: null };
    const save = () => fs.writeFileSync(path.join(dir, 'run.json'), JSON.stringify(report, null, 1));
    const principalBefore = await chain.usdc(keys.principal.address);
    // The segmentation endpoint scales to zero and needs 30 to 60 s to start. Wake it now, while the grant and the shopping take their time, and tell the page.
    if (checkDelivery && provider.warmSegmenter) {
      emit({ type: 'stage', id: 'warm', state: 'start', label: 'Starting the segmentation model (about 30 to 60 s if it has been idle)' });
      provider.warmSegmenter().then((w) => { if (w) emit({ type: 'stage', id: 'warm', state: 'done', ok: w.ok, ms: w.ms, ...(w.skipped ? { skipped: w.skipped } : {}), ...(w.ok ? {} : { reason: w.hint ?? w.error }) }); else emit({ type: 'stage', id: 'warm', state: 'done', ok: true, ms: 0 }); });
    }
    emit({ type: 'grant_start' });
    const grant_tx = await chain.sendGrant(keys.principal, mandate);
    report.grant_tx = grant_tx; report.grant_url = explorerTx(grant_tx);
    emit({ type: 'grant_done', grant_tx, url: report.grant_url });
    save();

    const agent = await createAgent({ mandate, grant_tx, signer: keys.agent, rpc: chain.rpc, dataDir: path.join(dir, 'agent') });
    let shopping;
    try {
      shopping = await runShopper({
        provider: shopperProvider, shops,
        getCatalog: async (s) => { const r = await fetchImpl(`${s.origin}${s.base}/v1/catalog`); if (!r.ok) throw new Error(`${s.id} catalogue answered HTTP ${r.status}`); return r.json(); },
        buy: async (s, sku) => buyPhoto({ agent, shop: s, sku, pinnedKey: await pinned(s) }),
        system: shopperSystemPrompt({ readback: compiled.readback, item }), count: item.count, maxSteps, onEvent: emit,
      });
    } finally { await agent.close(); }
    report.shopping = { ended: shopping.ended, steps: shopping.steps, error: shopping.error, transcript: shopping.transcript };
    emit({ type: 'shopping_done', ended: shopping.ended, purchases: shopping.purchases.length });

    let n = 0;
    for (const p of shopping.purchases) {
      n++;
      const r = p.result, shop = byId.get(p.shop);
      const entry = { n, shop: p.shop, shop_name: shop.name, sku: p.sku, tx_sig: r.receipt?.tx_sig ?? null, payment_url: r.receipt ? explorerTx(r.receipt.tx_sig) : null, amount: r.receipt?.amount ?? null, shop_signatures_verified: r.ok, checks: r.checks, outcome: null, verdict: null };
      report.purchases.push(entry);
      fs.writeFileSync(path.join(dir, `img-${n}.png`), r.bytes);
      entry.image = `img-${n}.png`;
      emit({ type: 'delivery_received', n, shop: p.shop, sku: p.sku });
      if (!checkDelivery) { entry.outcome = 'NOT_CHECKED'; save(); continue; }
      if (!r.ok) { entry.outcome = 'COULD_NOT_BE_CHECKED'; entry.outcome_reason = 'the shop signatures on the receipt or the delivery did not verify, so there is no evidence to file'; save(); continue; }
      const cat = await (await fetchImpl(`${shop.origin}${shop.base}/v1/catalog`)).json();
      const it = cat.items.find((i) => i.sku === p.sku);
      const offer = { shop: p.shop, sku: p.sku, title: it?.title ?? p.sku, description: it?.description ?? '' };
      emit({ type: 'check_start', n });
      const stageLabel = { segmenting: `Photo ${n}: locating the offered item and cutting it out`, judging: `Photo ${n}: judging the photo against the offer` };
      let stageOpen = null;
      const onStage = (st) => { if (stageOpen) emit({ type: 'stage', id: stageOpen, state: 'done' }); stageOpen = `check-${n}-${st}`; emit({ type: 'stage', id: stageOpen, state: 'start', label: stageLabel[st] }); };
      const run1 = await runDeliveryCheck({ provider, image: r.bytes, offer, spec: { noun_phrase: item.noun_phrase, must_not: item.must_not }, onStage });
      if (stageOpen) emit({ type: 'stage', id: stageOpen, state: 'done' });
      fs.writeFileSync(path.join(dir, `overlay-${n}.png`), run1.overlay_png); entry.overlay = `overlay-${n}.png`; entry.overlay_shows = run1.overlay_shows ?? null; entry.observed_phrase = run1.checks.observed?.phrase ?? null;
      const ev = buildEvidence({ receipt: r.receipt, mandate_id: r.receipt.mandate_id, grant_tx, offer, spec: { noun_phrase: item.noun_phrase, must_not: item.must_not }, delivery: { bytes: r.bytes, attestation: r.attestation }, run: run1, now: now() });
      fs.writeFileSync(path.join(dir, `evidence-${n}.json`), JSON.stringify(ev, null, 1)); entry.evidence = `evidence-${n}.json`; entry.evidence_id = ev.evidence_id;
      entry.outcome = run1.rule.outcome; entry.outcome_code = run1.rule.code; entry.outcome_reasons = run1.rule.reasons;
      entry.model_cost_usd = [run1.checks.seg?.model, run1.checks.full?.model, run1.checks.crop?.model].reduce((a, m) => a + (m?.cost_usd ?? 0), 0);
      emit({ type: 'check_done', n, outcome: entry.outcome, ...(entry.outcome === 'COULD_NOT_BE_CHECKED' ? { reasons: entry.outcome_reasons } : {}) });
      if (entry.outcome === 'NOT_AS_OFFERED') {
        emit({ type: 'dispute_start', n });
        const v = await arbiter.dispute({ evidence: ev, overlay_png_b64: run1.overlay_png.toString('base64'), delivered_b64: r.bytes.toString('base64'), mandate });
        entry.verdict = { verdict: v.verdict, reason: v.reason, liable: v.liable, problems: v.problems ?? null, refund_tx: v.refund_tx ?? null, refund_url: v.refund_tx ? explorerTx(v.refund_tx) : null, refund_error: v.refund_error ?? null, refund_state: v.refund_state ?? null };
        emit({ type: 'verdict', n, ...entry.verdict });
      }
      save();
    }

    const principalAfter = await chain.usdc(keys.principal.address);
    const paid = report.purchases.reduce((a, p) => a + BigInt(p.amount ?? 0), 0n);
    const refunded = report.purchases.filter((p) => p.verdict?.refund_tx).reduce((a, p) => a + BigInt(p.amount ?? 0), 0n);
    const count = (o) => report.purchases.filter((p) => p.outcome === o).length;
    report.summary = {
      purchased: report.purchases.length, delivered_as_offered: count('DELIVERED_AS_OFFERED'), not_as_offered: count('NOT_AS_OFFERED'), could_not_be_checked: count('COULD_NOT_BE_CHECKED'), not_checked: count('NOT_CHECKED'),
      refunds_paid: report.purchases.filter((p) => p.verdict?.refund_tx).length, paid_usdc: fmtUsdc(paid), refunded_usdc: fmtUsdc(refunded), net_loss_usdc: fmtUsdc(paid - refunded),
      principal_usdc_before: fmtUsdc(principalBefore), principal_usdc_after: fmtUsdc(principalAfter), model_cost_usd: Number(report.purchases.reduce((a, p) => a + (p.model_cost_usd ?? 0), 0).toFixed(6)),
    };
    report.finished_at = now();
    save();
    emit({ type: 'run_done', summary: report.summary });
    return report;
  }
  return { run, pinned };
}
