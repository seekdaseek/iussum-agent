# Model providers

One interface per job (`models/provider.js`), three real adapters, one test-only adapter. Choose with `MODEL_PROVIDER` (all jobs) and `MODEL_PROVIDER_<JOB>` (one job), e.g. `MODEL_PROVIDER=baseten MODEL_PROVIDER_SEGMENT=modal`.

| Job | meta (Meta Model API) | baseten (open weights) | modal (open weights) |
|---|---|---|---|
| `transcribe` | `muse-voice-transcribe-1.0`, `POST /v1/asr/transcribe`, WAV mono PCM 16/24 kHz | Muse Spark Open, `audio_url` part | no |
| `compileMandate` | `muse-spark-1.3`, `response_format: json_schema` | Muse Spark Open, JSON asked for in the prompt, validated by us | no |
| `vision` | `muse-spark-1.3`, `image_url` data URL | Muse Spark Open, `image_url` part | no |
| `segment` | `sam-3.1`, `POST /v1/responses`, parsed with `@meta-sam/parser` | no | SAM 3 weights (facebook/sam3) behind our own endpoint (`modal/sam3_app.py`), `MODEL_PROVIDER_SEGMENT=modal` |
| `generateImage` / `editImage` | `muse-image-1.0`, `/v1/images/generations` and `/v1/images/edits` | no | no |

A job a provider does not serve throws `ProviderError('unsupported')`. Nothing falls back silently to another provider.

## Status (2026-10-29)

- **Baseten, Muse Spark Open: observed with a real key.** compile, vision (data: URL), audio (audio_url data: URL), native tool calling, JSON mode and grounding all answered; shapes are in the header of `models/adapters/baseten.js` and the raw responses were saved by `scripts/baseten-smoke.mjs` (data/smoke/, not committed). The `-1026` id exists in `GET /v1/models` as "[HACKATHON] Muse Spark Open" next to the plain id; the models list declares input modalities text and image only, yet audio is accepted (and on about 1 call in 10 answered "no audio file was detected", which the adapter retries).
- **Reasoning is always on.** `completion_tokens` includes the reasoning tokens (about 75% of them at `low`, about 90% at `medium`). `max_tokens` caps reasoning + answer; a cut answer is an error (`truncated`). Per-job effort: `BASETEN_EFFORT`, `BASETEN_EFFORT_<JOB>`, `BASETEN_MAX_TOKENS_<JOB>`. Defaults: low for compile, transcribe and the agent loop, medium for vision and grounding.
- **Meta Model API (`meta`)**: unavailable to this entry (card declined). The adapter stays in the repo, untested against the service.
- **Modal SAM 2.1 (`groundsam`)**: `modal/sam2_app.py` written from the documented transformers API, not deployed, not run. Until it is, `MODEL_PROVIDER_SEGMENT=ground` gives boxes only (path C).
- **Modal SAM 3.1 (`modal`)**: needs the gated weights; not requested by this repo's code, not run.

## Prices (https://dev.meta.ai/docs/pricing-rate-limits, read 2026-10-26)

muse-spark-1.3 Standard: $1.25 in / $4.25 out per 1M tokens. Voice Transcribe: $0.18 per hour of audio. SAM 3.1: $2.50 per 1,000 images. Muse Image: $0.01 per image. Rate limit read for muse-spark-1.3: 3,000 requests per minute. Baseten prices (from `GET /v1/models`, 2026-10-29): $1.25 prompt, $4.25 completion, $0.15 cached prompt per 1M tokens, applied by `models/cost.js`. Modal GPU time is logged unpriced (`costUsd: null`).

## Baseten (Muse Spark Open): docs summary from 2026-10-26 (the observed facts above supersede it)
- Base URL `https://inference.baseten.co/v1`, `POST /chat/completions`, `Authorization: Bearer <BASETEN_API_KEY>`.
- Model id: the event guide says `meta-models/muse-spark-open-1026`; Baseten's docs say `meta-models/muse-spark-open`. The `-1026` id is UNCONFIRMED: list `GET /v1/models` with the key first. Override with `BASETEN_MODEL`.
- No structured-output / JSON mode for this model on Baseten: the adapter prompts for JSON and the caller validates it.
- Images: up to 8 per request, 10 MB each. Audio: `audio_url` parts, up to 5 minutes, WAV recommended; `data:` URLs work.
- Tool calling is documented for Model APIs generally; the request shape was not read.

## SAM 3.1 open weights (Modal path)

- Hugging Face `facebook/sam3.1` (gated; the card says no Transformers integration) and `facebook/sam3` (gated, Transformers `Sam3Model`). SAM 3.1 was released 2026-03-27 per the official GitHub README; its headline change is faster multi-object video tracking.
- Licence: SAM License, last updated 2025-11-19 (the same text ships in `@meta-sam/parser`). Reading of the text by the research pass: non-exclusive royalty-free licence to use, reproduce, distribute and modify; redistribution of weights or derivatives must carry the same agreement; a published-research acknowledgement clause; prohibited uses include military, nuclear, espionage, weapons and ITAR-controlled activity; sanctions and trade-control compliance; no geographic restriction beyond that. Read the LICENSE text itself before shipping weights anywhere. A hosted endpoint that never ships weights is the low-risk route.
- Needs: Python 3.12+, PyTorch 2.7+, a CUDA GPU (CUDA 12.6+), `pip install -e .` from github.com/facebookresearch/sam3, and an approved Hugging Face access request (rejections and delays are reported by others). No official Modal example for SAM 3 / 3.1 was found; Modal's SAM 2 example is the nearest template.

## Fixture adapter (offline tests only)

Replays JSON files under `fixtures/` keyed by the input digest. Refused when `DEMO=1`. Every result carries `meta.provider: 'fixture'`; the evidence arbiter rejects such records in demo mode. `MODEL_RECORD_DIR=<dir>` wraps a real provider and saves each successful answer as a fixture with provenance `recorded`.
