import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { makeCase } from './cases.js';

const run = (...args) => spawnSync(process.execPath, ['--no-warnings', 'scripts/verify-evidence.mjs', ...args], { encoding: 'utf8' });

test('scripts/verify-evidence.mjs: exit 0 for a good record (with the attachments), exit 1 and the reason for a tampered one, exit 2 for bad usage', async () => {
  const c = await makeCase();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'iussum-vcli-'));
  const good = path.join(dir, 'e.json'), img = path.join(dir, 'img.png'), ov = path.join(dir, 'ov.png');
  fs.writeFileSync(good, JSON.stringify(c.ev)); fs.writeFileSync(img, c.img); fs.writeFileSync(ov, c.run.overlay_png);
  const ok = run(good, '--shop-key', c.key.publicKey, '--delivered', img, '--overlay', ov);
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  assert.match(ok.stdout, /VERIFIED/); assert.match(ok.stdout, /recorded      NOT_AS_OFFERED   recomputed NOT_AS_OFFERED/);
  const bad = JSON.parse(JSON.stringify(c.ev)); bad.record.checks.full.answer.matches_offer = 'yes';
  const badFile = path.join(dir, 'bad.json'); fs.writeFileSync(badFile, JSON.stringify(bad));
  const no = run(badFile, '--shop-key', c.key.publicKey);
  assert.equal(no.status, 1); assert.match(no.stdout, /NOT VERIFIED/); assert.match(no.stdout, /evidence_id does not match/);
  fs.writeFileSync(path.join(dir, 'other.png'), 'not the image');
  assert.equal(run(good, '--shop-key', c.key.publicKey, '--delivered', path.join(dir, 'other.png')).status, 1);
  assert.equal(run().status, 2);
});
