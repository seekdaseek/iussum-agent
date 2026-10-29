// Search Wikimedia Commons for open-licence photos: node scripts/commons-search.mjs "query" [limit]
// Prints title, size, licence short name, artist (HTML stripped) and the page URL. Only CC0, public domain and CC BY (any version) are marked OK.
const q = process.argv[2], limit = Number(process.argv[3] ?? 30);
const u = new URL('https://commons.wikimedia.org/w/api.php');
Object.entries({ action: 'query', generator: 'search', gsrsearch: `${q} filetype:bitmap`, gsrnamespace: '6', gsrlimit: String(limit), prop: 'imageinfo', iiprop: 'url|size|mime|extmetadata', iiurlwidth: '1024', format: 'json', formatversion: '2' }).forEach(([k, v]) => u.searchParams.set(k, v));
const r = await fetch(u, { headers: { 'user-agent': 'iussum-agent-hackathon/0.1 (open-licence catalogue search)' } });
const j = await r.json();
const strip = (s) => String(s ?? '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
const okLic = (l) => /^(cc0|public domain|pd|cc by(?!-sa|-nc|-nd)\b)/i.test(l) || /^cc-by-\d/i.test(l) || /^cc-zero/i.test(l);
for (const p of (j.query?.pages ?? []).sort((a, b) => a.index - b.index)) {
  const ii = p.imageinfo?.[0]; if (!ii) continue;
  const m = ii.extmetadata ?? {}, lic = m.LicenseShortName?.value ?? '?';
  console.log(`${okLic(lic) ? 'OK ' : 'no '} ${lic.padEnd(14)} ${String(ii.width).padStart(5)}x${String(ii.height).padEnd(5)} ${p.title}  | ${strip(m.Artist?.value).slice(0, 40)} | ${ii.descriptionurl}`);
}
