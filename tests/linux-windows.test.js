'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { snapshot } = require('../src/main/linux-windows');

// what Hyprland says (j/monitors, j/clients), cut down to the fields that matter
const MONITOR = {
  id: 0, name: 'DP-1', x: 0, y: 0, width: 2560, height: 1440, scale: 1,
  activeWorkspace: { id: 1, name: '1' }, specialWorkspace: { id: 0, name: '' }, reserved: [60, 10, 10, 10],
};
const client = (address, cls, title, { ws = 1, at = [81, 31], size = [1228, 1378], floating = false, focus = 3, ...rest } = {}) => ({
  address, class: cls, title, workspace: { id: ws, name: String(ws) }, at, size, floating, focusHistoryID: focus,
  mapped: true, hidden: false, pinned: false, fullscreen: 0, monitor: 0, pid: 100, ...rest,
});
const SELF = client('0xa0', 'capri-desktop', 'Capri', { at: [0, 0], size: [2560, 1440], floating: true, pinned: true, focus: 5 });
const CODIUM = client('0xb0', 'codium', 'main.js - proj - VSCodium', { focus: 0 });
const BRAVE = client('0xc0', 'brave-origin', 'ChatGPT - Brave', { at: [1321, 31], size: [1208, 700], focus: 1 });
const THUNAR = client('0xd0', 'thunar', 'Downloads', { ws: 3 });
const DIALOG = client('0xe0', 'yad', 'Question', { at: [900, 500], size: [400, 300], floating: true, focus: 2 });
const TINY = client('0xf0', 'xdg-desktop-portal-gtk', '', { at: [10, 10], size: [100, 50], floating: true });
const clients = [SELF, CODIUM, BRAVE, THUNAR, DIALOG, TINY];
const snap = (over = {}) => snapshot({ clients, active: CODIUM, monitors: [MONITOR], self: SELF.address, ...over });

test('only the windows she can see: not hers, not on another workspace, not tiny', () => {
  const ids = snap().wins.map((w) => w.id).sort((a, b) => a - b);
  assert.deepEqual(ids, [0xb0, 0xc0, 0xe0]);
});

test('floating windows are in front, then the most recently focused', () => {
  assert.deepEqual(snap().wins.map((w) => w.id), [0xe0, 0xb0, 0xc0]);
});

test('the window in front is fg, by its address', () => {
  assert.equal(snap().fg, 0xb0);
  assert.equal(snap({ active: null }).fg, null);
});

test('VSCodium in front is coding, a browser is not', () => {
  assert.equal(snap().coding, true);
  assert.equal(snap({ active: { ...CODIUM, class: 'VSCodium' } }).coding, true);
  assert.equal(snap({ active: BRAVE }).coding, false);
});

test('another AI in front, from its title, and nothing of the title gets out', () => {
  const s = snap({ active: BRAVE });
  assert.deepEqual(s.ai, ['chatgpt']);
  assert.doesNotMatch(JSON.stringify(s), /ChatGPT|Brave|VSCodium/);
});

test('a tiled window filling the work area is maximized, half of it is not', () => {
  const full = client('0xb1', 'codium', 'x', { at: [81, 31], size: [2448, 1378] });
  const s = snapshot({ clients: [full, BRAVE], active: full, monitors: [MONITOR], self: SELF.address });
  assert.equal(s.wins.find((w) => w.id === 0xb1).max, true);
  assert.equal(s.wins.find((w) => w.id === 0xc0).max, false);
});

test('a game in front: the folder it runs from in a launcher library', () => {
  const dota = client('0x99', 'steam_app_570', 'Dota 2', { pid: 4242 });
  const pathsOf = (pid) => (pid === 4242 ? ['/home/u/.local/share/Steam/steamapps/common/dota 2 beta/game/bin/linuxsteamrt64/dota2'] : []);
  assert.equal(snapshot({ clients: [dota], active: dota, monitors: [MONITOR], self: null, pathsOf }).game, 'dota 2 beta');
  assert.equal(snap({ pathsOf }).game, null);
});

test('the special workspace, when shown, is seen over the regular one', () => {
  const music = client('0x77', 'com.github.th-ch.youtube-music', 'YouTube Music', { ws: -98, focus: 4 });
  const shown = { ...MONITOR, specialWorkspace: { id: -98, name: 'special:music' } };
  assert.equal(snapshot({ clients: [CODIUM, music], active: CODIUM, monitors: [shown], self: null }).wins[0].id, 0x77);
  assert.equal(snapshot({ clients: [CODIUM, music], active: CODIUM, monitors: [MONITOR], self: null }).wins.length, 1);
});

test('a window just opened: the middle of it, found by the address in the event (no 0x there)', () => {
  const { openedAt } = require('../src/main/linux-windows');
  const s = snap();
  assert.deepEqual(openedAt(s.wins, 'c0'), { x: 1321 + 604, y: 31 + 350 });
  assert.equal(openedAt(s.wins, 'd0'), null); // on another workspace: not seen
});
