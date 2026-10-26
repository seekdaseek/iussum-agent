# iussum-agent

Tell your AI agent out loud what it may spend; it buys within those limits, and when a seller delivers the wrong thing it builds the evidence itself and gets the money back by rule.

Entry for the Meta Global AI Developer Hackathon (Indie Developer track). Everything outside `prior/` was written after the event opened on 2026-10-26 17:00 UTC; the git history shows it. Solana devnet only, test money only.

## Status (2026-10-26, end of day 2)

Built and tested without any Meta model: the provider layer, the request-to-limits compiler with its validation, the demo shops, the shopping loop, the delivery rule, the evidence record, the arbiter and refund, the live page with its rate limits and spend guard. The purchase, evidence, dispute and refund path has run on Solana devnet with a stub in place of the models (see `scripts/devnet-pipeline.mjs`).

**No Meta model has been called yet** (no API key). Every request to Meta's API in `models/adapters/meta.js` is written from the docs and is UNTESTED against the service. The 30-request compile score does not exist yet; `eval/run.js` refuses to print one for anything but a real provider. Nothing here says how well the models do the job.

## The pipeline

1. **Say it.** Text, or a recording sent to Muse Voice Transcribe (`models/`, `web/`).
2. **Compile it.** Muse Spark 1.3 with structured output turns the words into limits. Code decides: the answer is validated against a closed schema, missing or ambiguous things become one fixed question, unbounded, contradictory or out-of-policy requests are rejected, and a plain-words read-back is built from the validated fields (`src/intent/`). Nothing is granted before the person confirms.
3. **Grant and buy.** The confirmed mandate is granted on devnet through the earlier iussum (one transaction: SPL `ApproveChecked` plus a memo). A Muse Spark tool-loop agent compares the demo shops' offers and pays; code limits the number of purchases and the earlier iussum agent refuses anything outside the mandate (`src/agent/`, `src/shops/`).
4. **Check the delivery.** SAM 3.1 segments the noun phrase in the delivered image; Muse Spark vision judges the image and a crop of the mask against the offer. The outcome is `DELIVERED_AS_OFFERED`, `NOT_AS_OFFERED` or `COULD_NOT_BE_CHECKED`; an error, a low-confidence answer or two checks that disagree is the third state, never one of the first two (`src/evidence/rule.js`). The shop signs what it delivered, so the evidence rests on the shop's own signature, not the buyer's word (`src/shops/attest.js`).
5. **Dispute and refund.** The evidence record (JCS + sha256, recomputable by anyone from the record alone) goes to the arbiter. It verifies the shop signatures, re-applies the rule to the recorded answers, proves the payment on chain and refunds once (`src/dispute/`). A verdict page shows the mask next to the offer text.
6. **A live page** to try it (`web/`, `src/web/`): one run at a time, per-IP rate limits, daily spend limits for model credit and devnet USDC.

## Built during the hackathon vs prior work

| Part | Where |
|---|---|
| Model provider layer: Meta, Baseten and Modal adapters per job, cost ledger, spend stop, recorded-fixture adapter (tests only) | `models/` |
| Request-to-limits compiler, schema, policy, read-back | `src/intent/` |
| 30 eval requests with expected outcomes | `eval/` |
| Demo shops (x402 on devnet), signed delivery attestation, Muse Image catalogue builder | `src/shops/` |
| Shopping agent loop and purchase check | `src/agent/` |
| Three-state delivery rule, mask overlay, evidence record and its verification | `src/evidence/` |
| Delivery arbiter (rule R5), refund-once store | `src/dispute/` |
| Run pipeline, live page and API, guards | `src/run/`, `src/web/`, `web/` |
| Tests (`npm test`) and devnet scripts | `test/`, `scripts/` |

| Prior work, used as a library | Where |
|---|---|
| iussum: mandate, grant check, x402 seller gate, agent payer, receipts, resolver and its refund sender on Solana (MIT, built 2026-10-19 to 2026-10-22) | `prior/iussum`, git submodule pinned at `e476c89`; no file from it is copied into this repo |

The earlier iussum's resolver rules on whether a payment was inside the mandate. A payment inside the mandate that bought the wrong thing is, under its rules, the principal's loss. The delivery arbiter here is a new rule (R5) for exactly that gap; it reuses the earlier receipts, chain parsing and refund sender.

## Run it

```
git clone --recurse-submodules https://github.com/seekdaseek/iussum-agent && cd iussum-agent
npm install
npm test                                   # 74 tests, offline, no key, no network
```

Devnet integration with a stub in place of the models (needs funded devnet keys in `.secrets/`, see `scripts/`):

```
node scripts/devnet-pipeline.mjs           # 3 purchases, 3 caught, 3 refunds; --no-check runs the control
DEV_STUBS=1 node scripts/serve.mjs         # the live page with a red "no model is called" banner
```

With a Meta key: `MODEL_API_KEY=... node scripts/make-catalogs.mjs` (Muse Image catalogue), then `node scripts/serve.mjs`. Other providers: `models/PROVIDERS.md`.

## Limits worth knowing

- The refund is paid from a float wallet that stands in for the seller's own refund key, as in the earlier demo. It is a devnet simplification.
- The delivery attestation binds to the payment by resource, payer and offer hash, not by transaction id (x402 settles after the shop answers). Two payments by one payer for one resource are told apart only by the receipt in the evidence record.
- One run at a time: each grant replaces the previous one on the shared devnet wallet.
- The thresholds of the delivery rule are starting values and have not been calibrated against a real model.
