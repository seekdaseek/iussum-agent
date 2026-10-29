"""SAM 3 (facebook/sam3, Meta open weights, SAM License, gated: access granted to this account on 2026-10-29) behind a Modal web endpoint: a noun phrase in,
instance masks out. Path A of the delivery check (the same wire format as the SAM 3.1 route in models/adapters/modal.js; SAM 3.1 itself is still pending).

Written from the documented transformers API (huggingface.co/docs/transformers/model_doc/sam3, text-prompt example, read 2026-10-29).
Secrets: sam-endpoint-token (SAM_ENDPOINT_TOKEN, same value as MODAL_SAM_TOKEN in .env) and hf-token (HF_TOKEN: a Hugging Face READ token of the account that was granted access).
Deploy: .venv/bin/modal deploy modal/sam3_app.py      (CPU: Modal asks for a payment method before it runs any GPU function)

Wire format:
  POST  { "image_b64": str, "phrase": str }         Authorization: Bearer <token>
  ->    { "model": str, "width": int, "height": int,
          "instances": [ { "box": [x1, y1, x2, y2] (half-open pixel edges), "score": float, "mask_png_b64": str (full-frame 8-bit PNG, 255 = inside) } ] }
"""
import base64
import io
import math
import os

import modal
from fastapi import HTTPException, Request  # needed locally too: Modal reads the endpoint's signature at deploy time

MODEL_ID = os.environ.get("SAM_MODEL_ID", "facebook/sam3")
GPU = os.environ.get("SAM_GPU") or None
app = modal.App("iussum-agent-sam3")
image = (modal.Image.debian_slim(python_version="3.12")
         .pip_install("torch", "torchvision", "transformers", "pillow", "numpy", "fastapi[standard]", "accelerate")
         .env({"HF_HOME": "/cache/hf"}))
cache = modal.Volume.from_name("sam-hf-cache", create_if_missing=True)

with image.imports():
    import numpy as np
    import torch
    from PIL import Image
    from transformers import Sam3Model, Sam3Processor


@app.cls(image=image, gpu=GPU, cpu=4.0, memory=12288, scaledown_window=120, timeout=300, volumes={"/cache": cache},
         secrets=[modal.Secret.from_name("sam-endpoint-token"), modal.Secret.from_name("hf-token")])
class Segmenter:
    @modal.enter()
    def load(self):
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        self.model = Sam3Model.from_pretrained(MODEL_ID).to(self.device).eval()
        self.processor = Sam3Processor.from_pretrained(MODEL_ID)

    @modal.fastapi_endpoint(method="POST")
    def segment(self, body: dict, request: Request):
        if request.headers.get("authorization", "") != f"Bearer {os.environ['SAM_ENDPOINT_TOKEN']}":
            raise HTTPException(status_code=401, detail="bad token")
        phrase = str(body.get("phrase", "")).strip()
        if not phrase or len(phrase) > 120:
            raise HTTPException(status_code=400, detail="phrase must be 1 to 120 characters")
        img = Image.open(io.BytesIO(base64.b64decode(body["image_b64"]))).convert("RGB")
        inputs = self.processor(images=img, text=phrase, return_tensors="pt").to(self.device)
        with torch.no_grad():
            out = self.model(**inputs)
        res = self.processor.post_process_instance_segmentation(out, threshold=0.5, mask_threshold=0.5, target_sizes=inputs.get("original_sizes").tolist())[0]
        instances = []
        for mask, box, score in zip(res["masks"], res["boxes"], res["scores"]):
            m = (np.asarray(mask.cpu()).squeeze() > 0).astype("uint8") * 255
            buf = io.BytesIO()
            Image.fromarray(m).save(buf, format="PNG")
            x1, y1, x2, y2 = [float(v) for v in box.cpu()]
            instances.append({"box": [int(math.floor(x1)), int(math.floor(y1)), int(math.ceil(x2)), int(math.ceil(y2))], "score": float(score), "mask_png_b64": base64.b64encode(buf.getvalue()).decode()})
        return {"model": MODEL_ID, "width": img.width, "height": img.height, "instances": instances}
