'use strict';

// The old blocks of a member (D52): we wrote panel:tareas, panel:entrega and orquestacion:ciclo
// before the sala existed, so the kit carries their compatible version and sala unirse puts it
// between their marks. Outside the marks not a byte changes.

const fs = require('node:fs');
const path = require('node:path');

const TEMPLATES = path.join(__dirname, '..', 'templates', 'bloques');

const CATALOG = [
  { name: 'panel:tareas', version: 'v1.4', file: 'panel-tareas.md' },
  { name: 'panel:entrega', version: 'v1.1', file: 'panel-entrega.md' },
  { name: 'orquestacion:ciclo', version: 'v1.1', file: 'orquestacion-ciclo.md' },
];

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function compatible(block) {
  const body = fs.readFileSync(path.join(TEMPLATES, block.file), 'utf8');
  return `<!-- ${block.name} ${block.version} -->\n${body}<!-- /${block.name} -->`;
}

// One region per block: { start, end, eol, version } around both marks, null when the block is
// absent, or { broken: true } when its marks repeat, miss their pair or come in the wrong order.
// eol is the line end of the start mark's line: the new text takes it, and nothing else changes.
function region(text, start, end) {
  const starts = [...text.matchAll(start)];
  const ends = [...text.matchAll(end)];
  if (starts.length === 0 && ends.length === 0) return null;
  if (starts.length !== 1 || ends.length !== 1 || ends[0].index < starts[0].index) return { broken: true };
  const after = starts[0].index + starts[0][0].length;
  const eol = text.startsWith('\r\n', after) ? '\r\n' : '\n';
  return { start: starts[0].index, end: ends[0].index + ends[0][0].length, eol, version: starts[0][1] || null };
}

const withEol = (s, eol) => (eol === '\n' ? s : s.replace(/\n/g, eol));

// v1.4 -> [1, 4]; compares versions of a block, so a newer one is never downgraded.
function newer(found, ours) {
  const parse = (v) => v.replace(/^v/, '').split('.').map((n) => Number.parseInt(n, 10) || 0);
  const [a, b] = [parse(found), parse(ours)];
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0);
  }
  return false;
}

// Where each block of the catalog is in the text, with the version its start mark carries.
function scan(text) {
  return CATALOG.map((b) => ({
    ...b,
    found: region(text, new RegExp(`<!-- ${escape(b.name)} (v[^\\s>]+) -->`, 'g'), new RegExp(`<!-- /${escape(b.name)} -->`, 'g')),
  }));
}

// The first block that starts inside another: it would be written twice.
function nestedBlock(blocks) {
  const present = blocks.filter((b) => b.found).sort((a, b) => a.found.start - b.found.start);
  return present.find((b, i) => i > 0 && b.found.start < present[i - 1].found.end) || null;
}

// The member block, up to its end mark: the line end after it stays as it was.
function memberRegion(text, [startMark, endMark]) {
  return region(text, new RegExp(escape(startMark), 'g'), new RegExp(escape(endMark), 'g'));
}

// What sala revisar needs (D52): the first block with broken or nested marks (also inside the
// member block, as sala unirse sees it), the blocks older than the kit's and the newer ones.
// Only versions are compared: the text inside belongs to the kit.
function blockVersions(text, memberMarks = null) {
  const blocks = text === null ? [] : scan(text);
  const member = text !== null && memberMarks ? memberRegion(text, memberMarks) : null;
  const all = member && !member.broken ? [...blocks, { name: 'miembro', found: member }] : blocks;
  const broken = blocks.find((b) => b.found && b.found.broken) || nestedBlock(all);
  const present = blocks.filter((b) => b.found && !b.found.broken);
  return {
    broken: broken ? broken.name : null,
    stale: present.filter((b) => b.found.version !== b.version && !newer(b.found.version, b.version))
      .map((b) => ({ name: b.name, version: b.found.version, kit: b.version })),
    newer: present.filter((b) => newer(b.found.version, b.version)).map((b) => ({ name: b.name, version: b.found.version, kit: b.version })),
  };
}

// The new AGENTS.md text, with the blocks of the catalog and the member block up to date.
// Returns { text, updated, warnings } or { broken: name }. Only the text between marks is
// replaced; a block newer than the kit's is left alone with a warning.
function upgradeAgents(text, memberBlock, memberMarks) {
  const blocks = scan(text).map((b) => ({ ...b, want: compatible(b) }));
  const member = {
    name: 'miembro',
    found: memberRegion(text, memberMarks),
    want: memberBlock.replace(/\n$/, ''),
  };
  const broken = [...blocks, member].find((b) => b.found && b.found.broken);
  if (broken) return { broken: broken.name };
  const warnings = [];
  for (const b of blocks) {
    if (b.found && newer(b.found.version, b.version)) {
      warnings.push(`AGENTS.md tiene ${b.name} ${b.found.version}, más nuevo que el ${b.version} del kit: no se tocó`);
      b.keep = true;
    }
  }
  const nested = nestedBlock([...blocks, member]);
  if (nested) return { broken: nested.name };
  const present = [...blocks, member].filter((b) => b.found).sort((a, b) => a.found.start - b.found.start);

  let out = text;
  const updated = [];
  // From the end backwards, so the earlier positions stay valid.
  present.reverse();
  for (const b of present) {
    const want = withEol(b.want, b.found.eol);
    if (b.keep || out.slice(b.found.start, b.found.end) === want) continue;
    out = out.slice(0, b.found.start) + want + out.slice(b.found.end);
    updated.push(b.name);
  }
  if (!member.found) {
    // The appended block takes the line end of the file's last line.
    const last = out.lastIndexOf('\n');
    const eol = last > 0 && out[last - 1] === '\r' ? '\r\n' : '\n';
    const sep = out === '' || out.endsWith(eol + eol) ? '' : out.endsWith(eol) ? eol : eol + eol;
    out = `${out}${sep}${withEol(memberBlock, eol)}`;
    updated.push('miembro');
  }
  const order = [...CATALOG.map((b) => b.name), 'miembro'];
  updated.sort((a, b) => order.indexOf(a) - order.indexOf(b));
  return { text: out, updated, warnings };
}

module.exports = { CATALOG, upgradeAgents, blockVersions };
