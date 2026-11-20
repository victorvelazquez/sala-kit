'use strict';

const fs = require('node:fs');
const path = require('node:path');

const SCHEMA = 1;
const TOP_KEYS = ['schema', 'kit', 'name', 'members', 'pinned', 'options'];
const MEMBER_KEYS = ['id', 'prefix', 'path', 'base', 'remote'];
const OPTION_KEYS = ['language', 'jira', 'transport', 'roomModel'];
const ID = /^[a-z0-9][a-z0-9-]*$/;
const PREFIX = /^[A-Z][A-Z0-9]*$/;
// A task of a member: its prefix, a dash and the row ID (CORE-E09).
const TASK = /^([A-Z][A-Z0-9]*)-(\S+)$/;
// A remote name, never a URL: a URL could carry credentials into the output.
const REMOTE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
// A branch name: it goes to git as an argument, so it never starts with `-`.
const BRANCH = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;

function isText(v) {
  return typeof v === 'string' && v.trim() !== '';
}

function unknownKeys(obj, allowed, where, errors) {
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) errors.push(`${where}${key}: campo desconocido`);
  }
}

function validateMember(m, i, seen, errors) {
  const at = `members[${i}]`;
  if (!m || typeof m !== 'object' || Array.isArray(m)) {
    errors.push(`${at}: debe ser un objeto`);
    return;
  }
  unknownKeys(m, MEMBER_KEYS, `${at}.`, errors);
  if (!isText(m.id)) errors.push(`${at}.id: falta`);
  else if (!ID.test(m.id)) errors.push(`${at}.id: solo minúsculas, dígitos y guiones`);
  else if (seen.ids.has(m.id)) errors.push(`${at}.id: «${m.id}» está repetido`);
  else seen.ids.add(m.id);
  if (!isText(m.prefix) || !PREFIX.test(m.prefix)) {
    errors.push(`${at}.prefix: debe ser mayúsculas y dígitos, por ejemplo CORE`);
  } else if (seen.prefixes.has(m.prefix)) errors.push(`${at}.prefix: «${m.prefix}» está repetido`);
  else seen.prefixes.add(m.prefix);
  if (!isText(m.path) || !path.isAbsolute(m.path)) errors.push(`${at}.path: debe ser una ruta absoluta`);
  if (!isText(m.base)) errors.push(`${at}.base: falta`);
  else if (!BRANCH.test(m.base) || m.base.includes('..') || m.base.endsWith('/')) {
    errors.push(`${at}.base: debe ser el nombre de una rama, por ejemplo main`);
  }
  if (m.remote !== undefined && (!isText(m.remote) || !REMOTE.test(m.remote))) {
    errors.push(`${at}.remote: debe ser el nombre de un remoto, por ejemplo origin, no una URL`);
  }
}

// Tasks the person puts ahead in the queue; the order of the list is their priority.
function validatePinned(pinned, prefixes, errors) {
  if (pinned === undefined) return;
  if (!Array.isArray(pinned)) {
    errors.push('pinned: debe ser una lista de IDs, por ejemplo ["CORE-E09"]');
    return;
  }
  const seen = new Set();
  pinned.forEach((id, i) => {
    const match = typeof id === 'string' ? TASK.exec(id) : null;
    if (!match) errors.push(`pinned[${i}]: debe ser un ID con el prefijo de un miembro, por ejemplo CORE-E09`);
    else if (!prefixes.has(match[1])) errors.push(`pinned[${i}]: no hay un miembro con el prefijo ${match[1]}`);
    else if (seen.has(id)) errors.push(`pinned[${i}]: «${id}» está repetido`);
    else seen.add(id);
  });
}

function validateOptions(o, errors) {
  if (o === undefined) return;
  if (!o || typeof o !== 'object' || Array.isArray(o)) {
    errors.push('options: debe ser un objeto');
    return;
  }
  unknownKeys(o, OPTION_KEYS, 'options.', errors);
  if (o.language !== undefined && !isText(o.language)) errors.push('options.language: debe ser texto');
  if (o.jira !== undefined && typeof o.jira !== 'boolean') errors.push('options.jira: debe ser true o false');
  if (o.transport !== undefined && !isText(o.transport)) errors.push('options.transport: debe ser texto');
  if (o.roomModel !== undefined && o.roomModel !== null && !isText(o.roomModel)) {
    errors.push('options.roomModel: debe ser texto o null');
  }
}

// Returns { errors, config }; config has defaults applied only when errors is empty.
function validateConfig(raw) {
  const errors = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { errors: ['sala.json debe ser un objeto'], config: null };
  }
  if (raw.schema !== SCHEMA) errors.push(`schema: se esperaba ${SCHEMA}`);
  unknownKeys(raw, TOP_KEYS, '', errors);
  if (!isText(raw.kit)) errors.push('kit: falta la versión del kit');
  if (!isText(raw.name)) errors.push('name: falta');
  if (!Array.isArray(raw.members) || raw.members.length === 0) {
    errors.push('members: tiene que haber al menos un miembro');
  } else {
    const seen = { ids: new Set(), prefixes: new Set() };
    raw.members.forEach((m, i) => validateMember(m, i, seen, errors));
    validatePinned(raw.pinned, seen.prefixes, errors);
  }
  validateOptions(raw.options, errors);
  if (errors.length) return { errors, config: null };
  const config = {
    ...raw,
    members: raw.members.map((m) => ({ ...m, remote: m.remote || 'origin' })),
    pinned: raw.pinned || [],
    options: { ...(raw.options || {}) },
  };
  return { errors, config };
}

class ConfigError extends Error {
  constructor(message, details) {
    super(message);
    this.details = details;
  }
}

function loadConfig(dir) {
  const file = path.join(dir, 'sala.json');
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    throw new ConfigError(`no hay sala.json en ${dir}`);
  }
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    throw new ConfigError('sala.json no es JSON válido', [err.message]);
  }
  const { errors, config } = validateConfig(raw);
  if (errors.length) throw new ConfigError('sala.json no es válido', errors);
  return config;
}

module.exports = { validateConfig, loadConfig, ConfigError };
