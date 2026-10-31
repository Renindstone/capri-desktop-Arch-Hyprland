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
  assert.deepEqual([p.op, p.names, p.to, p.choices], ['move', ['pepito.mp4'], '~/Documentos/Comercio', ['~/Documentos/Comercio']]);
  assert.match(p.id, /\S/);
  assert.equal((await one(ops, 'copy', ['descargas/pepito.mp4'], 'imagenes')).to, '~/Imágenes');
  assert.equal((await one(ops, 'trash', ['~/Descargas/pepito.mp4'])).to, null);
});

test('known folders by their English name', async () => {
  const { home, ops } = setup({ known: { downloads: null } });
  const ops2 = createFileOps({ home, trash: async () => {}, known: { downloads: path.join(home, 'Descargas') } });
  assert.deepEqual((await one(ops2, 'trash', ['downloads/pepito.mp4'])).names, ['pepito.mp4']);
  assert.equal((await one(ops, 'trash', ['downloads/pepito.mp4'])).error, 'missing');
});

test('a bare source name is looked for too', async () => {
  const { ops } = setup();
  assert.deepEqual((await one(ops, 'trash', ['pepito.mp4'])).names, ['pepito.mp4']);
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
  assert.deepEqual(p.names, ['viaje a roma.mp4']);
  const q = await ops.plan({ op: 'move', splits: [{ sources: ['descargas/viaje'], target: 'roma.mp4 a comercio' }, { sources: ['descargas/pepito.mp4'], target: 'comercio' }] });
  assert.deepEqual(q.names, ['pepito.mp4']);
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
  assert.deepEqual([r.names, r.to], [['pepito.mp4'], 'juan.mp4']);
  const m = await one(ops, 'mkdir', [], 'documentos', 'Ventas');
  assert.deepEqual([m.names, m.to], [['Ventas'], '~/Documentos']);
  assert.equal((await one(ops, 'mkdir', [], null, 'Nueva')).to, '~');
});
