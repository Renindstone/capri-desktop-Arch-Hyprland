'use strict';

// apps.js, launch.js and files.js for Linux: the apps you have (their desktop entries), the ones open
// (Hyprland's windows), closing one, the music and the volume (playerctl, wpctl), and a picture of
// the screen (grim: Electron's own way goes through the screen-sharing portal, which asks you each time).

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile, spawn } = require('node:child_process');
const hyprland = require('./hyprland');

const ENTRY_DIRS = [
  '/usr/share/applications',
  '/var/lib/flatpak/exports/share/applications',
  path.join(os.homedir(), '.local/share/flatpak/exports/share/applications'),
  path.join(os.homedir(), '.local/share/applications'), // last: yours win over the system's
];
// never closed from her chat: her, Claude (she watches it), Codex, Ollama (she talks through it)
const KEEP = /capri|claude|codex|ollama/i;

// A .desktop file's main entry: { name (in `lang` if it has it), wmClass, hidden }, or null if it's
// not an app.
function parseDesktopEntry(text, lang) {
  const main = /^\[Desktop Entry\]\s*$([\s\S]*?)(?=^\[|(?![\s\S]))/m.exec(text)?.[1];
  if (!main) return null;
  const keys = {};
  for (const line of main.split('\n')) {
    const at = line.indexOf('=');
    if (at > 0) keys[line.slice(0, at).trim()] = line.slice(at + 1).trim();
  }
  if (keys.Type !== 'Application' || !keys.Name) return null;
  return {
    name: keys[`Name[${lang}]`] || keys.Name,
    wmClass: keys.StartupWMClass || '',
    hidden: keys.NoDisplay === 'true' || keys.Hidden === 'true',
  };
}

// [{ id (its file), fileId, name, wmClass, hidden }]: every app you have
function desktopEntries(lang = (process.env.LANG || 'en').slice(0, 2)) {
  const byId = new Map();
  for (const dir of ENTRY_DIRS) {
    let files = [];
    try {
      files = fs.readdirSync(dir).filter((f) => f.endsWith('.desktop'));
    } catch {
      continue;
    }
    for (const file of files) {
      const full = path.join(dir, file);
      let entry = null;
      try {
        entry = parseDesktopEntry(fs.readFileSync(full, 'utf8'), lang);
      } catch {
        // unreadable: left out
      }
      const fileId = file.slice(0, -'.desktop'.length);
      if (entry) byId.set(fileId, { id: full, fileId, ...entry });
      else byId.delete(fileId); // an entry of yours can hide the system's
    }
  }
  return [...byId.values()];
}

// The open apps, one per window class, named from their desktop entry: [{ name, process, label, ids }]
function appsFrom(clients, entries) {
  const apps = new Map();
  for (const c of clients) {
    if (!c.class || KEEP.test(c.class) || c.pid === process.pid) continue;
    const entry = entries.find((e) => e.wmClass.toLowerCase() === c.class.toLowerCase())
      || entries.find((e) => e.fileId.toLowerCase() === c.class.toLowerCase());
    const app = apps.get(c.class) || { name: c.class, process: c.class, label: entry?.name || '', ids: [] };
    app.ids.push(c.address);
    apps.set(c.class, app);
  }
  return [...apps.values()];
}

async function listApps() {
  if (!hyprland.active) return [];
  return appsFrom(await hyprland.json('clients'), desktopEntries());
}

// Closes its windows like their close button would; `force` ends their programs outright.
async function closeApp(cls, { force = false } = {}) {
  const clients = (await hyprland.json('clients')).filter((c) => c.class === cls);
  if (!clients.length) return { running: false };
  if (force) {
    for (const pid of new Set(clients.map((c) => c.pid))) {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        // already gone
      }
    }
  } else {
    for (const c of clients) await hyprland.lua(`hl.dispatch(hl.dsp.window.close({ window = "address:${c.address}" }))`).catch(() => {});
  }
  await new Promise((r) => setTimeout(r, force ? 600 : 2500));
  return { running: (await hyprland.json('clients')).some((c) => c.class === cls) };
}

const run = (cmd, args) => new Promise((resolve) => {
  execFile(cmd, args, { timeout: 5000 }, (err) => resolve(!err));
});

// The music and the sound, as her chat asks (launch.js MEDIA): whatever player is playing reacts.
const MEDIA = {
  pause: ['playerctl', ['pause']],
  play: ['playerctl', ['play']],
  next: ['playerctl', ['next']],
  previous: ['playerctl', ['previous']],
  volup: ['wpctl', ['set-volume', '-l', '1', '@DEFAULT_AUDIO_SINK@', '10%+']],
  voldown: ['wpctl', ['set-volume', '@DEFAULT_AUDIO_SINK@', '10%-']],
  mute: ['wpctl', ['set-mute', '@DEFAULT_AUDIO_SINK@', 'toggle']],
};

function media(action) {
  const cmd = MEDIA[action];
  return cmd ? run(...cmd) : Promise.resolve(false);
}

