'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

// chat.js is a page module (util.js asks matchMedia as it loads): only its pure part, goTarget, is used here
globalThis.matchMedia ??= () => ({ matches: false });
const load = () => import(pathToFileURL(path.join(__dirname, '../src/renderer/js/chat.js')).href);

test('"llévame a X": the app she takes you to', async () => {
  const { goTarget } = await load();
  assert.equal(goTarget('Llévame a claude'), 'claude');
  assert.equal(goTarget('llevame a onlyoffice por favor'), 'onlyoffice');
  assert.equal(goTarget('Capri, llévame al steam!'), 'steam');
  assert.equal(goTarget('llévame a la ventana de brave'), 'brave');
});

test('the same in her other languages', async () => {
  const { goTarget } = await load();
  assert.equal(goTarget('take me to brave'), 'brave');
  assert.equal(goTarget('emmène-moi à discord'), 'discord');
  assert.equal(goTarget('me leva para o steam'), 'steam');
  assert.equal(goTarget('отведи меня к brave'), 'brave');
});

test('opening an app, or anything else, is not being taken to it', async () => {
  const { goTarget } = await load();
  assert.equal(goTarget('abre steam'), null);
  assert.equal(goTarget('¿a dónde me llevas?'), null);
});
