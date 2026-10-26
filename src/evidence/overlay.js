// The mask overlay PNG: the delivered image with the best mask tinted and its box outlined. Boxes and masks come from the segmentation in the coordinates of the frame
// the model saw (`frame`); they are scaled to the real image if that differs. No text is drawn (the page labels it in HTML), so no font is needed on the host.
import sharp from 'sharp';

const TINT = { r: 255, g: 64, b: 160 }; // magenta: not a colour any demo object has

export async function imageSize(bytes) { const m = await sharp(bytes).metadata(); return { w: m.width, h: m.height }; }

function scaleOf(frame, size) { return frame && frame.w > 0 && frame.h > 0 ? { sx: size.w / frame.w, sy: size.h / frame.h } : { sx: 1, sy: 1 }; }
export function boxInImage(box, frame, size) {
  const { sx, sy } = scaleOf(frame, size);
  const clamp = (v, max) => Math.max(0, Math.min(max, Math.round(v)));
  return { x1: clamp(box.x1 * sx, size.w), y1: clamp(box.y1 * sy, size.h), x2: clamp(box.x2 * sx, size.w), y2: clamp(box.y2 * sy, size.h) };
}

export async function makeOverlay(imageBytes, { instance = null, frame = null } = {}) {
  const size = await imageSize(imageBytes);
  const base = sharp(imageBytes).ensureAlpha();
  const layers = [];
  if (!instance) { // nothing was segmented: a red frame says so
    const t = Math.max(4, Math.round(Math.min(size.w, size.h) / 80));
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size.w}" height="${size.h}"><rect x="${t / 2}" y="${t / 2}" width="${size.w - t}" height="${size.h - t}" fill="none" stroke="#d11" stroke-width="${t}"/></svg>`;
    return { png: await base.composite([{ input: Buffer.from(svg) }]).png().toBuffer(), size, drawn: 'none' };
  }
  const m = instance.mask, { sx, sy } = scaleOf(frame, size);
  // the mask raster covers [left,right) x [top,bottom) of the model's frame; paint each set bit as a tinted block in image pixels
  const w = Math.max(1, Math.round((m.right - m.left) * sx)), h = Math.max(1, Math.round((m.bottom - m.top) * sy));
  const rgba = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const mx = Math.min(m.width - 1, Math.floor((x / w) * m.width)), my = Math.min(m.height - 1, Math.floor((y / h) * m.height));
    if (m.bits[my * m.width + mx]) { const o = (y * w + x) * 4; rgba[o] = TINT.r; rgba[o + 1] = TINT.g; rgba[o + 2] = TINT.b; rgba[o + 3] = 140; }
  }
  const left = Math.max(0, Math.min(size.w - 1, Math.round(m.left * sx))), top = Math.max(0, Math.min(size.h - 1, Math.round(m.top * sy)));
  const cw = Math.min(w, size.w - left), ch = Math.min(h, size.h - top);
  const maskPng = await sharp(rgba, { raw: { width: w, height: h, channels: 4 } }).extract({ left: 0, top: 0, width: cw, height: ch }).png().toBuffer();
  layers.push({ input: maskPng, left, top });
  const b = boxInImage(instance.box, frame, size), t = Math.max(2, Math.round(Math.min(size.w, size.h) / 160));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size.w}" height="${size.h}"><rect x="${b.x1}" y="${b.y1}" width="${Math.max(1, b.x2 - b.x1)}" height="${Math.max(1, b.y2 - b.y1)}" fill="none" stroke="rgb(${TINT.r},${TINT.g},${TINT.b})" stroke-width="${t}"/></svg>`;
  layers.push({ input: Buffer.from(svg) });
  return { png: await base.composite(layers).png().toBuffer(), size, drawn: 'mask+box' };
}

// a crop of the box with a margin, for the second vision judgement
export async function cropBox(imageBytes, { instance, frame, margin = 0.08 }) {
  const size = await imageSize(imageBytes);
  const b = boxInImage(instance.box, frame, size);
  const mx = Math.round((b.x2 - b.x1) * margin), my = Math.round((b.y2 - b.y1) * margin);
  const left = Math.max(0, b.x1 - mx), top = Math.max(0, b.y1 - my);
  const width = Math.max(1, Math.min(size.w - left, b.x2 - b.x1 + 2 * mx)), height = Math.max(1, Math.min(size.h - top, b.y2 - b.y1 + 2 * my));
  return sharp(imageBytes).extract({ left, top, width, height }).png().toBuffer();
}
