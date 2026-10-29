// Open-licence photo candidates from Wikimedia Commons: node scripts/commons-candidates.mjs <set> "<query>" ["<query>" ...]
// Keeps only CC0, public domain and CC BY (no SA/NC/ND). Writes data/photo-search/<set>.json (metadata) and 360px thumbnails; build-sheet.mjs makes a contact sheet.
import fs from 'node:fs';
import path from 'node:path';
const [set, ...queries] = process.argv.slice(2);
const root = new URL('../data/photo-search/', import.meta.url).pathname, dir = path.join(root, set); fs.mkdirSync(dir, { recursive: true });
const UA = { 'user-agent': 'iussum-agent-hackathon/0.1 (open-licence catalogue search; contact via GitHub seekdaseek)' };
const strip = (s) => String(s ?? '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
const okLic = (l) => /^(cc0|cc-zero|public domain|pd\b)/i.test(l) || /^cc[ -]by(?![- ]?(sa|nc|nd))[ -]\d/i.test(l);
const seen = new Map();
for (const q of queries) {
  const u = new URL('https://commons.wikimedia.org/w/api.php');
  Object.entries({ action: 'query', generator: 'search', gsrsearch: `${q} filetype:bitmap`, gsrnamespace: '6', gsrlimit: '30', prop: 'imageinfo', iiprop: 'url|size|mime|extmetadata', iiurlwidth: '360', format: 'json', formatversion: '2' }).forEach(([k, v]) => u.searchParams.set(k, v));
  let j; try { j = await (await fetch(u, { headers: UA })).json(); } catch (e) { console.error(q, e.message); continue; }
  for (const p of j.query?.pages ?? []) {
    const ii = p.imageinfo?.[0]; if (!ii || seen.has(p.title)) continue;
    const m = ii.extmetadata ?? {}, lic = m.LicenseShortName?.value ?? '?';
    if (!okLic(lic) || !/jpeg|png/.test(ii.mime) || ii.width < 600) continue;
    seen.set(p.title, { title: p.title, license: lic, license_url: m.LicenseUrl?.value ?? null, artist: strip(m.Artist?.value), credit: strip(m.Credit?.value).slice(0, 120), page: ii.descriptionurl, file: ii.url, thumb: ii.thumburl, w: ii.width, h: ii.height, query: q, desc: strip(m.ImageDescription?.value).slice(0, 140) });
  }
}
const list = [...seen.values()];
let n = 0;
for (const c of list) { try { const r = await fetch(c.thumb, { headers: UA }); if (r.ok) { fs.writeFileSync(path.join(dir, `${String(n).padStart(2, '0')}.jpg`), Buffer.from(await r.arrayBuffer())); c.idx = n++; } } catch { /* skip */ } }
fs.writeFileSync(path.join(root, `${set}.json`), JSON.stringify(list.filter((c) => c.idx !== undefined), null, 1));
console.log(`${set}: ${n} candidates`);
list.filter((c) => c.idx !== undefined).forEach((c) => console.log(`${String(c.idx).padStart(2)} ${c.license.padEnd(12)} ${c.title.replace(/^File:/, '').slice(0, 70)}`));
