'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { tempDir, git, memberRepo, writeSala, salaConfig, runSala } = require('./helpers');

const HEADER = '**Dónde está:** algo.\n**Qué sigue:** algo.\n**Qué lo bloquea:** nada.\n';
const TABLE = [
  '| ID | Entrega | Resultado visible | Depende de | Estado | Notas | Ficha |',
  '| --- | --- | --- | --- | --- | --- | --- |',
  '| E1 | Primera | Se ve | — | Completada |  | — |',
].join('\n');
const tested = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'contrato', 'gentle-shell.json'), 'utf8'));
const BLOCK = '<!-- sala-kit:miembro:inicio -->\nbloque\n<!-- sala-kit:miembro:fin -->\n';
const GOOD = { 'docs/ROADMAP.md': `# Hoja de ruta\n\n${HEADER}\n${TABLE}\n`, 'AGENTS.md': `# Reglas\n\n${BLOCK}` };

function pushFiles(work, files) {
  for (const [file, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(work, file)), { recursive: true });
    fs.writeFileSync(path.join(work, file), content);
    git(work, 'add', file);
  }
  git(work, 'commit', '--quiet', '-m', 'files');
  git(work, 'push', '--quiet', 'origin', 'main');
}

function member(id, work, extra = {}) {
  return { id, prefix: id.toUpperCase(), path: work, base: 'main', ...extra };
}

function ids(requirements) {
  return requirements.map((r) => [r.id, r.ok]);
}

test('a member that meets every requirement passes them all', (t) => {
  const dir = tempDir(t);
  const core = memberRepo(dir, 'core');
  pushFiles(core.work, GOOD);
  writeSala(dir, salaConfig([member('core', core.work)]));

  const res = runSala(dir, ['revisar']);

  assert.equal(res.code, 0, res.stderr);
  assert.equal(res.stderr, '');
  const out = JSON.parse(res.stdout);
  assert.equal(out.sala, 'prueba');
  assert.deepEqual(out.salaJson, { ok: true, requirements: [{ id: 'no-secrets', ok: true, detail: 'sala.json sin secretos', fix: null }] });
  assert.equal(out.members[0].ok, true);
  assert.deepEqual(ids(out.members[0].requirements), [
    ['base-remote', true], ['roadmap-table', true], ['roadmap-header', true],
    ['roadmap-states', true], ['agents-size', true], ['member-block', true], ['no-secrets', true],
  ]);
});

test('every failing requirement says why and the order to fix it', (t) => {
  const dir = tempDir(t);
  const core = memberRepo(dir, 'core');
  pushFiles(core.work, {
    'docs/ROADMAP.md': `# Hoja de ruta\n\n**Dónde está:** algo.\n\n${TABLE}\n| E2 | Otra | Se ve | E1 | Lista |  | — |\n`,
    'AGENTS.md': 'x'.repeat(17 * 1024),
  });
  writeSala(dir, salaConfig([member('core', core.work)]));

  const m = JSON.parse(runSala(dir, ['revisar']).stdout).members[0];

  assert.equal(m.ok, false);
  const failing = m.requirements.filter((r) => r.ok === false);
  assert.deepEqual(failing.map(({ id, detail }) => ({ id, detail })), [
    { id: 'roadmap-header', detail: 'a la cabecera le faltan: **Qué sigue:**, **Qué lo bloquea:**' },
    { id: 'roadmap-states', detail: 'E2: «Lista» no es un estado' },
    { id: 'agents-size', detail: 'AGENTS.md tiene 17 KB; el máximo es 16 KB' },
    { id: 'member-block', detail: 'AGENTS.md no tiene el bloque del miembro' },
  ]);
  for (const r of failing) assert.equal(typeof r.fix, 'string');
});

