'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseRoadmap } = require('../src/roadmap');

test('the rows of the Orquestación table are read with their dependencies', () => {
  const text = [
    '# Hoja de ruta',
    '',
    '**Dónde está:** algo.',
    '',
    '| ID | Entrega | Resultado visible | Depende de | Estado | Notas | Ficha |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    '| E1 | Primera | Se ve | — | Completada | Hecha | — |',
    '| E2 | Usa `a \\| b` | Se ve | E1, upen-ceo | Pendiente |  | docs/tareas/E2.md |',
    '',
    'Texto después de la tabla.',
  ].join('\n');

  assert.deepEqual(parseRoadmap(text), {
    rows: [
      { id: 'E1', entrega: 'Primera', deps: [], estado: 'Completada', notas: 'Hecha' },
      { id: 'E2', entrega: 'Usa `a | b`', deps: ['E1', 'upen-ceo'], estado: 'Pendiente', notas: '' },
    ],
  });
});

test('a roadmap without the table says so', () => {
  assert.deepEqual(parseRoadmap('# Hoja de ruta\n\nNada.\n'), {
    error: 'docs/ROADMAP.md no tiene la tabla con las columnas ID, Entrega, Depende de y Estado',
  });
});
