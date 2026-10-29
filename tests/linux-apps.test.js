'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseDesktopEntry, appsFrom } = require('../src/main/linux-apps');

const THUNAR = `[Desktop Entry]
Version=1.0
Name=Thunar File Manager
Name[es]=Gestor de archivos Thunar
GenericName=File Manager
Exec=thunar %F
Icon=org.xfce.thunar
Type=Application
StartupWMClass=thunar

[Desktop Action open-home]
Name=Home
Exec=thunar /home
`;

test('a desktop entry: its name in your language, its window class', () => {
  assert.deepEqual(parseDesktopEntry(THUNAR, 'es'), { name: 'Gestor de archivos Thunar', wmClass: 'thunar', hidden: false });
  assert.equal(parseDesktopEntry(THUNAR, 'fr').name, 'Thunar File Manager');
});

test('the actions after the entry are not the entry', () => {
  assert.notEqual(parseDesktopEntry(THUNAR, 'en').name, 'Home');
});

test('entries not to show, and what is not an app, are left out or marked', () => {
  assert.equal(parseDesktopEntry('[Desktop Entry]\nName=Helper\nType=Application\nNoDisplay=true\n', 'en').hidden, true);
  assert.equal(parseDesktopEntry('[Desktop Entry]\nName=Docs\nType=Link\nURL=https://x\n', 'en'), null);
  assert.equal(parseDesktopEntry('garbage', 'en'), null);
});

test('open apps from the windows: one per class, named from its entry, never her or Claude', () => {
  const clients = [
    { address: '0x1', class: 'thunar', pid: 10 },
    { address: '0x2', class: 'thunar', pid: 10 },
    { address: '0x3', class: 'com.github.th-ch.youtube-music', pid: 11 },
    { address: '0x4', class: 'capri-desktop', pid: 12 },
    { address: '0x5', class: 'com.anthropic.Claude', pid: 13 },
  ];
  const entries = [{ name: 'Gestor de archivos Thunar', wmClass: 'thunar', fileId: 'thunar' },
    { name: 'Pear Desktop', wmClass: '', fileId: 'com.github.th-ch.youtube-music' }];
  const apps = appsFrom(clients, entries);
  assert.deepEqual(apps.map((a) => [a.process, a.label, a.ids.length]), [
    ['thunar', 'Gestor de archivos Thunar', 2],
    ['com.github.th-ch.youtube-music', 'Pear Desktop', 1],
  ]);
});

test('an app she opens is let go at once, not tied to her (gio still running is its business)', async () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'capri-gio-'));
  fs.writeFileSync(path.join(bin, 'gio'), '#!/bin/sh\nsleep 3\n', { mode: 0o755 });
  const before = process.env.PATH;
  process.env.PATH = `${bin}:${before}`;
  const { launchEntry } = require('../src/main/linux-apps');
  const start = Date.now();
  await launchEntry('/usr/share/applications/whatever.desktop');
  process.env.PATH = before;
  fs.rmSync(bin, { recursive: true, force: true });
  assert.ok(Date.now() - start < 1000, `waited ${Date.now() - start} ms`);
});

test('a launcher on your desktop (.desktop) is an app to start, not a document to open', () => {
  const { isLauncher } = require('../src/main/linux-apps');
  assert.equal(isLauncher('/home/u/Escritorio/steam.desktop'), true);
  assert.equal(isLauncher('/home/u/Escritorio/cv.pdf'), false);
  assert.equal(isLauncher('/home/u/Escritorio/notes.desktop.txt'), false);
});

// Taking you to an app's window ("llévame a brave"): which of its windows, as you asked for it
const W = (address, cls, ws, focus = 5) => ({
  address, class: cls, pid: 100, focusHistoryID: focus, workspace: { id: ws, name: ws < 0 ? `special:s${-ws}` : String(ws) },
});
const ENTRIES = [
  { name: 'ONLYOFFICE', wmClass: 'ONLYOFFICE', fileId: 'onlyoffice-desktopeditors' },
  { name: 'Brave Origin', wmClass: '', fileId: 'brave-origin' },
];
const pick = (clients, query, active) => require('../src/main/linux-apps').pickWindow({
  clients, entries: ENTRIES, query, current: { ws: active.workspace.id, address: active.address },
});
const CODIUM = W('0xc1', 'codium', 1, 0);

test('take me to: the app on another workspace', () => {
  assert.equal(pick([CODIUM, W('0xb2', 'brave-origin', 2)], 'brave', CODIUM).win.address, '0xb2');
});

test('take me to: the nearest workspace, either way', () => {
  assert.equal(pick([CODIUM, W('0xb5', 'brave-origin', 5), W('0xb2', 'brave-origin', 2)], 'brave', CODIUM).win.address, '0xb2');
  const on4 = W('0xc4', 'codium', 4, 0);
  assert.equal(pick([on4, W('0xb2', 'brave-origin', 2), W('0xb5', 'brave-origin', 5)], 'brave', on4).win.address, '0xb5');
});

test('take me to: a special workspace before any other', () => {
  const clients = [CODIUM, W('0xb2', 'brave-origin', 2), W('0xbs', 'brave-origin', -98)];
  assert.equal(pick(clients, 'brave', CODIUM).win.address, '0xbs');
});

test('take me to: in your own workspace, it is the nearest', () => {
  const clients = [CODIUM, W('0xb1', 'brave-origin', 1), W('0xb2', 'brave-origin', 2)];
  assert.equal(pick(clients, 'brave', CODIUM).win.address, '0xb1');
});

test('take me to, already in it: another one on another workspace, the same way', () => {
  const here = W('0xb1', 'brave-origin', 1, 0);
  const clients = [here, W('0xb1b', 'brave-origin', 1, 1), W('0xb6', 'brave-origin', 6), W('0xb3', 'brave-origin', 3)];
  assert.equal(pick(clients, 'brave', here).win.address, '0xb3');
});

test('take me to, already in it, others only in this workspace: the last one you used of them', () => {
  const here = W('0xb1', 'brave-origin', 1, 0);
  const clients = [here, W('0xb1c', 'brave-origin', 1, 3), W('0xb1b', 'brave-origin', 1, 2)];
  assert.equal(pick(clients, 'brave', here).win.address, '0xb1b');
});

test('take me to, already in its only window: you are there', () => {
  const here = W('0xb1', 'brave-origin', 1, 0);
  assert.deepEqual(pick([here, CODIUM], 'brave', here), { win: null, here: true });
});

test('take me to: the app by the name you say', () => {
  const clients = [CODIUM, W('0xcl', 'com.anthropic.Claude', 2), W('0xoo', 'ONLYOFFICE', 3), W('0xst', 'steam', 4)];
  assert.equal(pick(clients, 'claude', CODIUM).win.address, '0xcl');
  assert.equal(pick(clients, 'onlyoffice', CODIUM).win.address, '0xoo');
  assert.equal(pick(clients, 'Steam', CODIUM).win.address, '0xst');
});

test('take me to: nothing for an app that is not open, never her own window', () => {
  const clients = [CODIUM, W('0xca', 'capri-desktop', 1)];
  assert.deepEqual(pick(clients, 'brave', CODIUM), { win: null, here: false });
  assert.deepEqual(pick(clients, 'capri', CODIUM), { win: null, here: false });
});
