'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { tempDir, git, memberRepo, writeSala, salaConfig, runSala, runAsync, feedSala } = require('./helpers');

const START = '<!-- sala-kit:miembro:inicio -->';
const END = '<!-- sala-kit:miembro:fin -->';
const HEADER = '**Dónde está:** algo.\n**Qué sigue:** algo.\n**Qué lo bloquea:** nada.\n';
const TABLE = '| ID | Entrega | Resultado visible | Depende de | Estado | Notas | Ficha |\n| --- | --- | --- | --- | --- | --- | --- |\n| E1 | Una | Se ve | — | Pendiente |  | — |\n';

function read(dir, file) {
  return fs.readFileSync(path.join(dir, file), 'utf8');
}

function pushFiles(work, files) {
  for (const [file, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(work, file)), { recursive: true });
    fs.writeFileSync(path.join(work, file), content);
    git(work, 'add', file);
  }
  git(work, 'commit', '--quiet', '-m', 'files');
  git(work, 'push', '--quiet', 'origin', 'main');
}

// A room made by `sala init`, plus an extra field that adoptar must keep.
function room(t) {
  const dir = tempDir(t);
  const sala = path.join(dir, 'sala');
  assert.equal(runSala(dir, ['init', '--sala', sala]).code, 0);
  const config = JSON.parse(read(sala, 'sala.json'));
  writeSala(sala, { ...config, options: { roomModel: 'barato' } });
  return { dir, sala };
}

// What a member looks like after `git clone`: origin/HEAD names its default branch.
function clonedRepo(root, name, base = 'main') {
  const repo = memberRepo(root, name, base);
  git(repo.work, 'remote', 'set-head', 'origin', '-a');
  return repo;
}

function untouched(work) {
  return { status: git(work, 'status', '--porcelain', '--ignored'), files: fs.readdirSync(work).sort() };
}

test('sala adoptar adds the repo to sala.json, deducing its data, and never writes in the member', (t) => {
  const { dir, sala } = room(t);
  const core = clonedRepo(dir, 'Upen_Core', 'main');
  const before = untouched(core.work);
  const old = read(sala, 'sala.json');

  const res = runSala(sala, ['adoptar', core.work]);

  assert.equal(res.code, 0, res.stderr);
  assert.equal(res.stderr, '');
  const out = JSON.parse(res.stdout);
  const added = { id: 'upen-core', prefix: 'UPENCORE', path: core.work, base: 'main', remote: 'origin' };
  assert.deepEqual(out.member, added);
  assert.deepEqual(out.warnings, ['upen-core: no tiene el bloque del miembro en AGENTS.md; `sala condiciones upen-core` le manda la orden de ponerse en condiciones']);
  const config = JSON.parse(read(sala, 'sala.json'));
  assert.deepEqual(config, { ...JSON.parse(old), members: [added] });
  assert.deepEqual(untouched(core.work), before);

  // The flags win over what it deduces, and the new member goes last.
  const web = memberRepo(dir, 'web', 'develop');
  git(web.work, 'remote', 'rename', 'origin', 'up');
  const second = runSala(sala, ['adoptar', web.work, '--id', 'front', '--prefijo', 'FE', '--base', 'develop', '--remoto', 'up']);
  assert.equal(second.code, 0, second.stderr);
  const members = JSON.parse(read(sala, 'sala.json')).members;
  assert.deepEqual(members.map((m) => [m.id, m.prefix, m.base, m.remote]), [['upen-core', 'UPENCORE', 'main', 'origin'], ['front', 'FE', 'develop', 'up']]);
  assert.equal(runSala(sala, ['plan']).code, 0, 'the room still loads');
});

