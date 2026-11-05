'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { volumeArgs, power, halfOf, batteryIn, ramFrom, ipFrom, SETTINGS } = require('../src/main/linux-system');
const { pagesOf, closable } = require('../src/main/linux-windows');

test('the sound: wpctl\'s words for a level, and for muting', () => {
  assert.deepEqual(volumeArgs({ level: 30 }), [['set-volume', '-l', '1', '@DEFAULT_AUDIO_SINK@', '0.30'], ['set-mute', '@DEFAULT_AUDIO_SINK@', '0']]);
  assert.deepEqual(volumeArgs({ level: 400 })[0][4], '1.00');
  assert.deepEqual(volumeArgs({ mute: true }), [['set-mute', '@DEFAULT_AUDIO_SINK@', '1']]);
  assert.deepEqual(volumeArgs({}), []);
});

test('power: a shutdown waits its seconds and cancel stops it', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const ran = [];
  const run = async (cmd, args) => { ran.push([cmd, ...args]); return true; };
  assert.equal(await power('shutdown', 30, run), true);
  t.mock.timers.tick(29000);
  assert.deepEqual(ran, []);
  assert.equal(await power('cancel', 0, run), true);
  t.mock.timers.tick(5000);
  assert.deepEqual(ran, []);
  await power('restart', 30, run);
  t.mock.timers.tick(30000);
  assert.deepEqual(ran, [['systemctl', 'reboot']]);
});

test('power: sleep and lock right away, nothing else gets through', async () => {
  const ran = [];
  const run = async (cmd, args) => { ran.push([cmd, ...args]); return true; };
  await power('sleep', 0, run);
  assert.deepEqual(ran, [['systemctl', 'suspend']]);
  assert.equal(await power('format-c', 0, run), false);
});

test('half a screen: inside what the bars leave, in its own coordinates', () => {
  const m = { x: 2560, y: 0, width: 2560, height: 1440, scale: 1, reserved: [60, 0, 0, 0] };
  assert.deepEqual(halfOf(m, 'left'), { x: 2620, y: 0, w: 1250, h: 1440 });
  assert.deepEqual(halfOf(m, 'right'), { x: 3870, y: 0, w: 1250, h: 1440 });
  assert.equal(halfOf({ ...m, scale: 2 }, 'left').w, 610);
});

test('what\'s left of the battery: none on a desktop', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'capri-'));
  assert.deepEqual(batteryIn(dir), { none: true });
  fs.mkdirSync(path.join(dir, 'AC0'));
  fs.mkdirSync(path.join(dir, 'BAT0'));
  fs.writeFileSync(path.join(dir, 'BAT0/capacity'), '42\n');
  fs.writeFileSync(path.join(dir, 'BAT0/status'), 'Charging\n');
  assert.deepEqual(batteryIn(dir), { percent: 42, charging: true });
});

test('memory: what\'s really available, not what the cache holds', () => {
  assert.deepEqual(ramFrom('MemTotal:  1000 kB\nMemFree:  10 kB\nMemAvailable:  600 kB\n'), { total: 1024000, used: 409600 });
});

test('the address on your network: not docker\'s, nor a bridge\'s', () => {
  const v4 = (address) => [{ family: 'IPv4', internal: false, address }];
  assert.equal(ipFrom({ docker0: v4('172.17.0.1'), 'br-1': v4('172.18.0.1'), lo: [{ family: 'IPv4', internal: true, address: '127.0.0.1' }], enp5s0: v4('192.168.1.20') }), '192.168.1.20');
  assert.equal(ipFrom({ docker0: v4('172.17.0.1') }), null);
});

test('settings pages: only what exists here, never a shell line', () => {
  for (const options of Object.values(SETTINGS)) for (const [cmd, args] of options) assert.ok(typeof cmd === 'string' && Array.isArray(args));
  assert.ok(SETTINGS.sound.length);
  assert.equal(SETTINGS.update, undefined);
});

test('another AI\'s own page in a browser, as Windows tells them', () => {
  const firefox = (title) => pagesOf({ class: 'firefox', title });
  assert.deepEqual(firefox('ChatGPT — Mozilla Firefox'), { pages: ['chatgpt'], dl: false });
  assert.deepEqual(firefox('Nuevo chat - Claude — Mozilla Firefox'), { pages: ['claude'], dl: false });
  assert.deepEqual(firefox('ChatGPT is down - YouTube — Mozilla Firefox'), { pages: [], dl: false });
  assert.deepEqual(firefox('Download Copilot — Mozilla Firefox'), { pages: [], dl: true });
  assert.deepEqual(pagesOf({ class: 'kitty', title: 'ChatGPT' }), { pages: [], dl: false });
  assert.deepEqual(pagesOf(null), { pages: [], dl: false });
});

test('closing: only that AI\'s page, in a browser', () => {
  const win = (cls, title) => ({ class: cls, title });
  assert.equal(closable('chatgpt', win('firefox', 'ChatGPT — Mozilla Firefox')), '');
  assert.equal(closable('chatgpt', win('firefox', 'Descargar ChatGPT — Mozilla Firefox')), '');
  assert.equal(closable('chatgpt', win('firefox', 'Noticias — Mozilla Firefox')), 'page');
  assert.equal(closable('gemini', win('firefox', 'ChatGPT — Mozilla Firefox')), 'page');
  assert.equal(closable('chatgpt', win('kitty', 'ChatGPT')), 'browser');
  assert.equal(closable('nope', win('firefox', 'ChatGPT — Mozilla Firefox')), 'page');
});
