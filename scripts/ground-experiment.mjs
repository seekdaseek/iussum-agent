// How does Muse Spark Open express a bounding box when asked for one? Asks for the box of a noun phrase on the real catalogue photos in three phrasings,
// logs the raw answers and draws the boxes so they can be looked at: node --env-file=.env scripts/ground-experiment.mjs [effort]
import fs from 'node:fs';
import sharp from 'sharp';
const key = process.env.BASETEN_API_KEY, effort = process.argv[2] ?? 'medium';
const MODEL = 'meta-models/muse-spark-open-1026';
const cases = [['mug1', 'red ceramic mug'], ['mug3', 'red ceramic mug'], ['glass2', 'clear glass tumbler']];
const prompts = {
  pixels: (w, h, ph) => `The image is ${w} pixels wide and ${h} pixels tall. Find the ${ph}. Answer with ONE JSON object: {"found": true|false, "box": {"x1": left, "y1": top, "x2": right, "y2": bottom}} in PIXELS of this image, origin top-left. If there is no ${ph} in the image, answer {"found": false, "box": null}.`,
};
fs.mkdirSync('data/ground', { recursive: true });
for (const [img, ph] of cases) {
  const buf = fs.readFileSync(`assets/photos/${img}.png`), { width: w, height: h } = await sharp(buf).metadata();
  for (const [pk, pf] of Object.entries(prompts)) {
    const t0 = Date.now();
    const r = await fetch('https://inference.baseten.co/v1/chat/completions', { method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: JSON.stringify({ model: MODEL, temperature: 0, max_tokens: 6000, reasoning_effort: effort, response_format: { type: 'json_object' }, messages: [{ role: 'user', content: [{ type: 'text', text: pf(w, h, ph) }, { type: 'image_url', image_url: { url: `data:image/png;base64,${buf.toString('base64')}` } }] }] }) });
    const j = await r.json(); const c = j.choices?.[0]?.message?.content;
    console.log(`${img} ${w}x${h} "${ph}" [${pk}] ${Date.now() - t0} ms tokens ${j.usage?.completion_tokens}: ${String(c).replace(/\s+/g, ' ').slice(0, 160)}`);
    try {
      const o = JSON.parse(c); if (o.found && o.box) {
        const s = pk === 'norm1000' ? [w / 1000, h / 1000] : pk === 'norm1' ? [w, h] : [1, 1];
        const b = { x1: o.box.x1 * s[0], y1: o.box.y1 * s[1], x2: o.box.x2 * s[0], y2: o.box.y2 * s[1] };
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect x="${b.x1}" y="${b.y1}" width="${b.x2 - b.x1}" height="${b.y2 - b.y1}" fill="none" stroke="#f0f" stroke-width="6"/></svg>`;
        await sharp(await sharp(buf).composite([{ input: Buffer.from(svg) }]).png().toBuffer()).resize({ width: 400 }).png().toFile(`data/ground/${img}-${pk}.png`);
      }
    } catch (e) { console.log("  draw/parse failed:", e.message.slice(0, 120)); }
  }
}