test('a secret is reported by file, line and kind, and never printed', (t) => {
  const dir = tempDir(t);
  const core = memberRepo(dir, 'core');
  const token = 'ghp_abcdefghijklmnopqrstuvwxyz0123456789';
  const password = 'hunter2secret';
  const awsKey = 'AKIAABCDEFGHIJKLMNOP';
  pushFiles(core.work, {
    ...GOOD,
    'AGENTS.md': `# Reglas\n\nUsá ${token} para gh.\n\nClon: https://user:${password}@example.com/r.git\n`,
  });
  const config = salaConfig([member('core', core.work)]);
  config.options = { roomModel: awsKey };
  writeSala(dir, config);

  const res = runSala(dir, ['revisar']);
  const text = runSala(dir, ['revisar', '--texto']);

  for (const output of [res.stdout, res.stderr, text.stdout, text.stderr]) {
    for (const secret of [token, password, awsKey]) {
      assert.ok(!output.includes(secret), `secret leaked: ${output}`);
    }
  }
  const out = JSON.parse(res.stdout);
  assert.equal(out.salaJson.requirements[0].detail, 'clave de AWS en sala.json:14');
  const secrets = out.members[0].requirements.find((r) => r.id === 'no-secrets');
  assert.equal(secrets.ok, false);
  assert.equal(secrets.detail, 'token de GitHub en AGENTS.md:3; URL con usuario y clave en AGENTS.md:5');
});

test('a secret inside a roadmap cell is masked by its kind, never echoed', (t) => {
  const dir = tempDir(t);
  const core = memberRepo(dir, 'core');
  const token = 'ghp_A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8';
  const aws = 'AKIAIOSFODNN7EXAMPLE';
  pushFiles(core.work, {
    ...GOOD,
    'docs/ROADMAP.md': `${HEADER}\n${TABLE}\n| A1 | e | r | — | Pendiente ${token} | n | — |\n| ${aws} | e | r | — | Raro | n | — |\n`,
    'AGENTS.md': `# Reglas\n\n-----BEGIN PGP PRIVATE KEY BLOCK-----\nAWS_KEY=${aws}_prod\n`,
  });
  writeSala(dir, salaConfig([member('core', core.work)]));

  const res = runSala(dir, ['revisar']);
  const text = runSala(dir, ['revisar', '--texto']);

  for (const output of [res.stdout, res.stderr, text.stdout, text.stderr]) {
    assert.ok(!output.includes(token) && !output.includes(aws), `secret leaked: ${output}`);
  }
  const reqs = JSON.parse(res.stdout).members[0].requirements;
  assert.equal(reqs.find((r) => r.id === 'roadmap-states').detail,
    'A1: «Pendiente [token de GitHub]» no es un estado; [clave de AWS]: «Raro» no es un estado');
  assert.equal(reqs.find((r) => r.id === 'no-secrets').detail, 'clave privada en AGENTS.md:3; clave de AWS en AGENTS.md:4');
});

test('a base missing on the remote fails, and what needs it is left unchecked', (t) => {
  const dir = tempDir(t);
  const core = memberRepo(dir, 'core');
  writeSala(dir, salaConfig([member('core', core.work, { base: 'develop' })]));

  const m = JSON.parse(runSala(dir, ['revisar']).stdout).members[0];

  assert.equal(m.ok, false);
  assert.match(m.requirements[0].detail, /^no se pudo traer origin\/develop: /);
  assert.deepEqual(m.requirements.slice(1).map((r) => [r.ok, r.detail]), Array(6).fill(
    [null, 'sin comprobar: no se pudo leer origin/develop'],
  ));
});

test('sala revisar <miembro> checks only that member; an unknown one is an error', (t) => {
  const dir = tempDir(t);
  const core = memberRepo(dir, 'core');
  const brand = memberRepo(dir, 'brand');
  pushFiles(core.work, GOOD);
  writeSala(dir, salaConfig([member('core', core.work), member('brand', brand.work)]));

  const one = runSala(dir, ['revisar', 'core']);
  const none = runSala(dir, ['revisar', 'nadie']);
  const extra = runSala(dir, ['estado', 'core']);

  assert.deepEqual(JSON.parse(one.stdout).members.map((m) => m.id), ['core']);
  assert.equal(none.code, 1);
  assert.equal(none.stdout, '');
  assert.deepEqual(JSON.parse(none.stderr), { error: 'no hay un miembro «nadie» en sala.json' });
  assert.equal(extra.code, 1);
  assert.deepEqual(JSON.parse(extra.stderr), { error: 'argumento desconocido: core' });
});

