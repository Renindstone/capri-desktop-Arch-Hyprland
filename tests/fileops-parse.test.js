'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

// chat.js is a page module (util.js asks matchMedia as it loads): only its pure part, fileAsk, is used here
globalThis.matchMedia ??= () => ({ matches: false });
const load = () => import(pathToFileURL(path.join(__dirname, '../src/renderer/js/chat.js')).href);

test('the user\'s three phrases', async () => {
  const { fileAsk } = await load();
  assert.deepEqual(fileAsk('Extrae este zip descargas/juego.zip por mi capri'),
    { op: 'extract', splits: [{ sources: ['descargas/juego.zip'], target: null }] });
  assert.deepEqual(fileAsk('Mueve estos archivos a.png, b.png a la carpeta de comercio').splits[0],
    { sources: ['a.png', 'b.png'], target: 'comercio' });
  assert.deepEqual(fileAsk('Elimina este video descargas/pepito.mp4'),
    { op: 'trash', splits: [{ sources: ['descargas/pepito.mp4'], target: null }] });
});

test('every op, Spanish and English', async () => {
  const { fileAsk } = await load();
  assert.equal(fileAsk('descomprime x.rar en descargas').splits[0].target, 'descargas');
  assert.deepEqual(fileAsk('comprime fotos y videos').splits[0], { sources: ['fotos', 'videos'], target: null });
  assert.equal(fileAsk('copia informe.pdf en documentos').op, 'copy');
  assert.equal(fileAsk('pasa x.png a la carpeta comercio').op, 'move');
  assert.deepEqual(fileAsk('cambia el nombre de a.txt a b.txt').splits[0], { sources: ['a.txt'], target: null, name: 'b.txt' });
  assert.deepEqual(fileAsk('renombra a.txt como b.txt').splits[0], { sources: ['a.txt'], target: null, name: 'b.txt' });
  assert.equal(fileAsk('borra x.mp4').op, 'trash');
  assert.deepEqual(fileAsk('manda x.mp4 a la papelera'), { op: 'trash', splits: [{ sources: ['x.mp4'], target: null }] });
  assert.deepEqual(fileAsk('crea una carpeta llamada Comercio en documentos').splits[0], { sources: [], target: 'documentos', name: 'Comercio' });
  assert.deepEqual(fileAsk('crea la carpeta Comercio').splits[0], { sources: [], target: null, name: 'Comercio' });
  assert.equal(fileAsk('move a.png to downloads').op, 'move');
  assert.equal(fileAsk('delete a.png').op, 'trash');
  assert.equal(fileAsk('unzip game.zip').op, 'extract');
  assert.deepEqual(fileAsk('rename a.txt to b.txt').splits[0], { sources: ['a.txt'], target: null, name: 'b.txt' });
});

test('" a " inside a name: every split, last separator first', async () => {
  const { fileAsk } = await load();
  assert.deepEqual(fileAsk('mueve viaje a roma.mp4 a comercio').splits.map((s) => [s.sources, s.target]),
    [[['viaje a roma.mp4'], 'comercio'], [['viaje'], 'roma.mp4 a comercio']]);
});

test('quotes, politeness, punctuation', async () => {
  const { fileAsk } = await load();
  assert.deepEqual(fileAsk('Capri, mueve "a b.png" a comercio por favor.').splits[0], { sources: ['a b.png'], target: 'comercio' });
  assert.deepEqual(fileAsk('copia ~/x.txt a /home/u/y, porfa!').splits[0], { sources: ['~/x.txt'], target: '/home/u/y' });
});

test('not a file request', async () => {
  const { fileAsk } = await load();
  for (const t of ['mueve el cuerpo', 'copia esto', 'borra eso', 'abre spotify', 'cuéntame un chiste', 'pasa a verme']) assert.equal(fileAsk(t), null, t);
});
