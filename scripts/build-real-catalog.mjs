// Builds data/catalog from the open-licence photos: node scripts/build-real-catalog.mjs
// The originals are committed under assets/photos (with SOURCES.md); if one is missing it is downloaded from Wikimedia Commons first.
import fs from 'node:fs';
import path from 'node:path';
import { fetchPhotos, buildRealCatalogs, sourcesMarkdown } from '../src/shops/real-catalog.js';
const root = new URL('..', import.meta.url).pathname;
const photosDir = path.join(root, 'assets/photos'), catalogDir = path.resolve(process.env.DATA_DIR ?? path.join(root, 'data'), 'catalog');
await fetchPhotos({ photosDir, log: console.log, fetchBytes: async (url) => { const r = await fetch(url, { redirect: 'follow', headers: { 'user-agent': 'iussum-agent-hackathon/0.1 (open-licence catalogue; github.com/seekdaseek/iussum-agent)' } }); if (!r.ok) throw new Error(`${url} -> HTTP ${r.status}`); return Buffer.from(await r.arrayBuffer()); } });
fs.writeFileSync(path.join(photosDir, 'SOURCES.md'), sourcesMarkdown());
buildRealCatalogs({ photosDir, catalogDir });
console.log(`catalogue built in ${catalogDir}`);
