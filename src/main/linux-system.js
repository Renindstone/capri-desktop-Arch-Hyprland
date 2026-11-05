'use strict';

// system.js for Linux (Hyprland): what her chat can do to your PC itself, each thing the way this
// desktop does it, answering as system.js does so her chat doesn't know the difference.

const fs = require('node:fs');
const os = require('node:os');
const { execFile, spawn } = require('node:child_process');
const hyprland = require('./hyprland');
const { pickWindow, desktopEntries, windowName } = require('./linux-apps');
const { parseVolume } = require('./media');

const SINK = '@DEFAULT_AUDIO_SINK@';
const run = (cmd, args) => new Promise((resolve) => {
  execFile(cmd, args, { timeout: 15000 }, (err) => resolve(!err));
});

// shortcut: no settings app covers the other pages on Hyprland (update, display, mouse…), she says so
const SETTINGS = {
  sound: [['pwvucontrol', []], ['pavucontrol', []]],
  network: [['nm-connection-editor', []], ['kitty', ['-e', 'nmtui']]],
  wifi: [['nm-connection-editor', []], ['kitty', ['-e', 'nmtui']]],
  bluetooth: [['blueman-manager', []], ['kitty', ['-e', 'bluetoothctl']]],
};

// the first of them that's installed, left running on its own
async function settings(page) {
  for (const [cmd, args] of SETTINGS[page] || []) {
    const started = await new Promise((resolve) => {
      const child = spawn(cmd, args, { detached: true, stdio: 'ignore' });
      child.on('error', () => resolve(false));
      child.on('spawn', () => {
        child.unref();
        resolve(true);
      });
    });
    if (started) return true;
  }
  return false;
}

function batteryIn(dir = '/sys/class/power_supply') {
  const name = (fs.existsSync(dir) ? fs.readdirSync(dir) : []).find((n) => n.startsWith('BAT'));
  if (!name) return { none: true };
  const read = (file) => fs.readFileSync(`${dir}/${name}/${file}`, 'utf8').trim();
  return { percent: Number(read('capacity')), charging: ['Charging', 'Full'].includes(read('status')) };
}

// os.freemem() leaves out what the cache would give back right away
function ramFrom(meminfo) {
  const kb = (key) => Number(new RegExp(`^${key}:\\s+(\\d+)`, 'm').exec(meminfo)?.[1] || 0) * 1024;
  return { total: kb('MemTotal'), used: kb('MemTotal') - kb('MemAvailable') };
}

function ipFrom(interfaces) {
  const found = Object.entries(interfaces)
    .filter(([name]) => !/^(?:docker|br-|veth|virbr|vmnet|vbox|lo)/.test(name))
    .flatMap(([, list]) => list || [])
    .find((a) => a.family === 'IPv4' && !a.internal && !a.address.startsWith('169.254.'));
  return found?.address || null;
}

function info(what) {
  if (what === 'battery') return batteryIn();
  if (what === 'ram') return ramFrom(fs.readFileSync('/proc/meminfo', 'utf8'));
  if (what === 'ip') return { ip: ipFrom(os.networkInterfaces()) };
  if (what === 'disk') {
    const s = fs.statfsSync(os.homedir());
    return { drive: '~', free: s.bavail * s.bsize, total: s.blocks * s.bsize };
  }
  return null;
}

function volumeArgs({ level = null, mute = null }) {
  if (Number.isFinite(level)) {
    return [['set-volume', '-l', '1', SINK, (Math.min(100, Math.max(0, level)) / 100).toFixed(2)], ['set-mute', SINK, '0']];
  }
  return typeof mute === 'boolean' ? [['set-mute', SINK, mute ? '1' : '0']] : [];
}

async function volume(req) {
  for (const args of volumeArgs(req)) await run('wpctl', args);
  const now = await new Promise((resolve) => {
    execFile('wpctl', ['get-volume', SINK], { timeout: 3000 }, (err, out) => resolve(err ? null : parseVolume(out)));
  });
  return now ? { level: Math.round(now.level * 100) } : null;
}

