# iussum-agent

Tell your AI agent out loud what it may spend; it buys within those limits, and when a seller delivers the wrong thing it builds the evidence itself and gets the money back by rule.

Entry for the Meta Global AI Developer Hackathon (Indie Developer track). Everything under this repo's own paths was started after the event opened on 2026-10-26 17:00 UTC; the git history shows it.

**Status: scaffold only. Nothing in the pipeline below is built or tested yet.**

## Built during the hackathon vs prior work

| Part | Where | Status |
|---|---|---|
| Voice/text request -> mandate compiler (Muse Voice Transcribe + Muse Spark structured output) | `src/` | not started |
| 30-request compile eval | `eval/` | not started |
| Demo shops with Muse Image catalogs and one dishonest shop (Muse Image edits) | `shops/` | not started |
| Shopping agent loop (Muse Spark tool calling) | `src/` | not started |
| Delivery check (SAM 3.1 + Muse Spark vision), three states, hashed evidence record | `src/` | not started |
| Live page | `web/` | not started |

| Prior work, used as a library | Where |
|---|---|
| iussum: mandate, grant, x402 gate, agent payer, resolver on Solana (MIT, built 2026-10-19 to 2026-10-22) | `prior/iussum`, git submodule pinned at `e476c89`; no file from it is copied into this repo |

Payment, grant and verdict run on the earlier open-source iussum. Everything else is new.
