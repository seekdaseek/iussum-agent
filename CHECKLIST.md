# Submission checklist (answered 2026-10-29, re-answer before submitting)

Sources read live on 2026-10-29: the Cerebral Valley participant guide, Official Rules and waiver page and the submit form (logged in), and the event emails. Nothing below has been submitted.

## 1. What the platform asks for, and what we have

| Required by the form / rules | Status |
|---|---|
| Team name (prefilled) and team members | have: solo entry, one member |
| Track (required): Indie Developer | have |
| Problem statement (required): Build for Your World, or Push the Frontier | decision: **Build for Your World** (payments and disputes for agents: a problem the author works on) |
| Most Viral: link to the X post (optional field) | missing until the post is up |
| Project description | draft in the day-4 report; final text Nov 4 |
| Public GitHub repository | have: https://github.com/seekdaseek/iussum-agent (public, pushed) |
| 3-minute demo video (a link, for example YouTube) | missing: plan written, not rendered |
| "Describe your use of Meta products" | have the facts (below); text drafted |
| "Why are Meta's models important to your solution?" | drafted |
| "Feedback from your experience using Meta products" | drafted: includes that the Meta Model API was unreachable for us |
| "Feedback from your experience using partner technologies" | drafted: Baseten, Modal |
| Consent checkbox (Meta and Cerebral Valley may use and publish the submission) | the submitter's to tick |
| Everyone who worked on the project is listed; repository and video link accessible | solo; verify the links logged out on Nov 4 |

## 2. Dates (Eastern Time unless noted)

Submissions due **Wed Nov 4, 9:00 PM ET = Nov 5 02:00 UTC** (our target: submitted by Nov 4 18:00 UTC). Nov 3 is the last full day for submission questions; office hours in Discord 10 to 11 AM ET on weekdays, a final session Nov 4. Judging Nov 5 to 8. Closing ceremony and live finals **Mon Nov 9, 12:00 PM ET** (top 5 per track); community vote opens then and its winner is announced Nov 16; additional prizes are announced on or about Nov 10. Most Viral counts X engagement until Nov 8 end of day.

## 3. Judging criteria and where we stand

Stage 1 pass/fail: fits a problem statement (yes) and really uses Meta's models (yes: Muse Spark Open for every language, audio and vision job; SAM 2.1 for masks; both Meta open weights). Stage 2, 0 to 10 each: **Impact 30%** (an agent that spends only inside spoken limits and gets money back for a wrong delivery; the x402 dispute-evidence thread is a live standards discussion in which this work is cited), **Use of Meta AI tooling 25%** (one open-weight model doing five jobs, audio in, tool calling, JSON mode, vision and box grounding, plus SAM 2.1 and an evaluated SAM 3; "beyond a basic integration" is the evidence pipeline), **Technical depth 20%** (three-state rule, signed delivery attestations, recomputable evidence records, an arbiter that re-runs the check itself, chain-proven refund claimed once, 96 offline tests, mutation check on the refund claim), **Demo 25%** (live page, a run takes about 4 minutes, a finished run opens in seconds, video). Stage 3: top 5 per track judged from the video.

## 4. Rules and risks

- Public repository: yes. Demo shows only what was built in the window: the video narrates only the new parts and says in one line that payment and verdict run on the earlier open-source iussum (declared in README and ARCHITECTURE.md; submodule pinned at `e476c89`). The Official Rules also allow open-source components when the submission builds on them.
- Anti-projects named by the guide include "Simple Image Analyzers". Risk: the delivery check could be read as an image analyzer. Answer: it is one stage of a payment pipeline (voice to mandate, purchase, check, evidence, dispute, refund) and the check never decides alone.
- Assets and rights: shop photos are CC0 or CC BY with credits on the shop pages and in `assets/photos/SOURCES.md`; SAM 2.1 is Apache-2.0; SAM License (SAM 3) text was read, weights are not redistributed.
- Eligibility: at least 18, not in a sanctioned country (the Official Rules list Belarus, China, Russia, Ukraine, Syria, Cuba, North Korea, Iran and some regions: Moldova is not listed). **To confirm by the submitter:** that the Official Rules and waiver were accepted (the event status email says APPROVED; acceptance of the waiver is not visible to us). Prize winners also need a W-8BEN (non-US).
- Open-weight bonus ($10K, "Muse Spark Open or Muse Glimmer on own hardware or partner inference", verified by the infrastructure partner): every model call goes to `meta-models/muse-spark-open-1026` on Baseten. Keep the Baseten request log; no hosted Meta Model API call was ever made.
- Best Creative ($5K, Muse Image or Wonder): not eligible (Muse Image not used).

