'use strict';

// When her system handled what you asked, she says what really happened: the model, which can't know,
// doesn't get to answer (it said "I can't find it" over the button of a file it had found).

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

globalThis.matchMedia ??= () => ({ matches: false });
const url = (f) => pathToFileURL(path.join(__dirname, '../src/renderer/js', f)).href;

async function chatWith(host = {}) {
  const { Chat } = await import(url('chat.js'));
  const { LINES } = await import(url('lines.js'));
  const shown = { text: '', actions: [], onAction: null, model: 0 };
  const chat = new Chat({
    capri: { pulse() {}, zap() {}, head: () => ({ x: 0, y: 0 }), towardCenter: () => 1, windows: { wins: [] } },
    voice: { play() {} },
    panel: {
      setChatBusy() {}, chatTurn() {}, setFace() {},
      stream: (text) => { shown.text = text; },
      setActions: (actions, onAction) => { shown.actions = actions.map((a) => a.id); shown.onAction = onAction; },
    },
    brain: { t: LINES.es, lang: 'es', assistant: 'claude', custom: {}, context: () => '' },
    host: {
      onChatDelta() {}, chatRemember() {}, openApps: async () => [], findLaunch: async () => null,
      chatSend: async () => { shown.model++; return { ok: true, text: 'No encuentro ese archivo, lo siento.' }; },
      ...host,
    },
  });
  chat.open = true;
  chat.persona = () => 'her';
  return { chat, shown };
}
const PLAN = { id: 'p1', op: 'extract', names: ['~/Descargas/juego.zip'], to: '~/Descargas', choices: ['~/Descargas'] };

test('a plan with its button: the model has no say, and history keeps what she really showed', async () => {
  const { chat, shown } = await chatWith({ planFileOp: async () => PLAN });
  await chat.send('extrae descargas/juego.zip');
  assert.equal(shown.model, 0);
  assert.match(shown.text, /Extraer ~\/Descargas\/juego\.zip → ~\/Descargas/);
  assert.doesNotMatch(shown.text, /No encuentro/);
  assert.deepEqual(shown.actions, ['0', 'no']);
  assert.match(chat.history.at(-1).content, /Extraer/);
  assert.equal(chat.turn, 0);
});

test('a refusal: only that, no button', async () => {
  const { chat, shown } = await chatWith({ planFileOp: async () => ({ error: 'missing', name: 'x.zip' }) });
  await chat.send('extrae descargas/x.zip');
  assert.equal(shown.model, 0);
  assert.match(shown.text, /x\.zip/);
  assert.deepEqual(shown.actions, []);
});

test('the button still does it, and says so', async () => {
  const { chat, shown } = await chatWith({
    planFileOp: async () => PLAN,
    runFileOp: async () => ({ ok: true, path: '/h/Descargas/juego', shown: '~/Descargas/juego' }),
  });
  await chat.send('extrae descargas/juego.zip');
  await shown.onAction('0');
  assert.match(shown.text, /~\/Descargas\/juego/);
  assert.deepEqual(shown.actions, ['folder']);
});

test('not understood: she says nothing was done, without the model pretending', async () => {
  const { chat, shown } = await chatWith();
  await chat.send('me refiero a q lo extraigas ahi mismo nomas :v');
  assert.equal(shown.model, 0);
  assert.match(shown.text, /no toqué nada/i);
});

test('her PC failing: she says so instead of the model covering for it', async () => {
  const { chat, shown } = await chatWith({ pcDo: async () => false });
  await chat.send('muestra el escritorio');
  assert.equal(shown.model, 0);
  assert.match(shown.text, /No me salió/);
});

test('just talking: the model answers', async () => {
  const { chat, shown } = await chatWith();
  await chat.send('cuéntame un chiste');
  assert.equal(shown.model, 1);
  assert.match(chat.history.at(-1).content, /No encuentro/);
});

test('an app that would run something: its button, with words to go with it', async () => {
  const { chat, shown } = await chatWith({ findLaunch: async () => ({ kind: 'file', name: 'setup.exe', risky: true }) });
  await chat.send('abre setup.exe');
  assert.equal(shown.model, 0);
  assert.match(shown.text, /setup\.exe/);
  assert.deepEqual(shown.actions, ['open', 'no']);
});

test('closed while it was being done: nothing said, your message forgotten', async () => {
  let done;
  const { chat, shown } = await chatWith({ planFileOp: () => new Promise((r) => { done = r; }) });
  const sent = chat.send('extrae descargas/juego.zip');
  await new Promise((r) => setTimeout(r, 0));
  chat.open = false;
  chat.turn = 0;
  done(PLAN);
  await sent;
  assert.equal(shown.text, '');
  assert.equal(chat.history.length, 0);
});