test('sala adoptar refuses what is not a repo to adopt, and leaves sala.json as it was', (t) => {
  const { dir, sala } = room(t);
  const core = clonedRepo(dir, 'core');
  const plain = path.join(dir, 'plain');
  fs.mkdirSync(plain);
  fs.mkdirSync(path.join(core.work, 'sub'));
  const noHead = memberRepo(dir, 'nohead');
  const digits = clonedRepo(dir, '123');
  const other = path.join(dir, 'otra-sala');
  assert.equal(runSala(dir, ['init', '--sala', other]).code, 0);
  git(dir, 'init', '--quiet', other);
  assert.equal(runSala(sala, ['adoptar', core.work]).code, 0);
  const before = read(sala, 'sala.json');

  const cases = [
    [[path.join(dir, 'no-existe')], /^la carpeta no existe: /],
    [[plain], /no es un repositorio de git/],
    [[path.join(core.work, 'sub')], /no es la raíz de su repositorio/],
    [[sala], /es la carpeta de la sala/],
    [[other], /es una sala, no un repositorio para adoptar/],
    [[core.work], /^ya es un miembro: core$/],
    [[core.work, '--id', 'otro', '--prefijo', 'OTRO'], /^ya es un miembro: core$/],
    [[noHead.work], /no se pudo deducir la base de origin; usá --base <rama>/],
    [[noHead.work, '--base', 'main', '--remoto', 'falta'], /el repositorio no tiene el remoto falta/],
    [[digits.work], /no se pudo deducir el prefijo; usá --prefijo/],
    [[noHead.work, '--base', 'main', '--id', 'core'], /members\[1\]\.id: «core» está repetido/],
    [[noHead.work, '--base', '-x'], /members\[1\]\.base: debe ser el nombre de una rama/],
  ];
  for (const [args, message] of cases) {
    const res = runSala(sala, ['adoptar', ...args]);
    assert.equal(res.code, 1, `${args.join(' ')}: ${res.stdout}`);
    assert.equal(res.stdout, '');
    assert.match(JSON.parse(res.stderr).error + (JSON.parse(res.stderr).details || []).join(';'), message);
    assert.equal(read(sala, 'sala.json'), before, args.join(' '));
  }
  assert.equal(runSala(sala, ['adoptar']).code, 1, 'it needs a folder');
});

test('a member with old blocks is adopted with a warning (D52)', (t) => {
  const { dir, sala } = room(t);
  const core = clonedRepo(dir, 'core');
  pushFiles(core.work, { 'AGENTS.md': `# Reglas\n\n<!-- panel:entrega v1.0 -->\nSolo /flow-*.\n<!-- /panel:entrega -->\n${START}\nx\n${END}\n` });

  const res = runSala(sala, ['adoptar', core.work]);

  assert.equal(res.code, 0, res.stderr);
  assert.deepEqual(JSON.parse(res.stdout).warnings, [
    'core: el bloque del miembro no nombra su sala; `sala condiciones core` le manda la orden de ponerse al día',
    'core: AGENTS.md tiene bloques viejos: panel:entrega v1.0 (el kit trae v1.1); `sala condiciones core` le manda la orden de ponerse al día',
  ]);
});

test('sala soltar takes the member and its pinned tasks out of sala.json, without touching the repo', (t) => {
  const { dir, sala } = room(t);
  const core = clonedRepo(dir, 'core');
  const web = clonedRepo(dir, 'web');
  assert.equal(runSala(sala, ['adoptar', core.work]).code, 0);
  assert.equal(runSala(sala, ['adoptar', web.work]).code, 0);
  const config = JSON.parse(read(sala, 'sala.json'));
  writeSala(sala, { ...config, pinned: ['WEB-E2', 'CORE-E1', 'WEB-E1'] });
  const before = untouched(web.work);

  const res = runSala(sala, ['soltar', 'web']);

  assert.equal(res.code, 0, res.stderr);
  assert.deepEqual(JSON.parse(res.stdout), { member: 'web', path: web.work, unpinned: ['WEB-E2', 'WEB-E1'] });
  const after = JSON.parse(read(sala, 'sala.json'));
  assert.deepEqual(after, { ...config, members: config.members.slice(0, 1), pinned: ['CORE-E1'] });
  assert.deepEqual(untouched(web.work), before);
  assert.ok(fs.existsSync(web.work));

  const unknown = runSala(sala, ['soltar', 'web']);
  assert.equal(unknown.code, 1);
  assert.match(JSON.parse(unknown.stderr).error, /^no hay un miembro web en sala\.json$/);
  assert.deepEqual(JSON.parse(read(sala, 'sala.json')), after);
});

