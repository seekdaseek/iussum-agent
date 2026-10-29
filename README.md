# iussum-agent

Tell your AI agent out loud what it may spend; it buys within those limits, and when a seller delivers the wrong thing it builds the evidence itself and gets the money back by rule.

Entry for the Meta Global AI Developer Hackathon (Indie Developer track). Everything outside `prior/` was written after the event opened on 2026-10-26 17:00 UTC; the git history shows it. Solana devnet only, test money only.

## Built on Meta's open weights

Every model call in this entry goes to **Muse Spark Open** (`meta-models/muse-spark-open-1026`, Meta's open-weights model) served through Baseten's partner inference: the request-to-limits compiler, the shopping agent's tool loop, the voice transcription, the delivery check's vision judgement and the grounding of the offered item in the delivered photo. Segmentation is meant to run on Meta's open SAM weights (SAM 2.1, Apache-2.0, on Modal, from a Muse-Spark-Open box). That last part is **not deployed yet**; until it is, the delivery check runs on vision grounding alone (a box, no mask) and says so in its own evidence records. SAM 3.1 is a swap-in if access to its gated weights is granted.

Muse Image was planned for the shop catalogues (and for the dishonest shop's swapped deliveries as image edits). It is not used: the Meta Model API is not available to this entry. The catalogues are real photographs under open licences (CC0 and CC BY, Wikimedia Commons), credited on each shop page and in `assets/photos/SOURCES.md`.

## Status (2026-10-29)

Working end to end on Solana devnet with real model calls: a request is compiled by Muse Spark Open, the confirmed mandate is granted on chain, Muse Spark Open's tool loop buys photos from the demo shops, each delivery is checked, a wrong delivery produces an evidence record and a dispute, and the arbiter refunds on chain. The latest real runs: 3 photos bought from the dishonest shop, 3 caught, 3 refunded, net loss 0 USDC, about $0.01 of model spend per run; one photo bought from the honest shop and passed.

Measured, not claimed: the compile eval (30 requests plus 22 held-out) and a 28-image labelled calibration of the delivery rule. Numbers and failures are in the day reports, not here, because they will keep changing until submission. The thresholds were chosen from a small set labelled by one person.

Not done yet: SAM 2.1 on Modal (masks), the live deployment, the video.

## The pipeline

1. **Say it.** Text, or a recording sent to Muse Spark Open as an audio input (`models/`, `web/`). On about 1 call in 10 the model answers that it received no audio; that answer is detected and retried, never shown as a transcript.
2. **Compile it.** Muse Spark Open (JSON mode, schema in the prompt) turns the words into limits. Code decides: the answer is validated against a closed schema, missing or ambiguous things become one fixed question, unbounded, contradictory or out-of-policy requests are rejected, and a plain-words read-back is built from the validated fields (`src/intent/`). Nothing is granted before the person confirms.
3. **Grant and buy.** The confirmed mandate is granted on devnet through the earlier iussum (one transaction: SPL `ApproveChecked` plus a memo). A Muse Spark Open tool-loop agent (native tool calling) compares the demo shops' offers and pays; code limits the number of purchases and the earlier iussum agent refuses anything outside the mandate (`src/agent/`, `src/shops/`).
4. **Check the delivery.** The offered noun phrase is grounded in the delivered image (Muse Spark Open gives a box; SAM 2.1 turns it into a mask once deployed); Muse Spark Open's vision judges the image and a crop of the box against the offer. The outcome is `DELIVERED_AS_OFFERED`, `NOT_AS_OFFERED` or `COULD_NOT_BE_CHECKED`; an error, a low-confidence answer or two checks that disagree is the third state, never one of the first two (`src/evidence/rule.js`). The shop signs what it delivered, so the evidence rests on the shop's own signature, not the buyer's word (`src/shops/attest.js`).
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

With a Baseten key (`BASETEN_API_KEY` in `.env`): `node scripts/build-real-catalog.mjs`, then `MODEL_PROVIDER=baseten MODEL_PROVIDER_SEGMENT=ground node --env-file=.env scripts/serve.mjs` and `node scripts/run-demo.mjs` (`--control` for the run with the delivery check off). Provider notes: `models/PROVIDERS.md`.

## Limits worth knowing

- The refund is paid from a float wallet that stands in for the seller's own refund key, as in the earlier demo. It is a devnet simplification.
- The delivery attestation binds to the payment by resource, payer and offer hash, not by transaction id (x402 settles after the shop answers). Two payments by one payer for one resource are told apart only by the receipt in the evidence record.
- One run at a time: each grant replaces the previous one on the shared devnet wallet.
- The delivery rule's thresholds come from a 28-image set labelled by one person: a sanity check, not a guarantee. The refund decision never rests on a single model answer: an error, low confidence or disagreement is COULD_NOT_BE_CHECKED and nobody is refunded or accused on it.
- The grounding-only check (no SAM yet) shows a box, not a mask, and its records say `baseten-ground`.
