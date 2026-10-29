// Candidate open-licence photos from Openverse (CC0, public domain mark, CC BY only): node scripts/openverse-candidates.mjs <name> "<query>" [pages]
// Downloads thumbnails to data/photo-search/<name>/ and writes <name>.json with source, creator, licence, urls. A contact sheet is built separately for visual review.
import fs from 'node:fs';
import path from 'node:path';
const [name, query, pages = '2'] = process.argv.slice(2);
const dir = path.join(new URL('../data/photo-search/', import.meta.url).pathname, name); fs.mkdirSync(dir, { recursive: true });
const out = [];
for (let page = 1; page <= Number(pages); page++) {
  const u = new URL('https://api.openverse.org/v1/images/');
  Object.entries({ q: query, license: 'cc0,pdm,by', category: 'photograph', page: String(page), page_size: '20', mature: 'false', extension: 'jpg' }).forEach(([k, v]) => u.searchParams.set(k, v));
  const r = await fetch(u, { headers: { 'user-agent': 'iussum-agent-hackathon/0.1' } });
  if (!r.ok) { console.error('openverse HTTP', r.status, (await r.text()).slice(0, 200)); break; }
  const j = await r.json();
  for (const it of j.results ?? []) out.push({ id: it.id, title: it.title, creator: it.creator, license: it.license, license_version: it.license_version, license_url: it.license_url, source: it.source, landing: it.foreign_landing_url, url: it.url, thumb: it.thumbnail, w: it.width, h: it.height, attribution: it.attribution });
}
let n = 0;
for (const c of out) {
  try { const r = await fetch(c.thumb ?? c.url, { headers: { 'user-agent': 'iussum-agent-hackathon/0.1' } }); if (!r.ok) continue; fs.writeFileSync(path.join(dir, `${String(n).padStart(2, '0')}.jpg`), Buffer.from(await r.arrayBuffer())); c.idx = n++; } catch { /* skip */ }
}
fs.writeFileSync(path.join(dir, '..', `${name}.json`), JSON.stringify(out.filter((c) => c.idx !== undefined), null, 1));
console.log(`${name}: ${n} thumbnails of ${out.length} results`);