test('sala unirse puts the member block in AGENTS.md, adding it after the own rules (D41, D52)', (t) => {
  const dir = tempDir(t);
  const fresh = path.join(dir, 'fresh');
  fs.mkdirSync(fresh);

  const res = runSala(fresh, ['unirse', '--de', 'prueba']);
  assert.equal(res.code, 0, res.stderr);
  assert.deepEqual(JSON.parse(res.stdout), { dir: fresh, created: ['AGENTS.md'], updated: [], skipped: [], warnings: [] });
  const agents = read(fresh, 'AGENTS.md');
  assert.ok(agents.indexOf(START) < agents.indexOf(END) && agents.indexOf(START) > 0);
  assert.equal(JSON.parse(runSala(fresh, ['donde']).stdout).kind, 'miembro');

  const again = JSON.parse(runSala(fresh, ['unirse', '--de', 'prueba']).stdout);
  assert.deepEqual(again.skipped, [{ file: 'AGENTS.md', reason: 'ya tiene el bloque del miembro y los bloques al día' }]);
  assert.equal(read(fresh, 'AGENTS.md'), agents);

  const own = path.join(dir, 'own');
  fs.mkdirSync(own);
  fs.writeFileSync(path.join(own, 'AGENTS.md'), '# Reglas\n\n- Nunca abras un PR.\n');
  const out = JSON.parse(runSala(own, ['unirse', '--de', 'prueba']).stdout);
  assert.deepEqual(out, { dir: own, created: [], updated: ['miembro'], skipped: [], warnings: [] });
  assert.equal(read(own, 'AGENTS.md'), `# Reglas\n\n- Nunca abras un PR.\n\n${agents.slice(agents.indexOf(START))}`);
  assert.deepEqual(fs.readdirSync(own), ['AGENTS.md']);

  const half = path.join(dir, 'half');
  fs.mkdirSync(half);
  fs.writeFileSync(path.join(half, 'AGENTS.md'), `# Reglas\n${START}\nsin fin\n`);
  const broken = runSala(half, ['unirse', '--de', 'prueba']);
  assert.equal(broken.code, 1);
  assert.match(JSON.parse(broken.stderr).error, /marcas del bloque del miembro repetidas, sin cerrar o al revés/);
  assert.deepEqual(fs.readdirSync(half), ['AGENTS.md']);

  const sala = path.join(dir, 'sala');
  assert.equal(runSala(dir, ['init', '--sala', sala]).code, 0);
  const saved = read(sala, 'AGENTS.md');
  const refused = runSala(sala, ['unirse', '--de', 'prueba']);
  assert.equal(refused.code, 1);
  assert.match(JSON.parse(refused.stderr).error, /es una sala: unirse no la convierte en miembro/);
  assert.equal(read(sala, 'AGENTS.md'), saved);
});

test('sala revisar checks the member block and requires no old blocks (D52)', (t) => {
  const dir = tempDir(t);
  const block = (name, version, body = 'x') => `<!-- ${name} ${version} -->\n${body}\n<!-- /${name} -->\n`;
  const agents = {
    core: `# Reglas\n\n${START}\n<!-- sala-kit:sala=prueba -->\nbloque\n${END}\n`,
    web: `# Reglas\n${block('panel:entrega', 'v1.0')}${block('orquestacion:ciclo', 'v1.0')}`,
    api: `# Reglas\n${block('panel:tareas', 'v2.0')}${block('panel:entrega', 'v1.1', 'editado')}${START}\n<!-- sala-kit:sala=prueba -->\nb\n${END}\n`,
    bad: `# Reglas\n<!-- panel:tareas v1.3 -->\nsin fin\n${START}\n<!-- sala-kit:sala=prueba -->\nb\n${END}\n`,
  };
  const repos = Object.keys(agents).map((id) => {
    const repo = memberRepo(dir, id);
    pushFiles(repo.work, { 'docs/ROADMAP.md': `${HEADER}\n${TABLE}`, 'AGENTS.md': agents[id] });
    return { id, prefix: id.toUpperCase(), path: repo.work, base: 'main' };
  });
  writeSala(dir, salaConfig(repos));

  const out = JSON.parse(runSala(dir, ['revisar']).stdout);

  const [c, w, a, b] = out.members;
  const req = (m, id) => m.requirements.find((r) => r.id === id);
  assert.equal(c.ok, true);
  assert.deepEqual(c.warnings, []);
  assert.deepEqual(req(c, 'member-block'), { id: 'member-block', ok: true, detail: 'AGENTS.md tiene el bloque del miembro de la sala prueba', fix: null });
  assert.deepEqual(req(c, 'old-blocks'), { id: 'old-blocks', ok: true, detail: 'AGENTS.md no tiene bloques viejos', fix: null });
  assert.equal(req(w, 'member-block').ok, false);
  assert.equal(req(w, 'member-block').detail, 'AGENTS.md no tiene el bloque del miembro');
  assert.match(req(w, 'member-block').fix, /sala unirse/);
  assert.equal(req(w, 'old-blocks').ok, false);
  assert.equal(req(w, 'old-blocks').detail, 'AGENTS.md tiene bloques viejos: panel:entrega v1.0 (el kit trae v1.1), orquestacion:ciclo v1.0 (el kit trae v1.1)');
  assert.match(req(w, 'old-blocks').fix, /sala unirse/);
  assert.deepEqual(w.warnings, []);
  // A block newer than the kit's, or current with an edited body, meets it; the newer one warns.
  assert.equal(a.ok, true);
  assert.equal(req(a, 'old-blocks').ok, true);
  assert.deepEqual(a.warnings, ['AGENTS.md tiene panel:tareas v2.0, más nuevo que el v1.4 del kit']);
  assert.equal(req(b, 'old-blocks').ok, false);
  assert.equal(req(b, 'old-blocks').detail, 'AGENTS.md tiene las marcas del bloque panel:tareas repetidas, sin cerrar o al revés');
  const texto = runSala(dir, ['revisar', '--texto']).stdout;
  assert.ok(texto.includes('  aviso: AGENTS.md tiene panel:tareas v2.0, más nuevo que el v1.4 del kit'));
});

