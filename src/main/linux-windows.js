'use strict';

// windows.js for Linux (Hyprland): the same snapshot as windows.ps1, so the overlay doesn't know
// the difference. Hyprland says where every window is and which one is in front; a title is only
// matched against the AI names here (the "ai" keys), and never leaves. On top of what Windows
// gives: `coding`, VSCodium (or Code) in front.

const fs = require('node:fs');
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

// Feeds the overlay as windows.js does: Hyprland's events say when to look again (grouped over
// 100 ms), and it only speaks when something changed. Resizing a tiled window says nothing, hence a
// look every couple of seconds too.
function startLinuxWindowWatch({ overlay, onUpdate }) {
  if (!hyprland.active) return { stop() {}, refresh() {} };
  let last = null;
  let lastJson = '';
  let front = null;
  let timer = 0;

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

  const events = hyprland.listen(look);
  const every = setInterval(look, 2000);
  look();
  return {
    stop() {
      events.stop();
      clearInterval(every);
      clearTimeout(timer);
    },
    refresh: send,
  };
}

module.exports = { snapshot, startLinuxWindowWatch };
