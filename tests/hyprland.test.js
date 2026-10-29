'use strict';

// hyprland.js against a stand-in for Hyprland: its two sockets in a temporary runtime folder, the
// command one answering as it's told and keeping what it was asked, the event one sending events.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const RUN = fs.mkdtempSync(path.join(os.tmpdir(), 'capri-hypr-'));
process.env.XDG_RUNTIME_DIR = RUN;
process.env.HYPRLAND_INSTANCE_SIGNATURE = 'test';
const DIR = path.join(RUN, 'hypr', 'test');
fs.mkdirSync(DIR, { recursive: true });

const asked = [];
let refuseRule = false;
const SELF = { address: '0xabc', pid: process.pid, class: 'capri-desktop', title: 'Capri' };
const commands = net.createServer((c) => {
  let req = '';
  c.on('data', (d) => { req += d; });
  c.on('end', () => {
    asked.push(req);
    if (req === 'j/clients') return c.end(JSON.stringify([SELF]));
    if (req === 'j/activewindow') return c.end(JSON.stringify({ address: '0xdef' }));
    if (req.includes('hl.window_rule') && refuseRule) return c.end('error: unknown field');
    return c.end('ok');
  });
});
let eventClients = [];
const events = net.createServer((c) => { eventClients.push(c); });
commands.listen(path.join(DIR, '.socket.sock'));
events.listen(path.join(DIR, '.socket2.sock'));
test.after(() => {
  commands.close();
  for (const c of eventClients) c.destroy();
  events.close();
  fs.rmSync(RUN, { recursive: true, force: true });
});

const hyprland = require('../src/main/hyprland');
const AREA = { x: 0, y: 0, width: 2560, height: 1440 };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
// the last value she set for no_focus: '1' lets the pointer through her window, '0' stops it there
const passing = () => /value = "(\d)"/.exec(asked.filter((a) => a.includes('no_focus')).at(-1) || '')?.[1];

test('her window is not to be shown when Hyprland refuses her rule', async (t) => {
  refuseRule = true;
  const o = hyprland.overlay(AREA);
  t.after(() => o.stop());
  await assert.rejects(o.ready);
  refuseRule = false;
});

test('the chat takes the keyboard without her window catching every click', async (t) => {
  const o = hyprland.overlay(AREA);
  t.after(() => o.stop());
  await o.ready;
  await o.attach();
  await o.focus(true);
  await wait(50);
  assert.ok(asked.some((a) => a.includes('hl.dsp.focus({ window = "address:0xabc" })')));
  assert.equal(passing(), '1');
});

test('released (her page reloaded or gone), the pointer goes through her window again', async (t) => {
  const o = hyprland.overlay(AREA);
  t.after(() => o.stop());
  await o.ready;
  await o.attach();
  o.interactive(true);
  await wait(50);
  assert.equal(passing(), '0');
  await o.release();
  await wait(50);
  assert.equal(passing(), '1');
});

test('after a config reload her window lets the pointer through again, even if her rule is refused', async (t) => {
  const o = hyprland.overlay(AREA);
  t.after(() => o.stop());
  await o.ready;
  await o.attach();
  await wait(50);
  asked.length = 0;
  refuseRule = true;
  for (const c of eventClients) c.write('configreloaded>>\n');
  await wait(150);
  refuseRule = false;
  assert.equal(passing(), '1');
});
