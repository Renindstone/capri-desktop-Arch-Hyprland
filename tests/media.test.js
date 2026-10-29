'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { isPear, parseStatus } = require('../src/main/media');

// what /proc/<pid>/cmdline holds for each player's process (NUL-separated, as the kernel gives it)
const PROCS = {
  30741: 'electron42\0/usr/lib/pear-desktop/app.asar\0',
  8961: '/opt/brave-origin/brave\0--type=browser\0',
  1200: '/tmp/.mount_youtube-music/youtube-music\0',
};
const readCmdline = (pid) => PROCS[pid] || '';

test('Pear is the chromium player whose process runs pear-desktop', () => {
  assert.equal(isPear('chromium.instance30741', readCmdline), true);
  assert.equal(isPear('chromium.instance1200', readCmdline), true); // the YouTube Music app it comes from
});

test('a browser playing a video is not Pear', () => {
  assert.equal(isPear('brave.instance8961', readCmdline), false);
  assert.equal(isPear('chromium.instance8961', readCmdline), false);
});

test('a player without a pid, or a gone process, is not Pear', () => {
  assert.equal(isPear('spotify', readCmdline), false);
  assert.equal(isPear('chromium.instance99999', readCmdline), false);
});

test('a playerctl status line: who, and whether it plays', () => {
  assert.deepEqual(parseStatus('chromium.instance30741 Playing'), { player: 'chromium.instance30741', playing: true });
  assert.deepEqual(parseStatus('chromium.instance30741 Paused'), { player: 'chromium.instance30741', playing: false });
  assert.deepEqual(parseStatus('chromium.instance30741 Stopped'), { player: 'chromium.instance30741', playing: false });
  assert.equal(parseStatus(''), null);
});
