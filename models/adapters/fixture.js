// Recorded-fixture adapter. FOR OFFLINE TESTS ONLY: it returns what a file says, so nothing it returns is evidence about any model.
// Never selected in the demo or the video: createProvider refuses it when DEMO=1, and every result it returns carries meta.provider 'fixture',
// which the evidence arbiter rejects in demo mode.
// A fixture file is fixtures/<job>/<key>.json = { provenance, job, input, result: { value, meta } }. key = sha256 of the job and the input digests.
// provenance: 'recorded' (a real provider answer saved by models/record.js), 'meta-doc-sample' (an example printed in Meta's own docs), 'hand-written' (invented for a unit test).
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { canonicalize } from '@iussum/core';
import { ProviderError } from '../errors.js';
import { readSamResult } from './meta.js';

const sha = (b) => createHash('sha256').update(b).digest('hex');
export const digestInput = (job, input) => {
  const d = {};
  for (const [k, v] of Object.entries(input)) d[k] = v instanceof Uint8Array || Buffer.isBuffer(v) ? `sha256:${sha(v)}` : v;
  return { job, ...d };
};
export const fixtureKey = (job, input) => sha(canonicalize(digestInput(job, input))).slice(0, 24);
export const fixturePath = (dir, job, input) => path.join(dir, job, `${fixtureKey(job, input)}.json`);

export function createFixtureAdapter({ dir }) {
  const NAME = 'fixture';
  async function replay(job, input) {
    const file = fixturePath(dir, job, input);
    if (!fs.existsSync(file)) throw new ProviderError('fixture_missing', `no fixture ${path.relative(process.cwd(), file)} for ${JSON.stringify(digestInput(job, input)).slice(0, 200)}`, { provider: NAME, job });
    const fx = JSON.parse(fs.readFileSync(file, 'utf8'));
    let value = fx.result.value;
    if (job === 'segment') value = await readSamResult(value.rawOutput);
    return { value, meta: { ...fx.result.meta, provider: NAME, fixtureProvenance: fx.provenance, replayedFrom: fx.result.meta?.provider ?? null } };
  }
  return {
    name: NAME,
    transcribe: (audio) => replay('transcribe', { audio }),
    compileMandate: (text, { system, schema }) => replay('compileMandate', { text, system, schema }),
    vision: (image, question, o = {}) => replay('vision', { image, question, schema: o.schema ?? null, system: o.system ?? null }),
    segment: (image, phrase) => replay('segment', { image, phrase }),
    generateImage: (prompt, o = {}) => replay('generateImage', { prompt, size: o.size ?? null }).then(inflatePng),
    editImage: (image, prompt) => replay('editImage', { image, prompt }).then(inflatePng),
  };
}
const inflatePng = (r) => ({ ...r, value: { png: Buffer.from(r.value.png_b64, 'base64') } });
