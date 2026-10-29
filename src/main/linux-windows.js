'use strict';

// windows.js for Linux (Hyprland): the same snapshot as windows.ps1, so the overlay doesn't know
// the difference. Hyprland says where every window is and which one is in front; a title is only
// matched against the AI names here (the "ai" keys), and never leaves. On top of what Windows
// gives: `coding`, VSCodium (or Code) in front. USB sticks and devices plugged in come from udev.

const fs = require('node:fs');
const os = require('node:os');
const readline = require('node:readline');
const { spawn } = require('node:child_process');
const hyprland = require('./hyprland');

// Other AIs: a key, what gives them away in the title of the window in front, and in its class.
const AIS = [
  ['chatgpt', /\bChatGPT\b/i, /chatgpt/i],
  ['claude', /\bClaude\b/i, /claude/i],
  ['codex', /\bCodex\b/i, /codex/i],
  ['gemini', /\bGemini\b/i, null],
  ['copilot', /\bCopilot\b/i, /copilot/i],
  ['perplexity', /\bPerplexity\b/i, /perplexity/i],
  ['deepseek', /\bDeepSeek\b/i, null],
  ['grok', /\bGrok\b/i, null],
  ['lechat', /\bLe Chat\b|\bMistral AI\b/i, null],
  ['characterai', /character\.ai/i, null],
  ['metaai', /\bMeta AI\b/i, null],
];
const CODING = /^(codium|vscodium|code|code-oss|code-url-handler)$/i;
// A game: its program, or the folder it runs in, sits in a launcher's library (Steam, Heroic,
// Lutris). The game is the name of its folder there; the launchers themselves aren't games.
const GAME = /\/(?:steamapps\/common|Games\/Heroic|Games\/lutris|lutris\/games)\/([^/]+)\//i;
const NOT_GAME = /launcher|client|redistributable|steamworks|proton|steam linux runtime/i;
const MIN_W = 200;
const MIN_H = 120;
const MAX_SLACK = 80; // a tiled window this close to the whole work area fills it (gaps between)

// its program and its working folder (Proton games run from their own folder)
function procPaths(pid) {
  return ['exe', 'cwd'].map((link) => {
    try {
      return fs.readlinkSync(`/proc/${pid}/${link}`);
    } catch {
      return '';
    }
  });
}

function gameOf(win, pathsOf) {
  if (!win) return null;
  for (const p of pathsOf(win.pid)) {
    const m = GAME.exec(`${p}/`);
    if (m && !NOT_GAME.test(m[1])) return m[1];
  }
  return null;
}

// What the overlay gets, from Hyprland's clients, the window in front and the monitors.
function snapshot({ clients, active, monitors, self, pathsOf = procPaths }) {
  const shown = new Set();
  for (const m of monitors) {
    shown.add(m.activeWorkspace?.id);
    if (m.specialWorkspace?.id) shown.add(m.specialWorkspace.id);
  }
  const workOf = (win) => {
    const m = monitors.find((mon) => mon.id === win.monitor) || monitors[0];
    const [l, t, r, b] = m?.reserved || [0, 0, 0, 0];
    return m ? { w: m.width / (m.scale || 1) - l - r, h: m.height / (m.scale || 1) - t - b } : { w: Infinity, h: Infinity };
  };
  const special = (win) => win.workspace?.id < 0;
  const wins = clients
    .filter((c) => c.mapped && !c.hidden && c.address !== self && (c.pinned || shown.has(c.workspace?.id)))
    .filter((c) => c.size[0] >= MIN_W && c.size[1] >= MIN_H)
    // front first: the special workspace over the others, floating over tiled, then the last focused
    .sort((a, b) => special(b) - special(a) || b.floating - a.floating || a.focusHistoryID - b.focusHistoryID)
    .map((c) => {
      const work = workOf(c);
      const full = !c.floating && c.size[0] >= work.w - MAX_SLACK && c.size[1] >= work.h - MAX_SLACK;
      return { id: Number.parseInt(c.address, 16), x: c.at[0], y: c.at[1], w: c.size[0], h: c.size[1], max: c.fullscreen > 0 || full };
    });
  const front = active?.address ? active : null;
  const text = front ? `${front.title || ''}` : '';
  return {
    fg: front ? Number.parseInt(front.address, 16) : null,
    taskbar: false, // the bar is a layer, never a window in front
    ai: front ? AIS.filter(([, title, cls]) => title.test(text) || cls?.test(front.class || '')).map(([key]) => key) : [],
    game: gameOf(front, pathsOf),
    coding: Boolean(front && CODING.test(front.class || '')),
    usb: [],
    plug: null,
    wins,
  };
}

// What kind of thing a USB device is, from the classes of its interfaces, in the words pc.js knows
// from Windows (a phone first: they often show a drive too).
const KINDS = [[/:06/, 'WPD'], [/:08/, 'DiskDrive'], [/:0e/i, 'Camera'], [/:01/, 'AudioEndpoint'], [/:03/, 'HIDClass']];