test('--texto lists what fails with its order', (t) => {
  const dir = tempDir(t);
  const core = memberRepo(dir, 'core');
  pushFiles(core.work, { ...GOOD, 'AGENTS.md': BLOCK + 'x'.repeat(17 * 1024) });
  writeSala(dir, salaConfig([member('core', core.work)]));

  const res = runSala(dir, ['revisar', '--texto']);

  assert.equal(res.code, 0);
  assert.equal(res.stdout, [
    'Sala prueba',
    'sala.json: cumple 1/1',
    `Gentle Shell: probado con ${tested.gentleShell} (pi ${tested.pi}); instalado ${tested.gentleShell} (pi ${tested.pi})`,
    'core: cumple 6/7',
    '  agents-size: AGENTS.md tiene 17 KB; el máximo es 16 KB',
    '    orden: Recortá AGENTS.md por debajo de 16 KB: pasá a docs/ lo que no es una regla para agentes.',
    '',
  ].join('\n'));
});

// A live session in the feed of `agentDir` that publishes `schema`.
function liveSession(agentDir, cwd, schema) {
  const dir = path.join(agentDir, 'desktop', 'sessions');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 's1.json'), JSON.stringify({ schema, identity: { sessionId: 's1', cwd, pid: process.pid } }));
}

function contractSala(t) {
  const dir = tempDir(t);
  const core = memberRepo(dir, 'core');
  pushFiles(core.work, GOOD);
  writeSala(dir, salaConfig([member('core', core.work)]));
  return { dir, core, agentDir: path.join(dir, 'agent') };
}

test('with the tested Gentle Shell and feed, sala revisar shows the contract without warnings', (t) => {
  const { dir, core, agentDir } = contractSala(t);
  liveSession(agentDir, core.work, tested.feed);
  const env = { SALA_FEED_ROOTS: agentDir, FAKE_GENTLE_VERSION: tested.gentleShell, FAKE_PI_VERSION: tested.pi };

  const res = runSala(dir, ['revisar'], env);

  assert.equal(res.code, 0, res.stderr);
  assert.deepEqual(JSON.parse(res.stdout).kit.gentleShell, {
    tested: { gentleShell: tested.gentleShell, pi: tested.pi, feed: tested.feed },
    installed: { gentleShell: tested.gentleShell, pi: tested.pi },
    feeds: [tested.feed],
    warnings: [],
  });
  const text = runSala(dir, ['revisar', '--texto'], env).stdout;
  assert.ok(text.includes(`Gentle Shell: probado con ${tested.gentleShell} (pi ${tested.pi}); instalado ${tested.gentleShell} (pi ${tested.pi})\n`), text);
  assert.ok(!text.includes('aviso'), text);
});

test('another Gentle Shell version or feed format is a warning, never a failure', (t) => {
  const { dir, core, agentDir } = contractSala(t);
  liveSession(agentDir, core.work, 'gentle-shell.desktop-feed/v2');
  const env = { SALA_FEED_ROOTS: agentDir, FAKE_GENTLE_VERSION: '9.9.9', FAKE_PI_VERSION: tested.pi };

  const res = runSala(dir, ['revisar'], env);

  assert.equal(res.code, 0, res.stderr);
  const out = JSON.parse(res.stdout);
  assert.equal(out.members[0].ok, true);
  assert.deepEqual(out.kit.gentleShell.feeds, ['gentle-shell.desktop-feed/v2']);
  const warnings = [
    `instalado gentle-shell 9.9.9 (pi ${tested.pi}); el kit se probó con ${tested.gentleShell} (pi ${tested.pi}): revisá qué cambió en Gentle Shell y, si el kit sigue andando, anotá la versión en contrato/gentle-shell.json`,
    `una sesión viva publica gentle-shell.desktop-feed/v2; el kit se probó con ${tested.feed} y no lee otro formato`,
  ];
  assert.deepEqual(out.kit.gentleShell.warnings, warnings);
  const text = runSala(dir, ['revisar', '--texto'], env).stdout;
  for (const w of warnings) assert.ok(text.includes(`  aviso: ${w}\n`), text);
});

test('when gentle-shell --version cannot run, sala revisar says so and still passes', (t) => {
  const { dir } = contractSala(t);

  const res = runSala(dir, ['revisar'], { FAKE_GENTLE_VERSION: '' });

  assert.equal(res.code, 0, res.stderr);
  const contract = JSON.parse(res.stdout).kit.gentleShell;
  assert.equal(contract.installed, null);
  assert.deepEqual(contract.feeds, []);
  assert.deepEqual(contract.warnings, ['no se pudo leer la versión de Gentle Shell (gentle-shell --version): gentle-shell: no se encontró']);
});
