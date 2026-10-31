'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createFileOps } = require('../src/main/fileops');

// a fresh home: Descargas/pepito.mp4, Descargas/viaje a roma.mp4, Documentos/Comercio/, Imágenes/,
// .config/x and enlace → /etc
function setup(opts = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'capri-'));
  const put = (rel, body) => {
    const full = path.join(home, rel);
    fs.mkdirSync(body == null ? full : path.dirname(full), { recursive: true });
    if (body != null) fs.writeFileSync(full, body);
  };
  put('Descargas/pepito.mp4', 'video');
  put('Descargas/viaje a roma.mp4', 'roma');
  put('Documentos/Comercio');
  put('Imágenes');
  put('.config/x', 'secret');
  fs.symlinkSync('/etc', path.join(home, 'enlace'));
  const trashed = [];
  const ops = createFileOps({ home, trash: async (p) => { trashed.push(p); }, ...opts });
  return { home, put, ops, trashed };
}
const one = (ops, op, sources, target = null, name) => ops.plan({ op, splits: [{ sources, target, ...(name && { name }) }] });

test('resolves relative, accents and case, bare folder names', async () => {
  const { ops } = setup();
  const p = await one(ops, 'move', ['descargas/pepito.mp4'], 'comercio');
  assert.deepEqual([p.op, p.names, p.to, p.choices], ['move', ['~/Descargas/pepito.mp4'], '~/Documentos/Comercio', ['~/Documentos/Comercio']]);
  assert.match(p.id, /\S/);
  assert.equal((await one(ops, 'copy', ['descargas/pepito.mp4'], 'imagenes')).to, '~/Imágenes');
  assert.equal((await one(ops, 'trash', ['~/Descargas/pepito.mp4'])).to, null);
});

test('known folders by their English name', async () => {
  const { home, ops } = setup({ known: { downloads: null } });
  const ops2 = createFileOps({ home, trash: async () => {}, known: { downloads: path.join(home, 'Descargas') } });
  assert.deepEqual((await one(ops2, 'trash', ['downloads/pepito.mp4'])).names, ['~/Descargas/pepito.mp4']);
  assert.equal((await one(ops, 'trash', ['downloads/pepito.mp4'])).error, 'missing');
});

test('a bare source name is looked for too', async () => {
  const { ops } = setup();
  assert.deepEqual((await one(ops, 'trash', ['pepito.mp4'])).names, ['~/Descargas/pepito.mp4']);
});

test('two folders with the same name: two choices', async () => {
  const { put, ops } = setup();
  put('Descargas/comercio');
  const p = await one(ops, 'move', ['descargas/pepito.mp4'], 'comercio');
  assert.equal(p.choices.length, 2);
  assert.ok(p.choices.includes('~/Documentos/Comercio') && p.choices.includes('~/Descargas/comercio'));
});

test('first split that resolves wins', async () => {
  const { ops } = setup();
  const p = await ops.plan({ op: 'move', splits: [
    { sources: ['descargas/viaje a roma.mp4'], target: 'comercio' }, { sources: ['descargas/viaje'], target: 'roma.mp4 a comercio' }] });
  assert.deepEqual(p.names, ['~/Descargas/viaje a roma.mp4']);
  const q = await ops.plan({ op: 'move', splits: [{ sources: ['descargas/viaje'], target: 'roma.mp4 a comercio' }, { sources: ['descargas/pepito.mp4'], target: 'comercio' }] });
  assert.deepEqual(q.names, ['~/Descargas/pepito.mp4']);
});

test('refusals', async () => {
  const { put, ops } = setup();
  assert.deepEqual(await one(ops, 'trash', ['descargas/nada.mp4']), { error: 'missing', name: 'descargas/nada.mp4' });
  assert.equal((await one(ops, 'trash', ['/etc/passwd'])).error, 'outside');
  assert.equal((await one(ops, 'trash', ['enlace'])).error, 'outside');
  assert.equal((await one(ops, 'move', ['descargas/pepito.mp4'], 'enlace')).error, 'outside');
  assert.equal((await one(ops, 'trash', ['.config/x'])).error, 'outside');
  assert.equal((await one(ops, 'trash', ['~'])).error, 'outside');
  assert.equal((await one(ops, 'move', ['Documentos'], 'documentos/comercio')).error, 'inside');
  assert.equal((await one(ops, 'move', ['descargas/pepito.mp4'], 'descargas/pepito.mp4')).error, 'notFolder');
  assert.equal((await one(ops, 'rename', ['descargas/pepito.mp4'], null, '../x.mp4')).error, 'unclear');
  assert.equal((await one(ops, 'rename', ['descargas/pepito.mp4'], null, 'a/b.mp4')).error, 'unclear');
  assert.equal((await one(ops, 'rename', ['descargas/pepito.mp4'], null, '.oculto')).error, 'unclear');
  assert.equal((await one(ops, 'rename', ['descargas/pepito.mp4'], null, 'viaje a roma.mp4')).error, 'exists');
  assert.equal((await one(ops, 'mkdir', [], 'documentos', 'Comercio')).error, 'exists');
  put('Documentos/Comercio/pepito.mp4', 'otro');
  assert.deepEqual(await one(ops, 'move', ['descargas/pepito.mp4'], 'comercio'), { error: 'exists', name: 'pepito.mp4' });
  assert.equal((await ops.plan({ op: 'nope', splits: [] })).error, 'unclear');
});

