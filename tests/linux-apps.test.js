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
