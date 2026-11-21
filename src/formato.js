'use strict';

// The commit and PR format of D23, checked by the kit before it calls the engine.
// The engine copy in engine/ is never edited: the subject rule comes from it.

const path = require('node:path');
const { pathToFileURL } = require('node:url');

const SOFT_LIMIT = 72;
// The task ID closes the title, in parentheses: `docs(guide): document theme H (M2c)`.
const TASK_ID = /^(.*\S) \(([A-Za-z0-9][A-Za-z0-9-]*)\)$/;
const JIRA_KEY = /\b[A-Z][A-Z0-9]+-\d+\b/;
const SECTIONS = {
  en: { sections: ['Summary', 'Changes', 'Validation', 'Risks', 'Out of scope'], notRun: 'Not run' },
  es: { sections: ['Resumen', 'Cambios', 'Validación', 'Riesgos', 'Fuera de alcance'], notRun: 'No se corrió' },
};
const BAD_SUBJECT = 'el título debe ser tipo(ámbito)!: resultado, por ejemplo docs(guide): document theme H (M2c)';
const NO_ID = 'el título debe terminar con el ID de la tarea entre paréntesis, por ejemplo (M2c)';

const DRAFTING = path.join(__dirname, '..', 'engine', 'scripts', 'lib', 'flow-pr-drafting.mjs');
let drafting;

function loadDrafting() {
  drafting = drafting || import(pathToFileURL(DRAFTING).href);
  return drafting;
}

// Checks a PR title with the engine's commit rule plus the task ID, the soft limit and Jira.
// `id` is the expected task ID; without it, any ID passes.
async function checkTitle(title, options) {
  const { id = null, jira = false } = options || {};
  const { parseConventionalSubject, MAX_COMMIT_SUBJECT_BYTES } = await loadDrafting();
  const text = typeof title === 'string' ? title : '';
  const errors = [];
  const warnings = [];
  const withId = TASK_ID.exec(text);
  const rest = withId ? withId[1] : text;
  // The engine refuses a subject over its limit, and a squash makes the whole title the
  // subject; say why instead of a format error.
  if (Buffer.byteLength(text) > MAX_COMMIT_SUBJECT_BYTES) {
    return { ok: false, errors: [`el título pasa de ${MAX_COMMIT_SUBJECT_BYTES} bytes`], warnings, title: null };
  }
  const subject = parseConventionalSubject(rest);
  if (!subject) errors.push(BAD_SUBJECT);
  if (!withId) errors.push(NO_ID);
  else if (id !== null && withId[2] !== id) errors.push(`el título termina con (${withId[2]}), pero la tarea es ${id}`);
  if (jira && !JIRA_KEY.test(rest)) {
    errors.push('con options.jira el título debe llevar una clave de Jira, por ejemplo ABC-123');
  }
  if (text.length > SOFT_LIMIT) warnings.push(`el título tiene ${text.length} caracteres; conviene no pasar de ${SOFT_LIMIT}`);
  if (errors.length) return { ok: false, errors, warnings, title: null };
  const { type, scope, breaking, outcome } = subject;
  return { ok: true, errors, warnings, title: { type, scope, breaking, outcome, id: withId[2] } };
}

// The PR format a room asks for, from the `options` of sala.json.
function prFormat(options) {
  options = options || {};
  const language = options.language || 'en';
  if (!Object.hasOwn(SECTIONS, language)) throw new Error(`idioma desconocido: ${language}`);
  return { language, jira: options.jira === true, softLimit: SOFT_LIMIT, ...SECTIONS[language] };
}

module.exports = { checkTitle, prFormat };