test('rename and mkdir plans', async () => {
  const { ops } = setup();
  const r = await one(ops, 'rename', ['descargas/pepito.mp4'], null, 'juan.mp4');
  assert.deepEqual([r.names, r.to], [['~/Descargas/pepito.mp4'], 'juan.mp4']);
  const m = await one(ops, 'mkdir', [], 'documentos', 'Ventas');
  assert.deepEqual([m.names, m.to], [['Ventas'], '~/Documentos']);
  assert.equal((await one(ops, 'mkdir', [], null, 'Nueva')).to, '~');
});

const { execFileSync } = require('node:child_process');
const at = (home, rel) => path.join(home, rel);

test('move, copy, rename, mkdir, trash', async () => {
  const { home, ops, trashed } = setup();
  const mv = await one(ops, 'move', ['descargas/pepito.mp4'], 'comercio');
  assert.deepEqual(await ops.run(mv.id), { ok: true, path: at(home, 'Documentos/Comercio/pepito.mp4') });
  assert.ok(!fs.existsSync(at(home, 'Descargas/pepito.mp4')));
  const cp = await one(ops, 'copy', ['documentos/comercio/pepito.mp4'], 'descargas');
  assert.equal((await ops.run(cp.id)).path, at(home, 'Descargas/pepito.mp4'));
  assert.equal(fs.readFileSync(at(home, 'Documentos/Comercio/pepito.mp4'), 'utf8'), 'video');
  const rn = await one(ops, 'rename', ['descargas/pepito.mp4'], null, 'juan.mp4');
  assert.equal((await ops.run(rn.id)).path, at(home, 'Descargas/juan.mp4'));
  const mk = await one(ops, 'mkdir', [], 'documentos', 'Ventas');
  assert.equal((await ops.run(mk.id)).path, at(home, 'Documentos/Ventas'));
  assert.ok(fs.statSync(at(home, 'Documentos/Ventas')).isDirectory());
  const tr = await one(ops, 'trash', ['descargas/juan.mp4', 'documentos/ventas']);
  assert.deepEqual(await ops.run(tr.id), { ok: true, path: null });
  assert.deepEqual(trashed, [at(home, 'Descargas/juan.mp4'), at(home, 'Documentos/Ventas')]);
});

test('the second choice', async () => {
  const { home, put, ops } = setup();
  put('Descargas/comercio');
  const p = await one(ops, 'copy', ['descargas/pepito.mp4'], 'comercio');
  const i = p.choices.indexOf('~/Descargas/comercio');
  assert.equal((await ops.run(p.id, i)).path, at(home, 'Descargas/comercio/pepito.mp4'));
});

test('extract and compress with bsdtar, free names', async () => {
  const { home, put, ops } = setup();
  put('src/a.txt', 'hola');
  execFileSync('bsdtar', ['-a', '-cf', at(home, 'Descargas/juego.zip'), '-C', at(home, 'src'), 'a.txt']);
  const x1 = await ops.run((await one(ops, 'extract', ['descargas/juego.zip'])).id);
  assert.deepEqual(x1, { ok: true, path: at(home, 'Descargas/juego') });
  assert.equal(fs.readFileSync(at(home, 'Descargas/juego/a.txt'), 'utf8'), 'hola');
  assert.equal((await ops.run((await one(ops, 'extract', ['descargas/juego.zip'])).id)).path, at(home, 'Descargas/juego (2)'));
  assert.equal((await ops.run((await one(ops, 'extract', ['descargas/juego.zip'], 'documentos')).id)).path, at(home, 'Documentos/juego'));
  const c1 = await ops.run((await one(ops, 'compress', ['descargas/pepito.mp4'])).id);
  assert.equal(c1.path, at(home, 'Descargas/pepito.zip'));
  assert.match(execFileSync('bsdtar', ['-tf', c1.path], { encoding: 'utf8' }), /^pepito\.mp4$/m);
  assert.equal((await ops.run((await one(ops, 'compress', ['descargas/pepito.mp4'])).id)).path, at(home, 'Descargas/pepito (2).zip'));
  const c2 = await ops.run((await one(ops, 'compress', ['descargas/pepito.mp4', 'imágenes'])).id);
  assert.equal(c2.path, at(home, 'Descargas/Archivos.zip'));
  assert.equal((await ops.run((await one(ops, 'compress', ['descargas/pepito.mp4'], 'documentos')).id)).path, at(home, 'Documentos/pepito.zip'));
  execFileSync('bsdtar', ['-czf', at(home, 'Descargas/x.tar.gz'), '-C', at(home, 'src'), 'a.txt']);
  assert.equal((await ops.run((await one(ops, 'extract', ['descargas/x.tar.gz'])).id)).path, at(home, 'Descargas/x'));
});

