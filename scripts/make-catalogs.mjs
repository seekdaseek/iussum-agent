// Generates the shops' catalogue images with Muse Image (and the dishonest shop's swapped deliveries with Muse Image edits): node scripts/make-catalogs.mjs [--force]
// Needs MODEL_API_KEY. 12 generations + 4 edits = 16 images = 0.16 USD at the listed price. Existing files are kept unless --force.
import path from 'node:path';
import { createProvider } from '../models/provider.js';
import { CostLedger } from '../models/cost.js';
import { makeCatalogs } from '../src/shops/make-catalogs.js';
const root = new URL('..', import.meta.url).pathname, dataDir = path.resolve(process.env.DATA_DIR ?? path.join(root, 'data'));
const provider = createProvider({ ledger: new CostLedger({ file: path.join(dataDir, 'cost.jsonl') }) });
const made = await makeCatalogs({ provider, catalogDir: path.join(dataDir, 'catalog'), force: process.argv.includes('--force'), log: console.log });
console.log(`${made.length} image(s) written; spend so far ${JSON.stringify(provider.ledger.summary())}`);