// A room whose members core and web are real repos with a live session each.
function condicionesSala(t) {
  const s = feedSala(t);
  for (const name of ['core', 'web']) {
    fs.rmdirSync(path.join(s.dir, name));
    memberRepo(s.dir, name);
  }
  return s;
}

test('sala condiciones sends the member the order to meet what fails, and only that', async (t) => {
  const s = condicionesSala(t);
  pushFiles(s.core, { 'docs/ROADMAP.md': `${HEADER}\n${TABLE}`, 'AGENTS.md': '# Reglas\n<!-- panel:entrega v1.0 -->\nSolo /flow-*.\n<!-- /panel:entrega -->\n' });
  pushFiles(s.web, { 'docs/ROADMAP.md': `${HEADER}\n${TABLE}`, 'AGENTS.md': `# Reglas\n${START}\n<!-- sala-kit:sala=prueba -->\nb\n${END}\n` });
  s.session('c1', s.core);
  s.session('w1', s.web);
  const seen = s.answer('c1');
  const seenWeb = s.answer('w1');

  const res = await runAsync(s.dir, ['condiciones', 'core'], s.env);

  assert.equal(res.code, 0, res.stderr);
  assert.deepEqual(JSON.parse(res.stdout), { member: 'core', failing: ['member-block', 'old-blocks'], sent: true, session: 'id-c1' });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].kind, 'send_prompt');
  const text = seen[0].args.text;
  assert.match(text, /^Ponete en condiciones para la sala/);
  assert.match(text, /member-block: AGENTS\.md no tiene el bloque del miembro/);
  assert.ok(text.includes('- old-blocks: AGENTS.md tiene bloques viejos: panel:entrega v1.0 (el kit trae v1.1). '), text);
  assert.match(text, /sala unirse/);
  assert.ok(!/roadmap-table|agents-size|no-secrets/.test(text), 'what passes is not in the order');
  assert.deepEqual(s.log().map((l) => l.result), ['sending', 'sent']);

  // A member that meets everything gets no order.
  const ok = await runAsync(s.dir, ['condiciones', 'web'], s.env);
  assert.equal(ok.code, 0, ok.stderr);
  assert.deepEqual(JSON.parse(ok.stdout), { member: 'web', failing: [], sent: false, session: null });
  assert.equal(seenWeb.length, 0);
});

test('sala condiciones refuses, sending nothing, when the base fails or a guard of sala enviar does not hold', async (t) => {
  const s = condicionesSala(t);
  s.session('c1', s.core);
  s.session('w1', s.web);
  // web's base does not exist on its remote: that is for the sala to fix, not the member.
  const config = JSON.parse(read(s.dir, 'sala.json'));
  config.members[1].base = 'develop';
  writeSala(s.dir, config);

  const base = await runAsync(s.dir, ['condiciones', 'web'], s.env);
  assert.equal(base.code, 1);
  assert.match(JSON.parse(base.stderr).error, /^web: primero corregí la base y el remoto en sala\.json: no se pudo traer origin\/develop/);

  fs.mkdirSync(path.join(s.dir, '.sala'), { recursive: true });
  fs.writeFileSync(path.join(s.dir, '.sala', 'PAUSA'), '');
  const paused = await runAsync(s.dir, ['condiciones', 'core'], s.env);
  assert.equal(paused.code, 1);
  assert.match(JSON.parse(paused.stderr).error, /la sala está en pausa/);

  assert.deepEqual(s.inbox('c1'), []);
  assert.deepEqual(s.inbox('w1'), []);
  assert.deepEqual(s.log().map((l) => [l.member, l.result]), [['core', 'refused']]);
});

test('the adoptar flags belong to adoptar only', (t) => {
  const dir = tempDir(t);
  writeSala(dir, salaConfig([]));
  const res = runSala(dir, ['revisar', '--base', 'main']);
  assert.equal(res.code, 1);
  assert.deepEqual(JSON.parse(res.stderr), { error: 'argumento desconocido: --base' });
});
