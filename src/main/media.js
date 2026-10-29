'use strict';

// Music playing in Pear (pear-desktop, the YouTube Music app) on Linux, for her dancing (mood.js).
// Pear shows up to MPRIS as a plain "chromium.instance<pid>" player, like any Chromium, so it's
// told apart by that pid's command line. playerctl follows every player and says each change.

const fs = require('node:fs');
const readline = require('node:readline');
const { spawn } = require('node:child_process');

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

module.exports = { isPear, parseStatus, startMediaWatch };
