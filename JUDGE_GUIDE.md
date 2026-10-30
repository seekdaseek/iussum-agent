# Judge guide: 30 seconds to see a finished run, about 4 minutes for a live one

Live page: **https://meta.ochinimus.app** (Solana devnet, test money, nothing to install, no account). Repository: https://github.com/seekdaseek/iussum-agent.

## What you will see

You tell an AI agent what it may spend. It buys photos inside those limits from three demo shops. One shop is dishonest: it advertises red ceramic mugs and delivers clear glass tumblers after it is paid. The system looks at each delivered photo with Meta's open-weight models, builds an evidence record, and refunds the buyer on chain by rule.

## The live run

1. **Open the page** (it already contains an example request). Optional: press *Record*, say the request in your own words (up to 20 s) and check the text it heard.
2. **Press "Turn it into limits"** (about 2 s). Muse Spark Open turns the words into limits, then software validates them. You get a plain-words read-back: total, per-purchase maximum, which shops, how long, what it is looking for. **Nothing has been granted yet.**
3. **Press "Confirm and run"**. This signs one transaction on devnet (the grant) and starts the run. A run takes **about 4 minutes** (232 to 316 s measured; the longest had a cold segmentation container; the arbiter re-runs the check itself on every dispute); you only need to watch the first minute and the result. The timeline shows each step live: payments, "Received photo", "Checking photo", "Filing a dispute" (the arbiter then re-runs the check on the shop's own bytes, about 30 s per photo), the verdict, "refund paid", "Grant revoked".
4. **Read the result cards**. For each photo you see what the shop delivered next to the segmentation mask of what the check found, the outcome (NOT AS OFFERED here), and links: payment tx, refund tx, verdict page, evidence record. The summary strip should read: 3 bought, 3 caught, 0.45 USDC paid, 0.45 USDC refunded, **0 net loss**.
5. **Optional, 20 seconds: the control.** Press *Run without the delivery check (control)* on a fresh read-back: the same agent pays the same shop and nobody looks at what arrived. Net loss: 0.45 USDC.

**First run after a quiet period:** the segmentation model runs on a serverless CPU container that scales to zero. The page shows a stage line, "Starting the segmentation model (about 30 to 60 s if it has been idle)", with a ticking timer; it is woken while the agent is still shopping, so most of the time you will not wait for it. If it were unavailable (for example out of credit) the photos are reported as **COULD NOT BE CHECKED** with the reason: nobody is refunded or accused on an unchecked photo.

**If the page says another run is in progress:** one run at a time, because each run replaces the single grant on the shared demo wallet. Wait about 4 minutes, or look at a finished run (next section).

## A finished run you can open right now

- Demo video (2:53): https://www.youtube.com/watch?v=9CExAnb9XKE. Post on X: https://x.com/ochinimus/status/2115768140793589838.
- Run report: https://meta.ochinimus.app/runs/20261029095306-mgb1p/run.json
- Verdict page for its first photo (offer text next to the mask of the glass goblet that was delivered, and the arbiter's own re-run row): https://meta.ochinimus.app/v/iMjSQ8idc3PjP8Jkxw5r5eDnq1tnh5i22SJky182bFnwDCHX34sWy6kCF5KMH4br3SNUoGEeowsBN7t9C2KNRyu
- Evidence record: https://meta.ochinimus.app/runs/20261029095306-mgb1p/evidence-1.json (the delivered photo `img-1.png` and the overlay `overlay-1.png` are in the same folder)
- The grant, the payment and the refund are on Solana devnet; the links are in the run report and on the cards. The "Track record" panel at the bottom of the live page shows the running tally of all real runs (13 checked runs, 37 photos, 36 caught when this run was made), split into local runs and runs on the page.

## Check it yourself (about 30 seconds, needs Node 24)

```
git clone --recurse-submodules https://github.com/seekdaseek/iussum-agent && cd iussum-agent && npm install
node scripts/verify-evidence.mjs https://meta.ochinimus.app/runs/20261029095306-mgb1p/evidence-1.json
```
It prints `VERIFIED` and the recomputed outcome. It does not re-run any model, but the live arbiter already did (each verdict page records the re-run's result). It recomputes the evidence id (RFC 8785 JCS + sha256), checks both signatures of the shop (key from the shop's own `.well-known`), the link between the payment receipt and the delivery attestation, the recorded segmentation output, and re-applies the three-state rule to the recorded model answers. Change one character of the record and it prints `NOT VERIFIED` with the reason. `npm test` runs the offline suite.

## Things worth trying on the page

- *"Buy me some photos."* → one question back (it asks for the total first). No grant.
- *"Buy photos of mugs from Kiln & Co, spend whatever it takes."* → rejected: a permission needs a fixed limit.
- *"Buy one photo of a red ceramic mug, 0.40 USDC in total, only from Kiln & Co, today."* → the honest shop: the photo is **DELIVERED AS OFFERED**, no dispute, 0.30 USDC spent. The check is not a machine for accusing everybody.
- Ignore-previous-instructions text inside a request does not move any limit.

## What is new and what is not

Everything outside `prior/` was written during the hackathon window. The grant, the seller gate, the receipts and the refund sender come from the author's earlier open-source iussum (pinned submodule at `e476c89`), used as a library; the voice-to-mandate compiler, the shops, the shopping agent, the delivery check, the evidence record, the arbiter rule for wrong deliveries and this page are new. Models: Muse Spark Open `meta-models/muse-spark-open-1026` (Baseten) for every language, audio and vision job, and SAM 2.1 `facebook/sam2.1-hiera-large` (Modal) for masks. Muse Image is not used (the Meta Model API was not available to this entry); the shop photos are real open-licence photographs, credited on each shop page (`/shops/kiln/`).

See ARCHITECTURE.md for the design, the threats and the limits, and the README's evaluation section for SAM 3 against SAM 2.1.
