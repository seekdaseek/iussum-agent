# Model providers

One interface per job (`models/provider.js`), three real adapters, one test-only adapter. Choose with `MODEL_PROVIDER` (all jobs) and `MODEL_PROVIDER_<JOB>` (one job), e.g. `MODEL_PROVIDER=baseten MODEL_PROVIDER_SEGMENT=modal`.

| Job | meta (Meta Model API) | baseten (open weights) | modal (open weights) |
|---|---|---|---|
| `transcribe` | `muse-voice-transcribe-1.0`, `POST /v1/asr/transcribe`, WAV mono PCM 16/24 kHz | Muse Spark Open, `audio_url` part | no |
| `compileMandate` | `muse-spark-1.3`, `response_format: json_schema` | Muse Spark Open, JSON asked for in the prompt, validated by us | no |
| `vision` | `muse-spark-1.3`, `image_url` data URL | Muse Spark Open, `image_url` part | no |
| `segment` | `sam-3.1`, `POST /v1/responses`, parsed with `@meta-sam/parser` | no | SAM 3.1 weights behind our own endpoint (`modal/sam_app.py`) |
| `generateImage` / `editImage` | `muse-image-1.0`, `/v1/images/generations` and `/v1/images/edits` | no | no |

A job a provider does not serve throws `ProviderError('unsupported')`. Nothing falls back silently to another provider.

## Status: UNTESTED against every service

No real call has been made yet (no key). The adapters were written from the docs read on 2026-10-26 (dev.meta.ai/docs: models, structured-output, image-understanding, image-generation, media-segmentation, sam/reading-segmentation, api-reference/voice) and their request shapes are pinned by `test/models.test.js` with a fake `fetch`. The first real call per job may expose a mismatch; that is expected and gets recorded in the day report.

Open questions the docs did not answer: whether `sam-3.1` accepts a base64 data URL for the image (the docs show an https URL); where `include_confidence` and `mask_encoding` go in the request (we send them under `metadata`); the exact response of `/v1/images/edits` for the JSON form.

## Prices (https://dev.meta.ai/docs/pricing-rate-limits, read 2026-10-26)

muse-spark-1.3 Standard: $1.25 in / $4.25 out per 1M tokens. Voice Transcribe: $0.18 per hour of audio. SAM 3.1: $2.50 per 1,000 images. Muse Image: $0.01 per image. Rate limit read for muse-spark-1.3: 3,000 requests per minute. Baseten and Modal calls are logged unpriced (`costUsd: null`), never with a guessed price.

## Baseten (Muse Spark Open)

Read 2026-10-26 by a research pass over docs.baseten.co; summaries, not verified line by line.
- Base URL `https://inference.baseten.co/v1`, `POST /chat/completions`, `Authorization: Bearer <BASETEN_API_KEY>`.
- Model id: the event guide says `meta-models/muse-spark-open-1026`; Baseten's docs say `meta-models/muse-spark-open`. The `-1026` id is UNCONFIRMED: list `GET /v1/models` with the key first. Override with `BASETEN_MODEL`.
- No structured-output / JSON mode for this model on Baseten: the adapter prompts for JSON and the caller validates it.
- Images: up to 8 per request, 10 MB each. Audio: `audio_url` parts, up to 5 minutes, WAV recommended; `data:` URLs work.
- Tool calling is documented for Model APIs generally; the request shape was not read.

## SAM 3.1 open weights (Modal path)

- Hugging Face `facebook/sam3.1` (gated; the card says no Transformers integration) and `facebook/sam3` (gated, Transformers `Sam3Model`). SAM 3.1 was released 2026-03-27 per the official GitHub README; its headline change is faster multi-object video tracking.
- Licence: SAM License, last updated 2025-11-19 (the same text ships in `@meta-sam/parser`). Reading of the text by the research pass: non-exclusive royalty-free licence to use, reproduce, distribute and modify; redistribution of weights or derivatives must carry the same agreement; a published-research acknowledgement clause; prohibited uses include military, nuclear, espionage, weapons and ITAR-controlled activity; sanctions and trade-control compliance; no geographic restriction beyond that. Read the LICENSE text itself before shipping weights anywhere. A hosted endpoint that never ships weights is the low-risk route.
- Needs: Python 3.12+, PyTorch 2.7+, a CUDA GPU (CUDA 12.6+), `pip install -e .` from github.com/facebookresearch/sam3, and an approved Hugging Face access request (rejections and delays are reported by others). No official Modal example for SAM 3 / 3.1 was found; Modal's SAM 2 example is the nearest template.
- `modal/sam_app.py` in this repo is a sketch of that endpoint, NOT deployed and NOT run.

## Fixture adapter (offline tests only)

Replays JSON files under `fixtures/` keyed by the input digest. Refused when `DEMO=1`. Every result carries `meta.provider: 'fixture'`; the evidence arbiter rejects such records in demo mode. `MODEL_RECORD_DIR=<dir>` wraps a real provider and saves each successful answer as a fixture with provenance `recorded`.
