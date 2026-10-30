# iussum-agent

Tell your AI agent out loud what it may spend; it buys within those limits, and when a seller delivers the wrong thing it builds the evidence itself and gets the money back by rule.

**Demo video (2:53): https://www.youtube.com/watch?v=9CExAnb9XKE**. **Post on X: https://x.com/ochinimus/status/2115768140793589838**. Live page: https://meta.ochinimus.app. Shot list of the video and the source of every number in it: `docs/VIDEO.md`.

Entry for the Meta Global AI Developer Hackathon (Indie Developer track). Everything outside `prior/` was written after the event opened on 2026-10-26 17:00 UTC; the git history shows it. Solana devnet only, test money only.

## Built on Meta's open weights

Every model in this entry is a Meta open-weights model. The exact models:

| Job | Model | Served by |
|---|---|---|
| request-to-limits compiler, shopping agent (tool calling), voice transcription, delivery vision judgement, grounding of the offered item to a box | **Muse Spark Open**, `meta-models/muse-spark-open-1026` | Baseten partner inference |
| mask of the grounded object | **SAM 2.1**, `facebook/sam2.1-hiera-large` (Apache-2.0) | our endpoint on Modal (CPU), `modal/sam2_app.py` |

Muse Spark Open gives a box for the offered noun phrase; SAM 2.1 turns the box into a mask. **SAM 3** (`facebook/sam3`, text prompt in, masks out, `modal/sam3_app.py`) was built and run on the same labelled images as an alternative: identical on the 22 clear cases, slightly less cautious on the 6 ambiguous ones, about twice the latency and three times the Modal cost on CPU, so SAM 2.1 ships. SAM 3.1 (`facebook/sam3.1`) is not used: access was never granted. Segmentation is a real mask only on the SAM 2.1 path; the box-only fallback is labelled `baseten-ground` in the evidence.

