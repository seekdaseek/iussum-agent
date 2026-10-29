# The demo video: shot list

Rule 27: a committed shot list. Every shot is tagged NEW (built 2026-10-26 to 2026-11-04, the hackathon window) or PRIOR (earlier open-source iussum, the grant and refund plumbing). This file is generated from the build that produced the video (`build/shots.json` in the video workspace).

- Length: **173.4 s**. NEW: **170.4 s**. PRIOR: **3.0 s** (limit 4 s). The grant is one timeline line plus one spoken sentence naming it as earlier work; the refund appears once, on the Solana explorer.
- The picture is the live page https://meta.ochinimus.app doing a real run on Solana devnet (run 20261029095306-mgb1p), the GitHub-rendered files of this repository, a terminal running `scripts/verify-evidence.mjs` against that run's evidence record, and the control run beside it. Nothing is mocked.
- The request is spoken by a macOS synthetic voice played into the page as the microphone; the video says so. Muse Spark Open transcribes it. The first take of that recording was cut short by the fake microphone's looping file, so the second take is the one shown (the capture log keeps both transcripts).
- The shopping, checking and arbiter stretches of the run are sped up (the lines and timers are the real ones; the waiting is cut). The segmentation container was cold in this run (151 s to start).

## Shots

| # | time | s | tag | narration | on screen |
|---|---|---|---|---|---|
| 1 | 0:00.0-0:05.2 | 5.2 | NEW | H1: An AI agent paid for 3 red mug photos. The shop sent glass tumblers. The agent proved it and got every cent back. | the shop's advertised red ceramic mug beside what it delivered, with the SAM 2.1 mask (poster composed from the shop catalogue photo and the run's overlay file) |
| 2 | 0:05.2-0:09.1 | 3.9 | NEW | H1: An AI agent paid for 3 red mug photos. The shop sent glass tumblers. The agent proved it and got every cent back. | live page, run summary strip: 3 bought, 3 caught, 0.45 refunded, net loss 0 (run 20261029095306-mgb1p) |
| 3 | 0:09.1-0:17.8 | 8.7 | NEW | W1: You let an agent spend for you. When a seller sends the wrong thing, nobody checks, and nobody pays you back. | the live page at https://meta.ochinimus.app, top of the page |
| 4 | 0:17.8-0:23.6 | 5.7 | NEW | N0: I say it out loud. A synthetic voice stands in for my microphone. | live page, Record pressed (Listening) |
| 5 | 0:23.6-0:32.8 | 9.3 | NEW | (the synthetic request is heard; no narration) | live page recording the synthetic voice (real time); the request audio is mixed in |
| 6 | 0:32.8-0:35.4 | 2.6 | NEW | R1: Meta's open-weight Muse Spark Open turns the audio into text, then into limits. | live page, Transcribing (sped up) |
| 7 | 0:35.4-0:41.4 | 5.9 | NEW | R1: Meta's open-weight Muse Spark Open turns the audio into text, then into limits. | live page, the transcript in the box, "Heard by meta-models/muse-spark-open-1026" |
| 8 | 0:41.4-0:43.7 | 2.3 | NEW | R2: Code, not the model, validates them: 2 USDC in total, at most 0.8 per purchase, 7 days. Nothing is granted until I confirm. | live page, the request is compiled to limits (real time) |
| 9 | 0:43.7-0:52.1 | 8.5 | NEW | R2: Code, not the model, validates them: 2 USDC in total, at most 0.8 per purchase, 7 days. Nothing is granted until I confirm. | live page, read-back of the limits: 2 USDC total, 0.8 per purchase, 7 days, Nothing is granted yet |
| 10 | 0:52.1-1:01.2 | 9.1 | NEW | G1: Confirm signs one transaction on Solana devnet. That permission layer is my earlier open-source work; everything from here is new. | live page timeline: Signing the grant, Grant confirmed on chain (one line; the narration names it as earlier open-source work) |
| 11 | 1:01.2-1:14.8 | 13.6 | NEW | A1: Meta's open-weight Muse Spark Open is the agent. It lists the shops, reads the catalogues, and buys the cheapest offers inside the limits: 3 photos at 0.15 USDC each. | live page timeline: Agent calls list_shops, get_catalog, buy_photo; Paid mugworks 0.15 USDC x3; the segmentation start timer ticking (sped up) |
| 12 | 1:14.8-1:18.1 | 3.3 | NEW | C1: Each photo is checked independently. Muse Spark Open finds the item, and Meta's SAM 2.1 cuts out its mask. | live page: "Photo 1: locating the offered item and cutting it out" with its timer (real time) |
| 13 | 1:18.1-1:23.3 | 5.2 | NEW | C1: Each photo is checked independently. Muse Spark Open finds the item, and Meta's SAM 2.1 cuts out its mask. | ARCHITECTURE.md on GitHub: the pipeline, step 1 "ground the offered noun phrase: Muse Spark Open to box, SAM 2.1 (Modal) to mask" |
| 14 | 1:23.3-1:26.6 | 3.3 | NEW | C2: Then Muse Spark Open's vision judges it against the offer: a clear glass goblet, not a red ceramic mug. Not as offered. | live page: "Photo 1: judging the photo against the offer" with its timer, then "not as offered" (sped up) |
| 15 | 1:26.6-1:32.7 | 6.1 | NEW | C2: Then Muse Spark Open's vision judges it against the offer: a clear glass goblet, not a red ceramic mug. Not as offered. | verdict page: the check looked for red ceramic mug; segmentation found 0 matches; the vision model saw clear glass goblet and answered no |
| 16 | 1:32.7-1:42.8 | 10.1 | NEW | C3: If a check errors, is unsure, or the two disagree, the answer is could not be checked. Never a pass, never an accusation. | ARCHITECTURE.md on GitHub: the three-state rule |
| 17 | 1:42.8-1:51.2 | 8.3 | NEW | E1: Everything goes into an evidence record, signed by the shop. Anyone can recompute it: this prints verified. | terminal: node scripts/verify-evidence.mjs on the live evidence record prints VERIFIED |
| 18 | 1:51.2-1:58.9 | 7.7 | NEW | E2: Then the arbiter proves the payment on chain and runs the check again itself, on the shop's own bytes. With open weights, it does not have to trust the buyer. | live page: "the arbiter proves the payment on chain and re-runs the check itself" with its timer, then "arbiter re-ran the check itself: not as offered, agrees with the filed record" (sped up) |
| 19 | 1:58.9-2:00.9 | 2.0 | NEW | E2: Then the arbiter proves the payment on chain and runs the check again itself, on the shop's own bytes. With open weights, it does not have to trust the buyer. | live page: the re-run line and "refund paid" on the timeline |
| 20 | 2:00.9-2:06.5 | 5.6 | NEW | E3: It agrees, so the seller is liable, and the full price goes back to the buyer by rule. | verdict page: seller liable, outcome, payment, refund, evidence id, "Arbiter's own re-run: agrees with the filed record" |
| 21 | 2:06.5-2:09.5 | 3.0 | PRIOR | E3: It agrees, so the seller is liable, and the full price goes back to the buyer by rule. | Solana explorer: the refund transaction, Success, Finalized (the refund sender is the earlier open-source iussum) |
| 22 | 2:09.5-2:26.6 | 17.2 | NEW | P1: 13 full runs so far: 37 photos bought, 36 caught and refunded on chain, and the 1 honest delivery paid. On 28 labelled photos: 0 false passes, and 0 false accusations on the 22 clear cases. | CHECKLIST.md on GitHub: the evidence counts and the calibration numbers |
| 23 | 2:26.6-2:31.2 | 4.6 | NEW | P3: Meta's SAM 3 was tested against SAM 2.1 on the same photos. SAM 2.1 shipped: about twice as fast on CPU. | README.md on GitHub: Evaluation, SAM 3 against SAM 2.1 (28 images, table head) |
| 24 | 2:31.2-2:36.8 | 5.6 | NEW | P3: Meta's SAM 3 was tested against SAM 2.1 on the same photos. SAM 2.1 shipped: about twice as fast on CPU. | README.md on GitHub: the latency and cost rows of the table |
| 25 | 2:36.8-2:44.8 | 8.0 | NEW | X1: Same agent, same shop, check off: it loses 0.45 USDC. With the check on, the net loss is 0. | control run (check off) beside the checked run: net loss 0.45 against 0 |
| 26 | 2:44.8-2:53.4 | 8.6 | NEW | F1: Try it at meta.ochinimus.app. Solana devnet, test money. | end card: live link, repository, models, what is new and what is earlier work, photo credits |