// You pick the area (slurp), it lands in your clipboard. Esc, or no slurp: false.
function snip() {
  return new Promise((resolve) => {
    execFile('slurp', [], { timeout: 60000 }, (err, area) => {
      if (err) return resolve(false);
      const grim = spawn('grim', ['-g', area.trim(), '-'], { stdio: ['ignore', 'pipe', 'ignore'] });
      const copy = spawn('wl-copy', ['--type', 'image/png'], { stdio: ['pipe', 'ignore', 'ignore'] });
      grim.on('error', () => resolve(false));
      copy.on('error', () => resolve(false));
      copy.stdin.on('error', () => {});
      grim.stdout.pipe(copy.stdin);
      copy.on('exit', (code) => resolve(code === 0));
    });
  });
}

// Hyprland has no minimizing: an empty workspace shows your desktop, and nothing gets moved around.
async function tidy(back) {
  if (!hyprland.active) return false;
  return hyprland.lua(`hl.dispatch(hl.dsp.focus({ workspace = "${back ? 'previous' : 'empty'}" }))`).then(() => true, () => false);
}

// half of a monitor, inside what its bars reserve, in Hyprland's coordinates
function halfOf(m, side) {
  const scale = m.scale || 1;
  const [left, top, right, bottom] = m.reserved || [0, 0, 0, 0];
  const w = Math.floor((m.width / scale - left - right) / 2);
  const h = Math.floor(m.height / scale - top - bottom);
  return { x: m.x + left + (side === 'left' ? 0 : w), y: m.y + top, w, h };
}

// The window of app `name` floating over half of its screen (a tiled one would take the layout's
// place, not the half you asked for).
async function arrange(name, side) {
  if (!hyprland.active || !['left', 'right'].includes(side)) return null;
  const [clients, monitors] = await Promise.all([hyprland.json('clients'), hyprland.json('monitors')]);
  const entries = desktopEntries();
  const { win } = pickWindow({ clients, entries, query: name, current: {} });
  if (!win) return { found: false };
  const m = monitors.find((mon) => mon.id === win.monitor) || monitors[0];
  const { x, y, w, h } = halfOf(m, side);
  const window = `window = "address:${win.address}"`;
  // a maximized window refuses to be resized or moved
  await hyprland.lua(`hl.dispatch(hl.dsp.window.fullscreen({ mode = "maximized", action = "unset", ${window} }))`);
  await hyprland.lua(`hl.dispatch(hl.dsp.window.float({ action = "on", ${window} }))`);
  await hyprland.lua(`hl.dispatch(hl.dsp.window.resize({ x = ${w}, y = ${h}, relative = false, ${window} }))`);
  await hyprland.lua(`hl.dispatch(hl.dsp.window.move({ x = ${x}, y = ${y}, relative = false, ${window} }))`);
  return { found: true, name: windowName(win, entries) };
}

async function theme(dark) {
  return run('gsettings', ['set', 'org.gnome.desktop.interface', 'color-scheme', dark ? 'prefer-dark' : 'prefer-light']);
}

let waiting = null; // the shutdown or restart counting down: Capri closed, it's off too

async function power(action, seconds = 60, exec = run) {
  if (action === 'cancel') {
    clearTimeout(waiting);
    waiting = null;
    return true;
  }
  if (action === 'sleep') return exec('systemctl', ['suspend']);
  if (action === 'lock') {
    // Caelestia's own lock if it's there; loginctl for any other locker
    if (hyprland.active) await hyprland.lua('hl.dispatch(hl.dsp.global("caelestia:lock"))').catch(() => {});
    return exec('loginctl', ['lock-session']);
  }
  const verb = { shutdown: 'poweroff', restart: 'reboot' }[action];
  if (!verb) return false;
  clearTimeout(waiting);
  waiting = setTimeout(() => exec('systemctl', [verb]), Math.max(0, seconds) * 1000);
  return true;
}

// One way in, from her chat, as in system.js: only these, with only what each takes.
function act(req = {}) {
  switch (req.action) {
    case 'settings': return settings(String(req.page));
    case 'info': return info(String(req.what));
    case 'volume': return volume({ level: Number.isFinite(req.level) ? req.level : null, mute: typeof req.mute === 'boolean' ? req.mute : null });
    case 'snip': return snip();
    case 'tidy': return tidy(Boolean(req.back));
    case 'arrange': return arrange(String(req.name || '').slice(0, 80), req.side);
    case 'theme': return theme(Boolean(req.dark));
    case 'power': return power(String(req.what), Number(req.seconds) || 0);
    default: return null;
  }
}

module.exports = { act, SETTINGS, volumeArgs, power, halfOf, batteryIn, ramFrom, ipFrom };
