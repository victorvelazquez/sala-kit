'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { tempDir, writeSala, salaConfig, runSala } = require('./helpers');

const KIT_AGENT = path.join(__dirname, '..', 'agents', 'miembro-entrega.md');

// A home of its own: the tests never write in the real Gentle Shell.
function home(t, { gentle = true } = {}) {
  const dir = tempDir(t);
  if (gentle) fs.mkdirSync(path.join(dir, '.gentle-shell', 'agent'), { recursive: true });
  const env = { SALA_GENTLE_AGENT_DIR: path.join(dir, '.gentle-shell', 'agent') };
  const agents = path.join(dir, '.gentle-shell', 'agent', 'agents');
  return { dir, env, agents, copy: path.join(agents, 'miembro-entrega.md') };
}

function json(res) {
  return JSON.parse(res.stdout);
}

function state(result, name = 'miembro-entrega') {
  return result.agents.find((a) => a.name === name).state;
}

// A copy that an older kit installed: another body, with a valid mark.
function oldCopy(file) {
  const body = '---\nname: miembro-entrega\n---\n\nUna versión vieja.\n';
  const hash = crypto.createHash('sha256').update(body).digest('hex');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${body}<!-- sala-kit: version 0.0.1 sha256 ${hash} -->\n`);
}

test('sala instalar copies the kit agents with their mark and a second run changes nothing', (t) => {
  const h = home(t);
  const first = runSala(h.dir, ['instalar'], h.env);
  assert.equal(first.code, 0, first.stderr);
  assert.equal(first.stderr, '');
  const result = json(first);
  assert.equal(result.ok, true);
  assert.equal(result.dir, h.agents);
  assert.equal(state(result), 'instalado');
  const copy = fs.readFileSync(h.copy, 'utf8');
  assert.match(copy, /^---\nname: miembro-entrega\n/);
  assert.doesNotMatch(copy, /^model:/m, 'the kit never pins a model');
  assert.match(copy, /<!-- sala-kit: version 0\.1\.0 sha256 [0-9a-f]{64} -->\n$/);
  assert.ok(fs.readFileSync(KIT_AGENT, 'utf8').length > 0);

  const before = fs.statSync(h.copy).mtimeMs;
  const second = runSala(h.dir, ['instalar'], h.env);
  assert.equal(second.code, 0, second.stderr);
  assert.equal(state(json(second)), 'al-dia');
  assert.equal(fs.readFileSync(h.copy, 'utf8'), copy);
  assert.equal(fs.statSync(h.copy).mtimeMs, before);
});

test('sala instalar refuses without Gentle Shell and creates nothing', (t) => {
  const h = home(t, { gentle: false });
  const res = runSala(h.dir, ['instalar'], h.env);
  assert.equal(res.code, 1);
  assert.equal(res.stdout, '');
  assert.match(JSON.parse(res.stderr).error, /Gentle Shell/);
  assert.equal(fs.existsSync(path.join(h.dir, '.gentle-shell')), false);
});

test('sala instalar replaces a stale copy but never an edited or foreign one without --forzar', (t) => {
  const h = home(t);
  oldCopy(h.copy);
  const updated = runSala(h.dir, ['instalar'], h.env);
  assert.equal(updated.code, 0, updated.stderr);
  assert.equal(state(json(updated)), 'actualizado');
  assert.match(fs.readFileSync(h.copy, 'utf8'), /version 0\.1\.0/);

  // Edited by the person: the mark no longer matches the body.
  const edited = fs.readFileSync(h.copy, 'utf8').replace('---\n\n', '---\n\nMi cambio.\n');
  fs.writeFileSync(h.copy, edited);
  const refused = runSala(h.dir, ['instalar'], h.env);
  assert.equal(refused.code, 1);
  assert.equal(json(refused).ok, false);
  assert.equal(state(json(refused)), 'editada');
  assert.equal(fs.readFileSync(h.copy, 'utf8'), edited);

  // A file of the same name that the kit never wrote.
  fs.writeFileSync(h.copy, '---\nname: miembro-entrega\n---\nMío.\n');
  const foreign = runSala(h.dir, ['instalar'], h.env);
  assert.equal(foreign.code, 1);
  assert.equal(state(json(foreign)), 'ajena');
  assert.equal(fs.readFileSync(h.copy, 'utf8'), '---\nname: miembro-entrega\n---\nMío.\n');

  const forced = runSala(h.dir, ['instalar', '--forzar'], h.env);
  assert.equal(forced.code, 0, forced.stderr);
  assert.equal(state(json(forced)), 'forzado');
  assert.equal(state(json(runSala(h.dir, ['instalar'], h.env))), 'al-dia');
  assert.deepEqual(fs.readdirSync(h.agents), ['miembro-entrega.md'], 'no temporary file is left');
});

test('sala revisar warns about a missing, stale or edited agent copy and fixes nothing', (t) => {
  const h = home(t);
  const sala = tempDir(t);
  writeSala(sala, salaConfig([]));
  const review = () => {
    const res = runSala(sala, ['revisar'], h.env);
    assert.equal(res.code, 0, res.stderr);
    return json(res).kit.agents[0];
  };

  const missing = review();
  assert.deepEqual([missing.name, missing.state, missing.fix], ['miembro-entrega', 'falta', 'sala instalar']);
  assert.equal(fs.existsSync(h.agents), false, 'revisar never installs');

  oldCopy(h.copy);
  assert.deepEqual([review().state, review().fix], ['vieja', 'sala instalar']);

  runSala(h.dir, ['instalar'], h.env);
  assert.deepEqual([review().state, review().fix], ['al-dia', null]);

  fs.appendFileSync(h.copy, 'otra línea\n');
  const edited = review();
  assert.equal(edited.state, 'editada');
  assert.equal(edited.fix, 'sala instalar --forzar');

  const text = runSala(sala, ['revisar', '--texto'], h.env).stdout;
  assert.match(text, /aviso: el agente miembro-entrega instalado fue editado/);

  // Without Gentle Shell in this machine there is nothing to warn about.
  const none = runSala(sala, ['revisar', '--texto'], { SALA_GENTLE_AGENT_DIR: path.join(h.dir, 'no-existe') }).stdout;
  assert.doesNotMatch(none, /aviso/);
});