## Numbers said or shown, and where each comes from

| Number | Said in | Source |
|---|---|---|
| 3 red mug photos; 3 photos at 0.15 USDC each | H1, A1 | run report `/api/runs/20261029095306-mgb1p`: purchased 3, each payment 150000 base units (0.15 USDC) |
| 2 USDC in total, 0.8 per purchase, 7 days | R2 | the same report's limits (total_cap_usdc 2, per_payment_max_usdc 0.8, valid_for_hours 168); on screen in the read-back |
| 0.45 USDC lost with the check off, net loss 0 with it on | X1 | control run `20261029083838-zhkyh` (net loss 0.45) and the checked run (refunded 0.45, net loss 0); both strips on screen |
| 13 full runs, 37 photos, 36 caught, 1 honest delivery paid | P1 | CHECKLIST.md item 4, counted from the stored run reports on the author's machine and on the VPS (`out/tally.json`: 13 runs, 37 photos, 36 caught, 1 delivered as offered, 5.4 USDC refunded, 2 control runs) |
| 28 labelled photos, 0 false passes, 0 false accusations on the 22 clear cases | P1 | CHECKLIST.md item 4 and README.md Evaluation; `eval/delivery-labels.json` holds 28 images |
| SAM 3 against SAM 2.1, about twice as fast on CPU | P3, C1 | README.md Evaluation table: whole check about 30 s against about 60 s per image |
| the arbiter's re-run agreed (29.7 s, 75.6 s and 37.7 s here) | E2, E3 | the verdict page row "Arbiter's own re-run" and the timeline line, from the run report's `verdict.recheck` |

Photo credits (also on the end card): Wikimedia Commons, CC0 and CC BY 2.0 (Adrian Sampson); see `assets/photos/SOURCES.md`.
