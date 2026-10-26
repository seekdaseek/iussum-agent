// Builds catalogDir/<shop>/ (catalog.json + images) by calling Muse Image through the provider layer:
//   advertised image: generateImage(prompt); dishonest shop's delivered image: editImage(advertised, delivered_prompt).
// Existing files are kept (a regeneration is explicit: pass force) so a re-run never spends credit twice. Cost per image is logged by the provider's ledger.
// UNTESTED against the real service (no key yet); tests/shops.test.js runs it against a stub provider.
import fs from 'node:fs';
import path from 'node:path';
import { CATALOG_SPEC } from './catalog-spec.js';
import { SHOP_DEFS } from './registry.js';
import { loadCatalog } from './shop.js';

export async function makeCatalogs({ provider, catalogDir, force = false, only = null, log = () => {} }) {
  const made = [];
  for (const d of SHOP_DEFS) {
    if (only && !only.includes(d.id)) continue;
    const spec = CATALOG_SPEC[d.id], dir = path.join(catalogDir, d.id);
    fs.mkdirSync(dir, { recursive: true });
    const items = [];
    for (const it of spec.items) {
      const adv = path.join(dir, `${it.sku}.png`);
      if (force || !fs.existsSync(adv)) { fs.writeFileSync(adv, (await provider.generateImage(it.prompt, { size: '1024x1024' })).value.png); made.push(adv); log(`generated ${d.id}/${it.sku}`); }
      const entry = { sku: it.sku, title: it.title, description: it.description, price_usdc: it.price_usdc, image: `${it.sku}.png`, prompt: it.prompt };
      if (spec.honesty === 'swap') {
        const del = path.join(dir, `${it.sku}.delivered.png`);
        if (force || !fs.existsSync(del)) { fs.writeFileSync(del, (await provider.editImage(fs.readFileSync(adv), it.delivered_prompt)).value.png); made.push(del); log(`edited ${d.id}/${it.sku}`); }
        entry.delivered_image = `${it.sku}.delivered.png`; entry.delivered_prompt = it.delivered_prompt;
      }
      items.push(entry);
    }
    fs.writeFileSync(path.join(dir, 'catalog.json'), `${JSON.stringify({ id: d.id, name: d.name, honesty: spec.honesty, generated_with: 'muse-image-1.0', items }, null, 1)}\n`);
    loadCatalog(catalogDir, d.id); // validates what was just written
  }
  return made;
}