Muse Image was planned for the shop catalogues (and for the dishonest shop's swapped deliveries as image edits). It is not used: the Meta Model API is not available to this entry. The catalogues are real photographs under open licences (CC0 and CC BY, Wikimedia Commons), credited on each shop page and in `assets/photos/SOURCES.md`.

## Status (2026-10-30)

Working end to end on Solana devnet with real model calls: a request is compiled by Muse Spark Open, the confirmed mandate is granted on chain, Muse Spark Open's tool loop buys photos from the demo shops, each delivery is checked, a wrong delivery produces an evidence record and a dispute, and the arbiter refunds on chain. The latest real runs: 3 photos bought from the dishonest shop, 3 caught, 3 refunded, net loss 0 USDC, about $0.01 of model spend per run; one photo bought from the honest shop and passed.

Measured, not claimed: the compile eval (30 requests plus 22 held-out) and a 28-image labelled calibration of the delivery rule. The running tally of real runs is on the live page ("Track record") and in `docs/track-record.json`; how it is counted is in `CHECKLIST.md`, section 7. The compile eval numbers and failures are in `CHECKLIST.md`, item 4. The thresholds were chosen from a small set labelled by one person.

Live at https://meta.ochinimus.app (devnet, one run at a time, rate limited): a systemd service with a 250 MB kernel memory cap and no swap, behind its own Cloudflare tunnel (`ops/`). The demo video is here: https://www.youtube.com/watch?v=9CExAnb9XKE (the post on X: https://x.com/ochinimus/status/2115768140793589838). SAM 2.1 runs on Modal CPU (Modal requires a payment method for GPU functions): about 9 s per image warm, about 30 s on the first request after idle.

## The pipeline

1. **Say it.** Text, or a recording sent to Muse Spark Open as an audio input (`models/`, `web/`). On about 1 call in 10 the model answers that it received no audio; that answer is detected and retried, never shown as a transcript.
2. **Compile it.** Muse Spark Open (JSON mode, schema in the prompt) turns the words into limits. Code decides: the answer is validated against a closed schema, missing or ambiguous things become one fixed question, unbounded, contradictory or out-of-policy requests are rejected, and a plain-words read-back is built from the validated fields (`src/intent/`). Nothing is granted before the person confirms.
3. **Grant and buy.** The confirmed mandate is granted on devnet through the earlier iussum (one transaction: SPL `ApproveChecked` plus a memo). A Muse Spark Open tool-loop agent (native tool calling) compares the demo shops' offers and pays; code limits the number of purchases and the earlier iussum agent refuses anything outside the mandate (`src/agent/`, `src/shops/`).
4. **Check the delivery.** The offered noun phrase is grounded in the delivered image (Muse Spark Open gives a box; SAM 2.1 turns it into a mask); Muse Spark Open's vision judges the image and a crop of the box against the offer. The outcome is `DELIVERED_AS_OFFERED`, `NOT_AS_OFFERED` or `COULD_NOT_BE_CHECKED`; an error, a low-confidence answer or two checks that disagree is the third state, never one of the first two (`src/evidence/rule.js`). The shop signs what it delivered, so the evidence rests on the shop's own signature, not the buyer's word (`src/shops/attest.js`).
5. **Dispute and refund.** The evidence record (JCS + sha256, recomputable by anyone from the record alone) goes to the arbiter. It verifies the shop signatures, re-applies the rule to the recorded answers, proves the payment on chain and refunds once (`src/dispute/`). A verdict page shows the mask next to the offer text.
6. **A live page** to try it (`web/`, `src/web/`): one run at a time, per-IP rate limits, daily spend limits for model credit and devnet USDC.

## Built during the hackathon vs prior work

| Part | Where |
|---|---|
| Model provider layer: Baseten, Meta, Modal and grounding adapters per job, token cost ledger with a spend stop, recorded-fixture adapter (tests only) | `models/` |
| Request-to-limits compiler, schema, policy, read-back | `src/intent/` |
| 30 eval requests with expected outcomes | `eval/` |
| Demo shops (x402 on devnet), signed delivery attestation, open-licence photo catalogue (a Muse Image builder exists and is unused) | `src/shops/`, `assets/photos/` |
| Shopping agent loop and purchase check | `src/agent/` |
| Three-state delivery rule, mask overlay, evidence record and its verification | `src/evidence/` |
| Delivery arbiter (rule R5), refund-once store | `src/dispute/` |
| Run pipeline, live page and API, guards | `src/run/`, `src/web/`, `web/` |
| Tests (`npm test`), eval sets and calibration (`eval/`), devnet scripts | `test/`, `eval/`, `scripts/` |

| Prior work, used as a library | Where |
|---|---|
| iussum: mandate, grant check, x402 seller gate, agent payer, receipts, resolver and its refund sender on Solana (MIT, built 2026-10-19 to 2026-10-22) | `prior/iussum`, git submodule pinned at `e476c89`; no file from it is copied into this repo |

The earlier iussum's resolver rules on whether a payment was inside the mandate. A payment inside the mandate that bought the wrong thing is, under its rules, the principal's loss. The delivery arbiter here is a new rule (R5) for exactly that gap; it reuses the earlier receipts, chain parsing and refund sender.

## Run it

```
git clone --recurse-submodules https://github.com/seekdaseek/iussum-agent && cd iussum-agent
npm install
npm test                                   # offline: no key, no network
```

Devnet integration with a stub in place of the models (needs funded devnet keys in `.secrets/`, see `scripts/`):

```
node scripts/devnet-pipeline.mjs           # 3 purchases, 3 caught, 3 refunds; --no-check runs the control
DEV_STUBS=1 node scripts/serve.mjs         # the live page with a red "no model is called" banner
```

With a Baseten key (`BASETEN_API_KEY` in `.env`): `node scripts/build-real-catalog.mjs`, then `MODEL_PROVIDER=baseten MODEL_PROVIDER_SEGMENT=groundsam node --env-file=.env scripts/serve.mjs` and `node scripts/run-demo.mjs` (`--control` for the run with the delivery check off). Provider notes: `models/PROVIDERS.md`.

## Evaluation: segmentation, SAM 3 against SAM 2.1

Both were run on the same 28 hand-labelled images (`eval/delivery-labels.json`: 4 as offered, 18 not as offered, 6 unclear; the offer is "Red ceramic mug"), with the same Muse Spark Open vision judgement, the same rule and thresholds, on Modal CPU (4 cores; Modal asks for a payment method before it runs any GPU function). Labels were written before any model saw the images. Raw answers per image are in `eval/results/`.

| | **SAM 2.1** (shipped): Muse Spark Open box, then `facebook/sam2.1-hiera-large` | SAM 3: `facebook/sam3`, noun phrase in |
|---|---|---|
| as offered (4) → delivered / not as offered / could not be checked | **4** / 0 / 0 | **4** / 0 / 0 |
| not as offered (18) → delivered / not as offered / could not be checked | 0 / **18** / 0 | 0 / **18** / 0 |
| unclear (6) → delivered / not as offered / could not be checked | 2 / 1 / 3 | 3 / 1 / 2 |
| false pass, false accusation, errors | 0, 0, 0 | 0, 0, 0 |
| latency of one segmentation call, warm / cold | about 9 s / 28 s | about 25 s / 65 s |
| time per image through the whole check, 4 in parallel | about 30 s | about 60 s |
| Modal cost of the 28-image run | about $0.05 | about $0.16 |
| needs gated weights | no (Apache-2.0) | yes (access granted to the owner of this entry) |

Reading: the two tie on the 22 clear images. On the six ambiguous ones SAM 3 passes one more (a mug mostly hidden behind a person) where SAM 2.1 stays at "could not be checked", which is the safer answer; that is one image, not a finding. SAM 2.1 is half the latency and a third of the cost on CPU and needs no gated weights, so it stays the shipped path. 28 images and one labeller make this a sanity check, not a benchmark. SAM 3.1 was never evaluated: access was never granted.

## Limits worth knowing

- The refund is paid from a float wallet that stands in for the seller's own refund key, as in the earlier demo. It is a devnet simplification.
- The delivery attestation binds to the payment by resource, payer and offer hash, not by transaction id (x402 settles after the shop answers). Two payments by one payer for one resource are told apart only by the receipt in the evidence record.
- One run at a time: each grant replaces the previous one on the shared devnet wallet.
- The delivery rule's thresholds come from a 28-image set labelled by one person: a sanity check, not a guarantee. The refund decision never rests on a single model answer: an error, low confidence or disagreement is COULD_NOT_BE_CHECKED and nobody is refunded or accused on it.
- A wrong delivery has nothing matching the offer to mask; the overlay then shows the mask of what the vision model says is there (for example a clear glass tumbler), recorded as illustrative and never used by the rule.
