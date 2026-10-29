'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const load = () => import(pathToFileURL(path.join(__dirname, '../src/renderer/js/mood.js')).href);

test('a held state comes on at once', async () => {
  const { Held } = await load();
  const music = new Held(5000);
  assert.equal(music.set(true, 0), true);
});

test('it goes off only once it has been off for its whole hold', async () => {
  const { Held } = await load();
  const music = new Held(5000);
  music.set(true, 0);
  assert.equal(music.set(false, 1000), true);
  assert.equal(music.set(false, 5999), true);
  assert.equal(music.set(false, 6000), false);
});

test('coming back on inside the hold starts the hold over (a skipped song)', async () => {
  const { Held } = await load();
  const music = new Held(5000);
  music.set(true, 0);
  music.set(false, 1000);
  music.set(true, 3000);
  assert.equal(music.set(false, 4000), true);
  assert.equal(music.set(false, 8999), true);
  assert.equal(music.set(false, 9000), false);
});

test('off from the start stays off', async () => {
  const { Held } = await load();
  assert.equal(new Held(10000).set(false, 0), false);
});
