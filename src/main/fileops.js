'use strict';

// Doing what you ask her to with your files (chat.js fileAsk reads it off your message): extract,
// compress, move, copy, rename, to the trash, a new folder. A plan first, shown to you with a button;
// only that plan runs, checked again, and only inside your home folder. Nothing gets overwritten,
// nothing deleted for good. No Electron in here: main.js hands it the home folder and the trash.

const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const OPS = new Set(['extract', 'compress', 'move', 'copy', 'rename', 'trash', 'mkdir']);
const PLACED = new Set(['extract', 'compress', 'move', 'copy', 'mkdir']); // the ones with a folder to pick
const PLAN_TTL_MS = 10 * 60 * 1000;
const SEARCH_DEPTH = 5;
const SEARCH_MAX = 40000;

const fold = (s) => String(s).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
const refuse = (error, name) => (name ? { error, name } : { error });
const stat = (p) => fs.stat(p).catch(() => null);
const there = (p) => fs.lstat(p).then(() => true, () => false); // a broken link is still something there
// a name for something new: no folders in it, nothing hidden
const goodName = (n) => typeof n === 'string' && n.trim() && !/[/\\]/.test(n) && !n.trim().startsWith('.');

function createFileOps({ home, known = {}, trash, now = Date.now }) {
  const plans = new Map(); // id → { op, split, sources, targets, at }

  const shown = (p) => {
    const rel = path.relative(home, p);
    if (!rel) return '~';
    return rel.startsWith('..') || path.isAbsolute(rel) ? p : `~/${rel.split(path.sep).join('/')}`;
  };

  // where it really is (links followed) is inside home, not hidden; home itself only as a place to put things
  async function safe(p, { homeOk = false } = {}) {
    const real = await fs.realpath(p).catch(() => null);
    const realHome = await fs.realpath(home);
    if (!real) return false;
    const rel = path.relative(realHome, real);
    if (!rel) return homeOk;
    return !rel.startsWith('..') && !path.isAbsolute(rel) && !rel.split(path.sep).some((seg) => seg.startsWith('.'));
  }

  // the entry of `dir` called `name`, whatever its case and accents
  async function child(dir, name) {
    const entries = await fs.readdir(dir).catch(() => []);
    const hit = entries.find((e) => e === name) ?? entries.find((e) => fold(e) === fold(name));
    return hit == null ? null : path.join(dir, hit);
  }

  // a bare name anywhere in home (a few levels down, nothing hidden), the shallowest first, at most two
  async function search(name, dirsOnly) {
    const hits = [];
    const queue = [[home, 0]];
    let seen = 0;
    while (queue.length && hits.length < 2 && seen < SEARCH_MAX) {
      const [dir, depth] = queue.shift();
      const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
      for (const e of entries) {
        seen++;
        if (e.name.startsWith('.') || e.name === 'node_modules') continue;
        const full = path.join(dir, e.name);
        if (fold(e.name) === fold(name) && (!dirsOnly || (await stat(full))?.isDirectory()) && hits.length < 2) hits.push(full);
        if (e.isDirectory() && depth < SEARCH_DEPTH) queue.push([full, depth + 1]);
      }
    }
    return hits;
  }

  // what you wrote ("descargas/pepito.mp4", "~/x", "/home/…", "comercio") → the paths it can be, or []
  async function resolve(text, dirsOnly = false) {
    const t = String(text || '').trim();
    if (!t) return [];
    if (t === '~' || t.startsWith('~/') || path.isAbsolute(t)) {
      const p = t.startsWith('~') ? path.join(home, t.slice(1)) : path.normalize(t);
      return (await there(p)) ? [p] : [];
    }
    const [first, ...segs] = t.split(/[\\/]+/).filter(Boolean);
    let cur = (await child(home, first)) || known[fold(first)] || null;
    for (const seg of segs) cur = cur && (await child(cur, seg));
    if (cur && (await there(cur))) return [cur];
    return segs.length ? [] : search(first, dirsOnly);
  }

  // one way of reading your words → { op, sources, targets, name } or a refusal
  async function build(op, split) {
    if (!split || !Array.isArray(split.sources)) return refuse('unclear');
    const sources = [];
    for (const s of split.sources) {
      const [p] = await resolve(s);
      if (!p) return refuse('missing', s);
      if (!(await safe(p))) return refuse('outside', s);
      sources.push(p);
    }
    if (op !== 'mkdir' && !sources.length) return refuse('unclear');
    if (op === 'trash') return { op, sources, targets: [] };
    if ((op === 'rename' || op === 'extract') && sources.length !== 1) return refuse('unclear');
    if (op === 'rename') {
      if (!goodName(split.name)) return refuse('unclear');
      const name = split.name.trim();
      if (await there(path.join(path.dirname(sources[0]), name))) return refuse('exists', name);
      return { op, sources, targets: [], name };
    }
    if (op === 'extract' && !(await stat(sources[0]))?.isFile()) return refuse('notFolder', path.basename(sources[0]));
    if (op === 'mkdir' && !goodName(split.name)) return refuse('unclear');
    if ((op === 'move' || op === 'copy') && !split.target) return refuse('unclear');

    // where to: what you said, else home (a new folder) or next to the first file
    let places = split.target ? await resolve(split.target, true) : [op === 'mkdir' ? home : path.dirname(sources[0])];
    if (!places.length) return refuse('missing', split.target);
    const dirs = [];
    for (const p of places) if ((await stat(p))?.isDirectory()) dirs.push(p);
    if (!dirs.length) return refuse('notFolder', split.target);
    places = [];
    let why = null;
    for (const dir of dirs) {
      if (!(await safe(dir, { homeOk: true }))) {
        why ??= refuse('outside', split.target);
        continue;
      }
      const realDir = await fs.realpath(dir);
      const into = await Promise.all(sources.map(async (s) => {
        const real = await fs.realpath(s);
        return realDir === real || realDir.startsWith(real + path.sep);
      }));
      if (into.some(Boolean)) {
        why ??= refuse('inside');
        continue;
      }
      // move and copy keep the name, a new folder has yours: not if something has it already
      const names = op === 'mkdir' ? [split.name.trim()] : op === 'move' || op === 'copy' ? sources.map((s) => path.basename(s)) : [];
      const taken = [];
      for (const n of names) if (await there(path.join(dir, n))) taken.push(n);
      if (taken.length) {
        why ??= refuse('exists', taken[0]);
        continue;
      }
      places.push(dir);
    }
    if (!places.length) return why;
    return { op, sources, targets: places, ...(op === 'mkdir' && { name: split.name.trim() }) };
  }

  // { op, splits } (fileAsk) → { id, op, names, to, choices } or { error, name? }: the first split that works
  async function plan(ask) {
    if (!ask || !OPS.has(ask.op) || !Array.isArray(ask.splits)) return refuse('unclear');
    let first = null;
    for (const split of ask.splits) {
      const res = await build(ask.op, split);
      if (res.error) {
        first ??= res;
        continue;
      }
      const id = randomUUID();
      plans.set(id, { ...res, split, at: now() });
      return {
        id,
        op: res.op,
        names: res.op === 'mkdir' ? [res.name] : res.sources.map((s) => path.basename(s)),
        to: res.op === 'rename' ? res.name : res.targets.length ? shown(res.targets[0]) : null,
        choices: PLACED.has(res.op) ? res.targets.map(shown) : [],
      };
    }
    return first || refuse('unclear');
  }

  return { plan };
}

module.exports = { createFileOps, PLAN_TTL_MS };
