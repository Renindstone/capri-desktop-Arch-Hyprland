'use strict';

// The user's own phrases, from what they said to her (memory.json, 2026-10-30), through the parser and a plan
// in a home made for the test.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { createFileOps } = require('../src/main/fileops');

globalThis.matchMedia ??= () => ({ matches: false });
const load = () => import(pathToFileURL(path.join(__dirname, '../src/renderer/js/chat.js')).href);

function setup() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'capri-'));
  fs.mkdirSync(path.join(home, 'Documentos/ClaudeCositas'), { recursive: true });
  fs.mkdirSync(path.join(home, 'Documentos/Dos'), { recursive: true });
  fs.mkdirSync(path.join(home, 'Documentos/Nada'), { recursive: true });
  for (const f of ['ClaudeCositas/3agentes.zip', 'Dos/a.zip', 'Dos/b.rar', 'Nada/x.txt']) fs.writeFileSync(path.join(home, 'Documentos', f), 'x');
  return { home, ops: createFileOps({ home, trash: async () => {} }) };
}
const said = async (text) => {
  const { fileAsk } = await load();
  const { home, ops } = setup();
  const ask = fileAsk(text.replaceAll('$HOME', home));
  return ask && ops.plan(ask);
};
const ZIP = ['~/Documentos/ClaudeCositas/3agentes.zip'];

test('"el zip que hay en <folder>", with a nickname at the end', async () => {
  const p = await said('Extrae el zip que hay en $HOME/Documentos/ClaudeCositas causita');
  assert.deepEqual([p.op, p.names, p.to], ['extract', ZIP, '~/Documentos/ClaudeCositas']);
});

test('"en la misma carpeta", "ahí mismo", "aquí": next to the zip', async () => {
  for (const t of ['Extrae $HOME/Documentos/ClaudeCositas/3agentes.zip en la misma carpeta causita',
    'extrae documentos/ClaudeCositas/3agentes.zip ahí mismo nomás :v', 'extrae documentos/claudecositas/3agentes.zip aquí']) {
    const p = await said(t);
    assert.deepEqual([p.names, p.to], [ZIP, '~/Documentos/ClaudeCositas'], t);
  }
});

test('asked, not ordered: "puedes extraer…?", "quiero que extraigas…"', async () => {
  for (const t of ['puedes extraer documentos/ClaudeCositas/3agentes.zip?', 'quiero que extraigas documentos/ClaudeCositas/3agentes.zip',
    'Capri, me puedes mover documentos/ClaudeCositas/3agentes.zip a la carpeta dos?', 'podrías borrar documentos/nada/x.txt']) {
    const p = await said(t);
    assert.ok(p?.id, `${t} → ${JSON.stringify(p)}`);
  }
});

test('a folder to extract from: its one archive, else why not', async () => {
  assert.deepEqual((await said('extrae documentos/ClaudeCositas')).names, ZIP);
  assert.deepEqual(await said('extrae documentos/dos'), { error: 'manyArchives', name: 'documentos/dos' });
  assert.deepEqual(await said('extrae documentos/nada'), { error: 'noArchive', name: 'documentos/nada' });
});

test('about files but not understood: she says so instead of nothing', async () => {
  const { fileHint } = await load();
  for (const t of ['me refiero a q lo extraigas ahi mismo nomas :v', 'descomprímelo porfa', 'mueve el archivo ese a otra carpeta']) assert.equal(fileHint(t), true, t);
  for (const t of ['cuéntame un chiste', 'mueve la reunión al viernes', 'el 3agentes.zip', 'borra eso de tu memoria']) assert.equal(fileHint(t), false, t);
});
