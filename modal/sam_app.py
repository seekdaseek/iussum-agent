"""SKETCH, NOT DEPLOYED, NOT RUN. SAM 3.1 open weights behind a Modal web endpoint for models/adapters/modal.js.

Status (2026-10-26): no Modal account is configured, Hugging Face access to the gated facebook/sam3.1 weights has not been requested,
and the model-loading calls below follow the *SAM 3* README (facebookresearch/sam3), which a research pass read; the exact SAM 3.1
entry points are UNCONFIRMED. Treat every line that touches the model as a placeholder until it has run once on a GPU.

Wire format (also documented in models/adapters/modal.js):
  POST  { "image_b64": str, "phrase": str }   Authorization: Bearer <MODAL_SAM_TOKEN>
  ->    { "model": str, "width": int, "height": int,
          "instances": [ { "box": [x1, y1, x2, y2] (half-open pixel edges), "score": float, "mask_png_b64": str } ] }

Licence: SAM License (2025-11-19). The weights stay on Modal's volume and are never redistributed by this repo.
"""
import base64
import io
import os

import modal

app = modal.App("iussum-agent-sam")
image = (
    modal.Image.debian_slim(python_version="3.12")
    .pip_install("torch==2.7.1", "pillow", "numpy", "fastapi[standard]")
    .run_commands("pip install git+https://github.com/facebookresearch/sam3.git")  # UNCONFIRMED install route for 3.1
)
weights = modal.Volume.from_name("sam3-weights", create_if_missing=True)


@app.cls(image=image, gpu="A10G", volumes={"/weights": weights}, secrets=[modal.Secret.from_name("hf-token"), modal.Secret.from_name("sam-endpoint-token")], scaledown_window=300)
class Segmenter:
    @modal.enter()
    def load(self):
        from sam3.model_builder import build_sam3_image_model          # names from the SAM 3 README; UNCONFIRMED for 3.1
        from sam3.model.sam3_image_processor import Sam3Processor
        self.model = build_sam3_image_model()
        self.processor = Sam3Processor(self.model)

    @modal.fastapi_endpoint(method="POST")
    def segment(self, body: dict, authorization: str = ""):
        import numpy as np
        from PIL import Image

        if authorization != f"Bearer {os.environ['SAM_ENDPOINT_TOKEN']}":
            return modal.web_endpoint_error(401)  # placeholder: return an HTTP 401 with whatever the framework offers
        img = Image.open(io.BytesIO(base64.b64decode(body["image_b64"]))).convert("RGB")
        state = self.processor.set_image(img)
        out = self.processor.set_text_prompt(state=state, prompt=body["phrase"])
        instances = []
        for mask, box, score in zip(out["masks"], out["boxes"], out["scores"]):
            m = (np.asarray(mask.cpu()).squeeze() > 0).astype("uint8") * 255
            buf = io.BytesIO(); Image.fromarray(m).save(buf, format="PNG")
            x1, y1, x2, y2 = [float(v) for v in box.cpu()]
            instances.append({"box": [int(x1), int(y1), int(x2) + 1, int(y2) + 1], "score": float(score), "mask_png_b64": base64.b64encode(buf.getvalue()).decode()})
        return {"model": "sam3.1-open-weights", "width": img.width, "height": img.height, "instances": instances}
