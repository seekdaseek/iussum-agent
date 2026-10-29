// The shop catalogues built from REAL photographs with open licences (Muse Image is not available: the Meta Model API is blocked for this entry, see README).
// Photos come from Wikimedia Commons (CC0 or CC BY). Each file's source, author and licence are in assets/photos/SOURCES.md and shown on the shop pages.
// Three honest-looking offers per shop. The dishonest shop (mugworks) advertises the same red mugs as kiln but its paid delivery is a clear glass tumbler: a different
// real object, not a generated one.
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { SHOP_DEFS } from './registry.js';
import { loadCatalog } from './shop.js';

const commons = (file) => `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(file)}?width=1024`;
export const PHOTOS = {
  mug1: { file: 'My_Red_magic_mug.JPG', title: 'My Red magic mug', author: 'Michibeckmichal', license: 'CC0 1.0', license_url: 'https://creativecommons.org/publicdomain/zero/1.0/', page: 'https://commons.wikimedia.org/wiki/File:My_Red_magic_mug.JPG', shows: 'a red ceramic mug on a pink background' },
  mug2: { file: 'Coffee_-_Massachusetts.jpg', title: 'Coffee - Massachusetts', author: 'Daderot', license: 'CC0 1.0', license_url: 'https://creativecommons.org/publicdomain/zero/1.0/', page: 'https://commons.wikimedia.org/wiki/File:Coffee_-_Massachusetts.jpg', shows: 'a red ceramic mug filled with black coffee' },
  mug3: { file: 'Red_mug,_red_table_-_Flickr_-_sampsyo.jpg', title: 'Red mug, red table', author: 'Adrian Sampson', license: 'CC BY 2.0', license_url: 'https://creativecommons.org/licenses/by/2.0/', page: 'https://commons.wikimedia.org/wiki/File:Red_mug,_red_table_-_Flickr_-_sampsyo.jpg', shows: 'a red ceramic mug on a red table, the handle in the foreground' },
  glass1: { file: 'Tumbler_MET_DP235406.jpg', title: 'Tumbler (MET DP235406)', author: 'Bakewell, Pears and Company (photo: The Metropolitan Museum of Art)', license: 'CC0 1.0', license_url: 'https://creativecommons.org/publicdomain/zero/1.0/', page: 'https://commons.wikimedia.org/wiki/File:Tumbler_MET_DP235406.jpg', shows: 'a clear glass tumbler' },
  glass2: { file: 'Tumbler_MET_DP235293.jpg', title: 'Tumbler (MET DP235293)', author: 'Bakewell, Pears and Company (photo: The Metropolitan Museum of Art)', license: 'CC0 1.0', license_url: 'https://creativecommons.org/publicdomain/zero/1.0/', page: 'https://commons.wikimedia.org/wiki/File:Tumbler_MET_DP235293.jpg', shows: 'a clear glass tumbler' },
  glass3: { file: 'Tumbler_MET_DP235294.jpg', title: 'Tumbler (MET DP235294)', author: 'Bakewell, Pears and Company (photo: The Metropolitan Museum of Art)', license: 'CC0 1.0', license_url: 'https://creativecommons.org/publicdomain/zero/1.0/', page: 'https://commons.wikimedia.org/wiki/File:Tumbler_MET_DP235294.jpg', shows: 'a clear glass tumbler' },
};
const OFFER = { mug1: 'Red ceramic mug, pink background', mug2: 'Red ceramic mug with coffee', mug3: 'Red ceramic mug, red table' };
const offerItem = (key, n, price) => ({ sku: `mug-${n}`, title: OFFER[key], description: `Photo of ${PHOTOS[key].shows}.`, price_usdc: price, photo: key });
export const REAL_SPEC = {
  kiln: { honesty: 'honest', items: [offerItem('mug1', 1, '0.30'), offerItem('mug2', 2, '0.30'), offerItem('mug3', 3, '0.30')] },
  mugworks: { honesty: 'swap', items: [offerItem('mug1', 1, '0.15'), offerItem('mug2', 2, '0.15'), offerItem('mug3', 3, '0.15')].map((it, i) => ({ ...it, delivered_photo: `glass${i + 1}` })) },
  glazed: { honesty: 'honest', items: [offerItem('mug1', 1, '0.10'), offerItem('mug2', 2, '0.10')] },
};

// One-time download of the originals into photosDir (PNG, longest side <= 1024, EXIF rotation applied). `fetchBytes(url)` is injectable for tests.
export async function fetchPhotos({ photosDir, fetchBytes, log = () => {} }) {
  fs.mkdirSync(photosDir, { recursive: true });
  for (const [key, p] of Object.entries(PHOTOS)) {
    const out = path.join(photosDir, `${key}.png`);
    if (fs.existsSync(out)) continue;
    const png = await sharp(await fetchBytes(commons(p.file))).rotate().resize({ width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true }).png().toBuffer();
    fs.writeFileSync(out, png); log(`downloaded ${key} (${png.length} bytes)`);
  }
}
export function sourcesMarkdown() {
  const rows = Object.entries(PHOTOS).map(([k, p]) => `| ${k}.png | ${p.title} | ${p.author} | [${p.license}](${p.license_url}) | ${p.page} |`);
  return `# Photo sources\n\nThe shops' catalogue photographs are real photographs under open licences, taken from Wikimedia Commons. Each file was resized to at most 1024 px on its longest side and converted to PNG; nothing else was changed.\n\n| File | Title | Author | Licence | Source |\n|---|---|---|---|---|\n${rows.join('\n')}\n\nMuse Image was planned for these catalogues (including the dishonest shop's swapped deliveries as image edits) and is not used: the Meta Model API is not available to this entry.\nThe mug photos appear in more than one shop (shops often reuse supplier photos); mugworks delivers the glass tumblers (glass1-3) after payment for the three mugs it advertised.\n`;
}
// Assembles catalogDir/<shop>/ (catalog.json + the PNGs) from photosDir. Each item carries its credit for the shop page.
export function buildRealCatalogs({ photosDir, catalogDir }) {
  for (const d of SHOP_DEFS) {
    const spec = REAL_SPEC[d.id], dir = path.join(catalogDir, d.id);
    fs.mkdirSync(dir, { recursive: true });
    const items = spec.items.map((it) => {
      const adv = `${it.sku}.png`; fs.copyFileSync(path.join(photosDir, `${it.photo}.png`), path.join(dir, adv));
      const credit = (k) => ({ title: PHOTOS[k].title, author: PHOTOS[k].author, license: PHOTOS[k].license, license_url: PHOTOS[k].license_url, source: PHOTOS[k].page });
      const e = { sku: it.sku, title: it.title, description: it.description, price_usdc: it.price_usdc, image: adv, credit: credit(it.photo) };
      if (spec.honesty === 'swap') { const del = `${it.sku}.delivered.png`; fs.copyFileSync(path.join(photosDir, `${it.delivered_photo}.png`), path.join(dir, del)); e.delivered_image = del; e.delivered_credit = credit(it.delivered_photo); }
      return e;
    });
    fs.writeFileSync(path.join(dir, 'catalog.json'), `${JSON.stringify({ id: d.id, name: d.name, honesty: spec.honesty, source: 'wikimedia-commons-open-licence', items }, null, 1)}\n`);
    loadCatalog(catalogDir, d.id);
  }
  fs.writeFileSync(path.join(catalogDir, 'SOURCES.md'), sourcesMarkdown());
}
