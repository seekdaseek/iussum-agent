// Downloads the labelled delivery images (eval/delivery-labels.json) at <= 1024 px as PNG into data/delivery-set/: node eval/delivery-fetch.mjs
import fs from 'node:fs';
import sharp from 'sharp';
const spec = JSON.parse(fs.readFileSync(new URL('./delivery-labels.json', import.meta.url), 'utf8'));
const dir = new URL('../data/delivery-set/', import.meta.url); fs.mkdirSync(dir, { recursive: true });
for (const im of spec.images) {
  const out = new URL(`${im.id}.png`, dir);
  if (fs.existsSync(out)) continue;
  const name = decodeURIComponent(new URL(im.page).pathname.split('/File:')[1]);
  const r = await fetch(`https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(name)}?width=1024`, { redirect: 'follow', headers: { 'user-agent': 'iussum-agent-hackathon/0.1 (open-licence calibration set)' } });
  if (!r.ok) { console.log(im.id, 'HTTP', r.status); continue; }
  fs.writeFileSync(out, await sharp(Buffer.from(await r.arrayBuffer())).rotate().resize({ width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true }).png().toBuffer());
  console.log('fetched', im.id, name.slice(0, 50));
}
