'use strict';

// The delivery engine (D22) is a verbatim copy of flow-skills: nothing in
// engine/ may change without changing engine/source.json with it.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ENGINE = path.join(__dirname, '..', 'engine');

function readSource() {
  return JSON.parse(fs.readFileSync(path.join(ENGINE, 'source.json'), 'utf8'));
}

function listFiles(dir, prefix = '') {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...listFiles(path.join(dir, entry.name), rel));
    else out.push(rel);
  }
  return out;
}

test('the engine copy records where it came from', () => {
  const source = readSource();
  assert.equal(source.repository, 'victorvelazquez/flow-skills');
  assert.match(source.commit, /^[0-9a-f]{40}$/);
  assert.match(source.version, /^\d+\.\d+\.\d+$/);
  assert.ok(Object.keys(source.files).length > 0);
});

test('every engine file is byte for byte the recorded copy, with nothing missing or extra', () => {
  const source = readSource();
  const recorded = Object.keys(source.files).sort();
  const present = listFiles(ENGINE).filter((rel) => rel !== 'source.json').sort();
  assert.deepEqual(present, recorded);
  for (const rel of recorded) {
    const bytes = fs.readFileSync(path.join(ENGINE, ...rel.split('/')));
    const digest = crypto.createHash('sha256').update(bytes).digest('hex');
    assert.equal(digest, source.files[rel], `${rel} differs from the copy of ${source.commit}`);
  }
});

test('the copied engine passes its own tests', { timeout: 300_000 }, () => {
  const files = listFiles(path.join(ENGINE, 'test')).map((rel) => `test/${rel}`);
  assert.ok(files.length > 0);
  // A nested `node --test` that inherits NODE_TEST_CONTEXT runs nothing and exits 0.
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(process.execPath, ['--test', ...files], {
    cwd: ENGINE,
    encoding: 'utf8',
    env,
    timeout: 280_000,
  });
  const output = `${result.stdout}\n${result.stderr}`;
  assert.equal(result.status, 0, output.slice(-4000));
  const ran = Number((/^# tests (\d+)$/m.exec(result.stdout) || [])[1] || 0);
  assert.ok(ran > 0, `the engine tests did not run:\n${output.slice(-4000)}`);
  assert.match(result.stdout, /^# fail 0$/m);
});
