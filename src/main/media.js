'use strict';

// Music playing in Pear (pear-desktop, the YouTube Music app) on Linux, for her dancing (mood.js).
// Pear shows up to MPRIS as a plain "chromium.instance<pid>" player, like any Chromium, so it's
// told apart by that pid's command line. playerctl follows every player and says each change.

const fs = require('node:fs');
const readline = require('node:readline');
const { spawn, execFile } = require('node:child_process');

const PEAR = /pear-desktop|youtube-music/i;

function cmdline(pid) {
  try {
    return fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8');
  } catch {
    return '';
  }
}

const pidOf = (player) => /\.instance(\d+)$/.exec(player)?.[1] || null;

// is that MPRIS player Pear
function isPear(player, readCmdline = cmdline) {
  const pid = pidOf(player);
  return Boolean(pid) && PEAR.test(readCmdline(pid));
}

// a line of playerctl's "{{playerInstance}} {{status}}": who, and whether it's playing
function parseStatus(line) {
  const at = line.lastIndexOf(' ');
  return at > 0 ? { player: line.slice(0, at), playing: line.slice(at + 1) === 'Playing' } : null;
}

// onChange({ playing }) whenever Pear starts or stops playing. Pear closed while playing says
// nothing, hence a look every few seconds at whether its process is still there.
function startMediaWatch({ onChange }) {
  const players = new Map(); // Pear's players → playing
  let was = false;
  let child = null;
  let stopped = false;
  let restarts = 0;

  const tell = () => {
    for (const player of players.keys()) if (!fs.existsSync(`/proc/${pidOf(player)}`)) players.delete(player);
    const playing = [...players.values()].some(Boolean);
    if (playing === was) return;
    was = playing;
    onChange({ playing });
  };

  const start = () => {
    child = spawn('playerctl', ['-a', '-F', 'status', '-f', '{{playerInstance}} {{status}}'], { stdio: ['ignore', 'pipe', 'ignore'] });
    readline.createInterface({ input: child.stdout }).on('line', (line) => {
      const s = parseStatus(line.trim());
      if (!s || !isPear(s.player)) return;
      players.set(s.player, s.playing);
      tell();
    });
    child.on('error', (err) => {
      stopped = true; // no playerctl: no music to follow
      console.error('[capri] music watch:', err.message);
    });
    child.on('exit', () => {
      child = null;
      if (!stopped && restarts++ < 5) setTimeout(start, 5000);
    });
  };

  start();
  const every = setInterval(tell, 5000);
  return {
    stop() {
      stopped = true;
      clearInterval(every);
      child?.kill();
    },
  };
}

// `wpctl get-volume`: "Volume: 0.45", with " [MUTED]" when it is
function parseVolume(text) {
  const m = /Volume:\s*([\d.]+)/.exec(text);
  return m ? { level: Number(m[1]), muted: /\[MUTED\]/.test(text) } : null;
}

// what happened between two looks at the volume
function volumeChange(before, after) {
  if (!before || !after) return null;
  if (after.muted !== before.muted) return after.muted ? 'mute' : 'unmute';
  if (after.level > before.level) return 'up';
  if (after.level < before.level) return 'down';
  return null;
}

// onChange({ dir, level }) when you turn the sound up, down, off or on again. PipeWire (pactl
// subscribe) says a speaker changed; holding the key down is many of those, so she looks once
// they've stopped for a moment. Her own changes (ignoreFor, from her chat) aren't yours.
function startVolumeWatch({ onChange }) {
  let last = null;
  let timer = 0;
  let ignoreUntil = 0;
  let child = null;
  let stopped = false;

  const look = () => execFile('wpctl', ['get-volume', '@DEFAULT_AUDIO_SINK@'], { timeout: 3000 }, (err, out) => {
    const now = parseVolume(String(out || ''));
    if (err || !now) return;
    const dir = Date.now() < ignoreUntil ? null : volumeChange(last, now);
    last = now;
    if (dir) onChange({ dir, level: now.muted ? 0 : now.level });
  });

  const start = () => {
    child = spawn('pactl', ['subscribe'], { stdio: ['ignore', 'pipe', 'ignore'] });
    readline.createInterface({ input: child.stdout }).on('line', (line) => {
      if (!/'change' on sink #/.test(line)) return;
      clearTimeout(timer);
      timer = setTimeout(look, 400);
    });
    child.on('error', (err) => {
      stopped = true; // no pactl: no volume to follow
      console.error('[capri] volume watch:', err.message);
    });
    child.on('exit', () => !stopped && setTimeout(start, 5000));
  };

  look(); // how it is now: nothing to react to
  start();
  return {
    ignoreFor(ms) {
      ignoreUntil = Date.now() + ms;
    },
    stop() {
      stopped = true;
      clearTimeout(timer);
      child?.kill();
    },
  };
}

module.exports = { isPear, parseStatus, startMediaWatch, parseVolume, volumeChange, startVolumeWatch };
