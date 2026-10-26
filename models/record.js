// Wraps a real provider and saves each successful answer as a fixture, so later offline tests replay answers a model really gave.
// Enabled with MODEL_RECORD_DIR. The input digest is the fixture key (see adapters/fixture.js); binary inputs are stored as sha256 only.
import fs from 'node:fs';
import path from 'node:path';
import { digestInput, fixturePath } from './adapters/fixture.js';

const JOB_INPUT = {
  transcribe: (a) => ({ audio: a[0] }),
  compileMandate: (a) => ({ text: a[0], system: a[1].system, schema: a[1].schema }),
  vision: (a) => ({ image: a[0], question: a[1], schema: a[2]?.schema ?? null, system: a[2]?.system ?? null }),
  segment: (a) => ({ image: a[0], phrase: a[1] }),
  generateImage: (a) => ({ prompt: a[0], size: a[1]?.size ?? null }),
  editImage: (a) => ({ image: a[0], prompt: a[1] }),
};
const storable = (job, value) => {
  if (job === 'segment') return { rawOutput: value.rawOutput };
  if (job === 'generateImage' || job === 'editImage') return { png_b64: Buffer.from(value.png).toString('base64') };
  return value;
};
export function withRecording(provider, dir) {
  const out = { name: provider.name };
  for (const job of Object.keys(JOB_INPUT)) {
    out[job] = async (...args) => {
      const res = await provider[job](...args);
      const input = JOB_INPUT[job](args);
      const file = fixturePath(dir, job, input);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, `${JSON.stringify({ provenance: 'recorded', job, input: digestInput(job, input), result: { value: storable(job, res.value), meta: res.meta } }, null, 1)}\n`);
      return res;
    };
  }
  return out;
}