test('target appears between plan and click: no overwrite', async () => {
  const { home, ops } = setup();
  const p = await one(ops, 'move', ['descargas/pepito.mp4'], 'comercio');
  fs.writeFileSync(at(home, 'Documentos/Comercio/pepito.mp4'), 'otro');
  assert.equal((await ops.run(p.id)).error, 'exists');
  assert.equal(fs.readFileSync(at(home, 'Documentos/Comercio/pepito.mp4'), 'utf8'), 'otro');
  assert.ok(fs.existsSync(at(home, 'Descargas/pepito.mp4')));
});

test('expired, unknown and reused ids', async () => {
  let t = 0;
  const { ops } = setup({ now: () => t });
  const p = await one(ops, 'trash', ['descargas/pepito.mp4']);
  t = 10 * 60 * 1000 + 1;
  assert.equal((await ops.run(p.id)).error, 'expired');
  assert.equal((await ops.run('nope')).error, 'expired');
  const q = await one(ops, 'trash', ['descargas/pepito.mp4']);
  assert.equal((await ops.run(q.id)).ok, true);
  assert.equal((await ops.run(q.id)).error, 'expired');
});

test('no archiver', async () => {
  const { home, put, ops } = setup({ archiver: 'no-such-tool' });
  put('Descargas/juego.zip', 'x');
  assert.equal((await ops.run((await one(ops, 'extract', ['descargas/juego.zip'])).id)).error, 'noTool');
  assert.ok(!fs.existsSync(at(home, 'Descargas/juego')));
});

test('a failed extraction leaves nothing behind', async () => {
  const { home, put, ops } = setup();
  put('Descargas/roto.zip', 'not a zip');
  const r = await ops.run((await one(ops, 'extract', ['descargas/roto.zip'])).id);
  assert.equal(r.error, 'failed');
  assert.ok(!fs.existsSync(at(home, 'Descargas/roto')));
});

test('review: two sources with the same name never overwrite each other', async () => {
  const { home, put, ops } = setup();
  put('A/foto.png', 'a');
  put('B/foto.png', 'b');
  assert.deepEqual(await one(ops, 'move', ['A/foto.png', 'B/foto.png'], 'comercio'), { error: 'exists', name: 'foto.png' });
  assert.equal((await one(ops, 'copy', ['A/foto.png', 'B/foto.png'], 'comercio')).error, 'exists');
  assert.equal(fs.readFileSync(at(home, 'A/foto.png'), 'utf8'), 'a');
});

test('review: a name starting with - is a file to bsdtar, not an option', async () => {
  const { home, put, ops } = setup();
  put('Descargas/-rf.txt', 'x');
  const r = await ops.run((await one(ops, 'compress', ['descargas/-rf.txt', 'descargas/pepito.mp4'])).id);
  assert.equal(r.ok, true, r.message);
  assert.match(execFileSync('bsdtar', ['-tf', r.path], { encoding: 'utf8' }), /-rf\.txt/);
});

test('review: the confirm line says where the files are', async () => {
  const { ops } = setup();
  assert.deepEqual((await one(ops, 'trash', ['pepito.mp4'])).names, ['~/Descargas/pepito.mp4']);
});

test('review: the refusal reported is the one about the trimmed name', async () => {
  const { ops } = setup();
  const p = await ops.plan({ op: 'trash', splits: [{ sources: ['este video descargas/nada.mp4'], target: null, raw: true }, { sources: ['descargas/nada.mp4'], target: null }] });
  assert.deepEqual(p, { error: 'missing', name: 'descargas/nada.mp4' });
});