// A USB device plugged in or out, from udev's properties: { in, name, class }, or null (its
// interfaces, a hub, anything that isn't plugging).
function plugFrom(props) {
  if (props.DEVTYPE !== 'usb_device' || !['add', 'remove'].includes(props.ACTION)) return null;
  const interfaces = props.ID_USB_INTERFACES || '';
  if (/:09/.test(interfaces)) return null; // a hub
  const name = (props.ID_MODEL_FROM_DATABASE || props.ID_MODEL?.replaceAll('_', ' ') || props.ID_VENDOR_FROM_DATABASE || '').trim();
  return { in: props.ACTION === 'add', name, class: KINDS.find(([re]) => re.test(interfaces))?.[1] || '' };
}

// USB sticks and cards: what's mounted under /run/media/<you> (or /media/<you>), by its label
function usbDrives(mounts, user) {
  const under = new RegExp(`^/(?:run/)?media/${user}/([^/]+)$`);
  return mounts.split('\n').map((line) => under.exec(line.split(' ')[1] || '')?.[1]).filter(Boolean)
    .map((label) => label.replace(/\\(\d{3})/g, (_m, oct) => String.fromCharCode(Number.parseInt(oct, 8))));
}

// The middle of a window just opened, from its address as Hyprland's event gives it (no 0x), if she
// can see it.
function openedAt(wins, address) {
  const id = Number.parseInt(address, 16);
  const win = wins.find((w) => w.id === id);
  return win ? { x: win.x + win.w / 2, y: win.y + win.h / 2 } : null;
}

// Feeds the overlay as windows.js does: Hyprland's events say when to look again (grouped over
// 100 ms), and it only speaks when something changed. Resizing a tiled window says nothing, hence a
// look every couple of seconds too. onOpen({ x, y }): a window opened there (her overlay's pixels).
function startLinuxWindowWatch({ overlay, onUpdate, onOpen }) {
  if (!hyprland.active) return { stop() {}, refresh() {} };
  let last = null;
  let lastJson = '';
  let front = null;
  let timer = 0;
  let opened = null; // the address of a window just opened, until it's been seen
  let plug = null;   // the last device plugged in or out, numbered as windows.ps1 does
  let plugs = 0;
  const user = os.userInfo().username;

  const send = () => {
    if (!last || overlay.isDestroyed()) return;
    const bounds = overlay.getBounds();
    const wins = last.wins
      .map((w) => ({ ...w, x: w.x - bounds.x, y: w.y - bounds.y }))
      .filter((w) => w.x < bounds.width && w.x + w.w > 0 && w.y < bounds.height && w.y + w.h > 0);
    onUpdate({ ...last, wins });
  };

  const read = async () => {
    const [clients, active, monitors] = await Promise.all(['clients', 'activewindow', 'monitors'].map((w) => hyprland.json(w)));
    const self = clients.find((c) => c.pid === process.pid && c.title === 'Capri')?.address || null;
    // her own window taking the pointer isn't you going to another window
    if (active?.address !== self) front = active?.address ? active : null;
    const snap = snapshot({ clients, active: front, monitors, self });
    snap.usb = usbDrives(fs.readFileSync('/proc/mounts', 'utf8'), user);
    snap.plug = plug;
    const at = opened && openedAt(snap.wins, opened);
    if (at) {
      opened = null;
      const bounds = overlay.getBounds();
      onOpen?.({ x: at.x - bounds.x, y: at.y - bounds.y });
    }
    const json = JSON.stringify(snap);
    if (json === lastJson) return;
    lastJson = json;
    last = snap;
    send();
  };
  const look = () => {
    if (timer) return;
    timer = setTimeout(() => {
      timer = 0;
      read().catch((err) => console.error('[capri] window watch:', err.message));
    }, 100);
  };

  const events = hyprland.listen((name, data) => {
    if (name === 'openwindow') opened = data.split(',')[0];
    look();
  });
  const every = setInterval(look, 2000);
  look();

  // udev: each event a block of KEY=VALUE lines, ending with an empty one
  const udev = spawn('udevadm', ['monitor', '--udev', '--property', '--subsystem-match=usb'], { stdio: ['ignore', 'pipe', 'ignore'] });
  udev.on('error', (err) => console.error('[capri] udev:', err.message));
  let props = {};
  readline.createInterface({ input: udev.stdout }).on('line', (line) => {
    const at = line.indexOf('=');
    if (at > 0) {
      props[line.slice(0, at)] = line.slice(at + 1);
      return;
    }
    if (line.trim()) return; // the event's header line
    const p = plugFrom(props);
    props = {};
    if (!p) return;
    plug = { n: ++plugs, ...p };
    look();
  });

  return {
    stop() {
      udev.kill();
      events.stop();
      clearInterval(every);
      clearTimeout(timer);
    },
    refresh: send,
  };
}

module.exports = { snapshot, openedAt, plugFrom, usbDrives, startLinuxWindowWatch };