// An app from its desktop entry, as the desktop would start it, and let go at once: left on her
// pipes, a GTK or Qt app would die of the first thing it prints once they're closed.
function launchEntry(file) {
  return new Promise((resolve) => {
    const child = spawn('gio', ['launch', file], { detached: true, stdio: 'ignore' });
    child.on('error', () => resolve(false));
    child.on('spawn', () => {
      child.unref();
      resolve(true);
    });
  });
}

// A picture of the screens: PNG, or JPEG (`quality`) `scale` times the size. Rejects where grim
// can't (a desktop that isn't wlroots-like): the caller falls back on Electron's way.
function grab({ scale = 1, quality = 0 } = {}) {
  const args = ['-s', String(scale), ...(quality ? ['-t', 'jpeg', '-q', String(quality)] : ['-t', 'png']), '-'];
  return new Promise((resolve, reject) => {
    execFile('grim', args, { encoding: 'buffer', maxBuffer: 256 * 1024 * 1024, timeout: 10000 }, (err, out) => (
      err || !out?.length ? reject(err || new Error('no picture of the screen')) : resolve(out)));
  });
}

// a launcher (a desktop entry, on your desktop or anywhere): an app to start, not a file to open
const isLauncher = (file) => /\.desktop$/i.test(file);

const simple = (text) => String(text || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

// How well a window's app answers to `key` (simple()): by its class, the last part of a reverse-DNS
// one (com.anthropic.Claude), or its desktop entry; 0 if not at all.
function nameScore(c, key, entries) {
  const cls = (c.class || '').toLowerCase();
  const entry = entries.find((e) => e.wmClass.toLowerCase() === cls || e.fileId.toLowerCase() === cls);
  const names = [cls, cls.split('.').at(-1), entry?.name, entry?.fileId].map(simple).filter(Boolean);
  if (names.includes(key)) return 3;
  if (names.some((n) => n.startsWith(key) || key.startsWith(n))) return 2;
  if (key.length >= 3 && names.some((n) => n.includes(key))) return 1;
  return 0;
}

// The window of the app you named to take you to ("llévame a brave"), from where you are
// (`current`: your workspace, the window you're in). Your order: a special workspace first, then the
// nearest workspace (yours is the nearest), then the one you used last. Already in that app, she
// takes you to another of its windows the same way, the ones in your workspace last.
// { win, here }: here, you're in its only window.
function pickWindow({ clients, entries, query, current }) {
  const key = simple(query);
  if (key.length < 2) return { win: null, here: false };
  const scored = clients.filter((c) => c.class !== 'capri-desktop' && c.pid !== process.pid).map((c) => [nameScore(c, key, entries), c]);
  const best = Math.max(0, ...scored.map(([s]) => s));
  const app = scored.filter(([s]) => best && s === best).map(([, c]) => c);
  const inIt = app.some((c) => c.address === current.address);
  const others = app.filter((c) => c.address !== current.address);
  if (!others.length) return { win: null, here: inIt };
  const rank = (c) => {
    const ws = c.workspace.id;
    if (ws < 0) return [0, 0];
    if (ws === current.ws) return [inIt ? 2 : 1, 0];
    return [1, Math.abs(ws - current.ws)];
  };
  others.sort((a, b) => {
    const [ga, da] = rank(a);
    const [gb, db] = rank(b);
    return ga - gb || da - db || a.workspace.id - b.workspace.id || a.focusHistoryID - b.focusHistoryID;
  });
  return { win: others[0], here: false };
}

// Takes you there: Hyprland focuses that window, showing its workspace (a special one too) and
// bringing the pointer onto it. Where you are: what the screen shows, and the last window you were in
// before her chat took the keyboard. { ok, name, win: { x, y, w, h } } or { ok: false, why }.
async function goTo(query) {
  if (!hyprland.active) return { ok: false, why: 'unsupported' };
  const [clients, monitors] = await Promise.all([hyprland.json('clients'), hyprland.json('monitors')]);
  const screen = monitors.find((m) => m.focused) || monitors[0];
  const last = clients.filter((c) => c.class !== 'capri-desktop' && c.pid !== process.pid)
    .sort((a, b) => a.focusHistoryID - b.focusHistoryID)[0];
  const entries = desktopEntries();
  const current = { ws: screen?.specialWorkspace?.id || screen?.activeWorkspace?.id, address: last?.address };
  const { win, here } = pickWindow({ clients, entries, query, current });
  if (!win) return { ok: false, why: here ? 'here' : 'none' };
  await hyprland.lua(`hl.dispatch(hl.dsp.focus({ window = "address:${win.address}" }))`);
  const cls = win.class.toLowerCase();
  const entry = entries.find((e) => e.wmClass.toLowerCase() === cls || e.fileId.toLowerCase() === cls);
  return { ok: true, name: entry?.name || win.class.split('.').at(-1), win: { x: win.at[0], y: win.at[1], w: win.size[0], h: win.size[1] } };
}

module.exports = { pickWindow, goTo, isLauncher, parseDesktopEntry, desktopEntries, appsFrom, listApps, closeApp, media, launchEntry, grab };