## 5. The what-wins list, re-answered

1. **Rubric**: see section 3.
2. **Sponsor primitives by name**: Muse Spark Open (`meta-models/muse-spark-open-1026`): audio input, JSON mode, native tool calling, vision, box grounding; SAM 2.1 `facebook/sam2.1-hiera-large`; SAM 3 `facebook/sam3` evaluated on the same 28 images; Meta's `@meta-sam/parser` is a dependency. Muse Image, Muse Voice Transcribe, SAM 3.1 and the Meta Model API: not used, and the README says why.
3. **Action**: a judge opens the live page, speaks or types a request, and watches it become limits, a purchase, a caught wrong delivery and a refund, with nothing installed (`JUDGE_GUIDE.md`).
4. **Evidence, counts from real runs in the window** (real models, Solana devnet, as of 2026-10-29): 7 full runs, 19 photos bought, 18 caught as not as offered and refunded on chain (2.70 USDC), 1 delivered as offered by the honest shop (0.30 USDC), 0 could not be checked; net 0.30 USDC lost on the honest purchase. Compile eval on Baseten: 30 requests 30/30, 30/30 and 29/30 at low reasoning effort, 29/30 at medium; 22 held-out requests 21/22 before two code fixes and 22/22 after (the held-out set is no longer clean for those two). Delivery calibration on 28 labelled images: 0 false passes, 0 false accusations on the 22 clear cases. Every claim has a devnet tx or an evidence id. No users: none invented.
5. **Field / twins**: `REPORT-day4.md` section 3. Short version: the x402 dispute-evidence issue (#3500) names the same evidence triple and this entry is cited there as the first working implementation against a live chain; nobody found combines a spoken mandate, an on-chain grant and a segmentation-backed delivery check.
6. **Format**: 3-minute video, 16:9, the wrong mug caught and the money back in the first 10 seconds, the control run side by side, an .srt sidecar, no captions over the picture. README and JUDGE_GUIDE are "do X, see Y".
7. **Liveness**: the page runs as `iussum-meta.service` behind its own tunnel with a 10-minute watch passed; it must stay up from Nov 5 to Nov 9 and through the community vote (Nov 16). Open items: Modal credit (about $0.65 of $1.00 left; the segmentation container must stay affordable for judging week), Baseten credit ($100, about $1.3 used), the devnet wallet balances (principal 5.25 USDC, float 12.6 USDC, each run moves 0.45 USDC and returns it), a daily full demo run.
8. **Social**: Most Viral ($20K) and Community Vote ($10K). The X post (video and live link, "built at the Meta Global AI Developer Hackathon") is drafted for the author to post; the post link goes into the form.
9. **Fit**: the organisers' push is agents, verifiable agents (Oct 28 workshop), multimodal. Best Agentic Use-Case ($5K) is a direct fit (autonomy inside enforced limits, multi-step workflow, practical task).
10. **Control**: the same agent with the delivery check off pays the dishonest shop and loses 0.45 USDC (measured twice); with the check on the net loss is 0. Shown side by side in the video.
11. **Gates (the author's)**: Meta Model API key was never obtained (card declined), not needed; Baseten key and credit in place; Modal login done with $1 free credit.
12. **Artifacts before submit**: README (done), ARCHITECTURE.md (done), JUDGE_GUIDE.md (done), CHECKLIST.md (this file), tests (96 offline), the 30 + 22 request evals and the 28-image calibration (done), the live page (done), the video (to render), the X post (to post), the submission text (drafted).

## 6. Open items, in order

1. ~~Decide RECHECK~~ Done 2026-10-29: the live arbiter re-runs the check itself (RECHECK=1). 12 of 12 re-runs agreed; about 31 s and $0.01 extra per dispute; a run now takes about 4 minutes.
2. A "last completed run" link on the live page, so a judge can look without waiting.
3. Twins and field check again after the Cerebral Valley gallery goes public (it was not public on Oct 29).
4. Render the video (plan in the day-4 report), upload it, put the link in the form.
5. The X post, then the link in the form.
6. Nov 4 by 18:00 UTC: logged-out check of repository, live page, video; re-read the guide; fill the form; the submitter presses Submit.
