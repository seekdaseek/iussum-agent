// Contact sheet of a candidate set for visual review: node scripts/build-sheet.mjs <set>   -> data/photo-search/<set>-sheet.png (index numbers drawn on each tile)
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
const set = process.argv[2], root = new URL('../data/photo-search/', import.meta.url).pathname;
const all = JSON.parse(fs.readFileSync(path.join(root, `${set}.json`), "utf8")); const [a, b] = [Number(process.argv[3] ?? 0), Number(process.argv[4] ?? all.length)]; const list = all.slice(a, b);
const T = 200, cols = 5, rows = Math.ceil(list.length / cols);
const tiles = [];
for (const [i, c] of list.entries()) {
  const img = await sharp(path.join(root, set, `${String(c.idx).padStart(2, '0')}.jpg`)).resize(T, T, { fit: 'cover' }).toBuffer();
  const label = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${T}" height="${T}"><rect x="0" y="0" width="46" height="30" fill="#000" fill-opacity=".75"/><text x="6" y="22" font-size="22" font-family="Helvetica,Arial" fill="#fff">${c.idx}</text></svg>`);
  tiles.push({ input: await sharp(img).composite([{ input: label }]).toBuffer(), left: (i % cols) * T, top: Math.floor(i / cols) * T });
}
await sharp({ create: { width: cols * T, height: rows * T, channels: 3, background: '#fff' } }).composite(tiles).png().toFile(path.join(root, `${set}-sheet-${a}.png`));
console.log(`${set}-sheet-${a}.png ${list.length} tiles`);
