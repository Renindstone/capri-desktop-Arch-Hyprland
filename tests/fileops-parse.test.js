'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

// chat.js is a page module (util.js asks matchMedia as it loads): only its pure part, fileAsk, is used here
globalThis.matchMedia ??= () => ({ matches: false });
const loadRaw = () => import(pathToFileURL(path.join(__dirname, '../src/renderer/js/chat.js')).href);
// the splits from your words as trimmed ("este zip", "la carpeta de" gone): the untrimmed ones are tried first, marked raw
const clean = (ask) => ask && { op: ask.op, splits: ask.splits.filter((s) => !s.raw) };
const load = async () => {
  const m = await loadRaw();
  return { ...m, fileAsk: (t) => clean(m.fileAsk(t)) };
};

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
  assert.deepEqual(fileAsk('mueve viaje a roma.mp4 a la carpeta comercio').splits.map((s) => [s.sources, s.target]),
    [[['viaje a roma.mp4'], 'comercio'], [['viaje'], 'roma.mp4 a la carpeta comercio']]);
  // without a word about files, a split whose files don't look like files isn't one
  assert.deepEqual(fileAsk('mueve viaje a roma.mp4 a comercio').splits.map((s) => [s.sources, s.target]), [[['viaje a roma.mp4'], 'comercio']]);
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

test('her file lines, in every language, with every op and every refusal', async () => {
  const { LINES } = await import(pathToFileURL(path.join(__dirname, '../src/renderer/js/lines.js')).href);
  const ops = ['extract', 'compress', 'move', 'copy', 'rename', 'trash', 'mkdir'];
  const errors = ['missing', 'outside', 'exists', 'notFolder', 'inside', 'unclear', 'expired', 'noTool', 'noArchive', 'manyArchives'];
  for (const [lang, lines] of Object.entries(LINES)) {
    const f = lines.chat.fileop;
    assert.ok(f, lang);
    for (const k of ['plan', 'planHere', 'many', 'doIt', 'doTo', 'done', 'trashed', 'failed', 'hint']) assert.equal(typeof f[k], 'string', `${lang} ${k}`);
    assert.deepEqual(Object.keys(f.verbs).sort(), [...ops].sort(), lang);
    assert.deepEqual(Object.keys(f.errors).sort(), [...errors].sort(), lang);
    assert.match(f.plan, /\{verb\}.*\{what\}.*\{to\}/, lang);
    assert.match(f.done, /\{path\}/, lang);
  }
});

const includes = (ask, split) => (ask?.splits || []).some(({ raw, ...s }) => JSON.stringify(s) === JSON.stringify(split));

test('review: ordinary sentences are not file requests', async () => {
  const { fileAsk } = await loadRaw();
  for (const t of ['Move the meeting to Friday', 'mueve la reunión al viernes', 'pasa la pelota a juan', 'copia este texto en inglés',
    'move on to the next topic', 'zip your lips', 'pasa esta canción a la siguiente']) assert.equal(fileAsk(t), null, t);
});

test('review: " y " inside a name gets its own split', async () => {
  const { fileAsk } = await loadRaw();
  assert.ok(includes(fileAsk('mueve tom y jerry.mp4 a comercio'), { sources: ['tom y jerry.mp4'], target: 'comercio' }));
});

test('review: the untrimmed name comes first, then the trimmed one', async () => {
  const { fileAsk } = await loadRaw();
  const s = fileAsk('borra fotos de verano.zip').splits.map((x) => x.sources);
  assert.deepEqual(s, [['fotos de verano.zip'], ['verano.zip']]);
});

test('review: a new folder keeps its whole name, and " en " splits it cleanly', async () => {
  const { fileAsk } = await loadRaw();
  assert.deepEqual(fileAsk('crea una carpeta llamada Fotos de viaje').splits.map(({ raw, ...s }) => s), [{ sources: [], target: null, name: 'Fotos de viaje' }]);
  assert.equal(fileAsk('crea la carpeta Las Vegas').splits[0].name, 'Las Vegas');
  assert.equal(fileAsk('haz una carpeta llamada Fotos en documentos').splits.length, 1);
});
