"""SAM 2.1 (Meta open weights, Apache-2.0, ungated) behind a Modal web endpoint: a box in, a mask out. Used by models/adapters/groundsam.js after
Muse Spark Open has grounded the noun phrase to a box.

STATUS: written from the documented transformers API (huggingface.co/docs/transformers/model_doc/sam2, box-prompt example, read 2026-10-29). Deploy:  .venv/bin/modal deploy modal/sam2_app.py   (needs `modal token new` and the secret below).
Secret:  modal secret create sam-endpoint-token SAM_ENDPOINT_TOKEN=<random>   (the same value goes in .env as MODAL_SAM_TOKEN)

Wire format (documented in models/adapters/groundsam.js):
  POST  { "image_b64": str, "boxes": [[x1, y1, x2, y2], ...] }        Authorization: Bearer <token>
  ->    { "model": str, "width": int, "height": int,
          "instances": [ { "box": [x1, y1, x2, y2], "score": float (SAM's predicted IoU of the mask), "mask_png_b64": str (full-frame 8-bit PNG, 255 = inside) } ] }
"""
import base64
import io
import os

import modal
from fastapi import HTTPException, Request  # needed locally too: Modal reads the endpoint's signature at deploy time

MODEL_ID = os.environ.get("SAM_MODEL_ID", "facebook/sam2.1-hiera-large")
GPU = os.environ.get("SAM_GPU") or None  # unset = CPU: Modal asks for a payment method before it runs any GPU function
app = modal.App("iussum-agent-sam2")
image = modal.Image.debian_slim(python_version="3.12").pip_install("torch", "torchvision", "transformers", "pillow", "numpy", "fastapi[standard]", "accelerate").env({"HF_HOME": "/cache/hf"})
cache = modal.Volume.from_name("sam-hf-cache", create_if_missing=True)  # weights downloaded once, not at every cold start

with image.imports():
    import numpy as np
    import torch
    from PIL import Image
    from transformers import Sam2Model, Sam2Processor


@app.cls(image=image, gpu=GPU, cpu=4.0, memory=8192, scaledown_window=120, timeout=300, volumes={"/cache": cache}, secrets=[modal.Secret.from_name("sam-endpoint-token")])
class Segmenter:
    @modal.enter()
    def load(self):
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        self.model = Sam2Model.from_pretrained(MODEL_ID).to(self.device).eval()
        self.processor = Sam2Processor.from_pretrained(MODEL_ID)

    @modal.fastapi_endpoint(method="POST")
    def segment(self, body: dict, request: Request):
        if request.headers.get("authorization", "") != f"Bearer {os.environ['SAM_ENDPOINT_TOKEN']}":
            raise HTTPException(status_code=401, detail="bad token")
        boxes = body.get("boxes") or []
        if not (1 <= len(boxes) <= 8) or any(len(b) != 4 for b in boxes):
            raise HTTPException(status_code=400, detail="boxes must be 1 to 8 boxes of [x1, y1, x2, y2]")
        img = Image.open(io.BytesIO(base64.b64decode(body["image_b64"]))).convert("RGB")
        inputs = self.processor(images=img, input_boxes=[[[float(v) for v in b] for b in boxes]], return_tensors="pt").to(self.device)
        with torch.no_grad():
            out = self.model(**inputs, multimask_output=False)
        masks = self.processor.post_process_masks(out.pred_masks.cpu(), inputs["original_sizes"])[0]  # (n_boxes, 1, H, W) bool
        scores = out.iou_scores.cpu().reshape(len(boxes), -1)[:, 0].tolist()
        instances = []
        for box, mask, score in zip(boxes, masks, scores):
            m = (np.asarray(mask.squeeze(0)) > 0).astype("uint8") * 255
            buf = io.BytesIO()
            Image.fromarray(m).save(buf, format="PNG")
            instances.append({"box": [int(box[0]), int(box[1]), int(box[2]), int(box[3])], "score": float(score), "mask_png_b64": base64.b64encode(buf.getvalue()).decode()})
        return {"model": MODEL_ID, "width": img.width, "height": img.height, "instances": instances}
