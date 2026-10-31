# Capri maneja tus archivos: plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que Capri extraiga, comprima, mueva, copie, renombre, mande a la papelera y cree carpetas cuando se lo pides en el chat, siempre detrás de un botón de confirmación.

**Architecture:** El renderer reconoce la frase con una función pura (`fileAsk` en `chat.js`) y devuelve los cortes posibles del texto. El proceso principal (`src/main/fileops.js`, sin Electron dentro) resuelve las rutas, aplica los límites y guarda un plan con id. El botón del chat ejecuta ese id; main vuelve a comprobar todo antes de tocar el disco.

**Tech Stack:** Electron (CommonJS en main, módulos ES en renderer), `node:fs/promises`, `bsdtar` (`tar` en Windows) vía `execFile`, `shell.trashItem`, `node --test`.

**Spec:** `docs/superpowers/specs/2026-10-30-file-actions-design.md`

## Global Constraints

- Nunca sobrescribir. Mover/copiar/renombrar con destino ocupado → error `exists`. Extraer/comprimir → nombre libre `nombre (2)`, `nombre (3)`…
- Eliminar = `shell.trashItem`. Nada de `fs.rm` salvo el origen de un mover entre discos, después de que la copia haya salido bien.
- Todas las rutas, tras `fs.realpath` (o el realpath de su carpeta madre si aún no existen), quedan dentro de la carpeta personal. No pueden ser la carpeta personal misma ni tener un tramo que empiece por `.`.
- Herramienta de comprimidos: `bsdtar` en Linux y `tar` en Windows, siempre con `execFile` (sin shell) y nunca con `-P`. Comprimir produce siempre `.zip` (`-a -cf`).
- Frases en español e inglés. Las líneas de Capri van en los 5 idiomas de `lines.js` (fr, en, es, pt, ru). Solo strings o arrays de strings, nunca `null`.
- Los planes caducan a los 10 minutos (`PLAN_TTL_MS = 10 * 60 * 1000`).
- Con Claude Code como chat (`this.agent`), nada de esto se activa (`asked()` ya no corre).
- Estado de partida: `node --test tests/` da 53/54. Falla `Codex onboarding…` en `hooks.test.js`, que ya fallaba antes de este trabajo. No hay que arreglarlo, pero tampoco puede aparecer ningún fallo nuevo.

## Review Focus

1. Un nombre con " a " o " y " dentro (`mueve viaje a roma.mp4 a comercio`) → toma el corte cuyo origen existe, no `viaje` → `roma.mp4 a comercio`.
2. Un enlace simbólico dentro de casa que apunta fuera (`~/enlace` → `/etc`) → `outside`, tanto de origen como de destino.
3. El destino aparece entre el plan y el clic (alguien crea `~/Comercio/pepito.mp4`) → `run` devuelve `exists` y no toca nada.
4. Renombrar a un nombre con `/`, `\` o `..` → `unclear`. Si no, renombrar se convertiría en mover a otra parte.
5. Cortesía, puntuación y comillas al final (`Capri, mueve "a b.png" a comercio por favor.`) → origen `a b.png`, destino `comercio`.

---

### Task 0: Rama

- [ ] **Step 1:** `git switch -c file-actions` (el `packaging/arch/PKGBUILD` modificado no es de este trabajo: no lo añadas a ningún commit).

### Task 1: Reconocer la frase (`fileAsk`)

**Files:**
- Modify: `src/renderer/js/chat.js` (junto a `goTarget`, línea ~42)
- Test: `tests/fileops-parse.test.js` (cargado igual que `tests/goto.test.js`, con `globalThis.matchMedia ??= …`)

**Interfaces:**
- Produces: `export function fileAsk(text: string): null | { op: Op, splits: Split[] }`
  - `Op = 'extract' | 'compress' | 'move' | 'copy' | 'rename' | 'trash' | 'mkdir'`
  - `Split = { sources: string[], target: string | null, name?: string }`. Para `rename`, `name` es el nombre nuevo y `target` es `null`. Para `mkdir`, `sources` es `[]`, `name` es la carpeta nueva y `target` la carpeta madre o `null`.
  - `splits`: todos los cortes posibles, en orden. Primero el que corta en el **último** separador de destino (" a ", " en ", " to ", " into ", " como ", " as "), luego los anteriores. Los orígenes se separan por ",", " y ", " and ", salvo lo que va entre comillas.

- [ ] **Step 1: Write the failing tests**

```js
test('the user\'s three phrases', async () => {
  const { fileAsk } = await load();
  assert.deepEqual(fileAsk('Extrae este zip descargas/juego.zip por mi capri'),
    { op: 'extract', splits: [{ sources: ['descargas/juego.zip'], target: null }] });
  assert.deepEqual(fileAsk('Mueve estos archivos a.png, b.png a la carpeta de comercio').splits[0],
    { sources: ['a.png', 'b.png'], target: 'comercio' });
  assert.deepEqual(fileAsk('Elimina este video descargas/pepito.mp4'),
    { op: 'trash', splits: [{ sources: ['descargas/pepito.mp4'], target: null }] });
});
test('every op, Spanish and English', async () => {
  const { fileAsk } = await load();
  assert.equal(fileAsk('descomprime x.rar en descargas').splits[0].target, 'descargas');
  assert.deepEqual(fileAsk('comprime fotos y videos').splits[0], { sources: ['fotos', 'videos'], target: null });
  assert.equal(fileAsk('copia informe.pdf en documentos').op, 'copy');
  assert.equal(fileAsk('pasa x.png a la carpeta comercio').op, 'move');
  assert.deepEqual(fileAsk('cambia el nombre de a.txt a b.txt').splits[0], { sources: ['a.txt'], target: null, name: 'b.txt' });
  assert.deepEqual(fileAsk('renombra a.txt como b.txt').splits[0], { sources: ['a.txt'], target: null, name: 'b.txt' });
  assert.equal(fileAsk('borra x.mp4').op, 'trash');
  assert.equal(fileAsk('manda x.mp4 a la papelera').op, 'trash');
  assert.deepEqual(fileAsk('crea una carpeta llamada Comercio en documentos').splits[0], { sources: [], target: 'documentos', name: 'Comercio' });
  assert.equal(fileAsk('move a.png to downloads').op, 'move');
  assert.equal(fileAsk('delete a.png').op, 'trash');
  assert.equal(fileAsk('unzip game.zip').op, 'extract');
});
test('" a " inside a name: every split, last separator first', async () => {
  const { fileAsk } = await load();
  assert.deepEqual(fileAsk('mueve viaje a roma.mp4 a comercio').splits.map((s) => [s.sources, s.target]),
    [[['viaje a roma.mp4'], 'comercio'], [['viaje'], 'roma.mp4 a comercio']]);
});
test('quotes, politeness, punctuation', async () => {
  const { fileAsk } = await load();
  assert.deepEqual(fileAsk('Capri, mueve "a b.png" a comercio por favor.').splits[0], { sources: ['a b.png'], target: 'comercio' });
  assert.deepEqual(fileAsk('copia ~/x.txt a /home/u/y, porfa!').splits[0], { sources: ['~/x.txt'], target: '/home/u/y' });
});
test('not a file request', async () => {
  const { fileAsk } = await load();
  for (const t of ['mueve el cuerpo', 'copia esto', 'borra eso', 'abre spotify', 'cuéntame un chiste']) assert.equal(fileAsk(t), null, t);
});
```

- [ ] **Step 2:** `node --test tests/fileops-parse.test.js` → FAIL (`fileAsk is not a function`).
- [ ] **Step 3: Implement `fileAsk`.** Verbos por op: un regex al inicio de la frase, después del `capri,` opcional. Las palabras de relleno ("este/estos/esta/estas", "el/la/los/las", "archivo(s)/video/zip/carpeta (de)", "the/this/these/file(s)/folder", "por mí/por mi", "capri") se quitan de los extremos de cada trozo. La cortesía final se quita con el `POLITE_END` existente. Un trozo cuenta como ruta solo si tiene `/`, `~` o un `.ext`, o si va entre comillas, o si es el destino de mover/copiar/extraer/comprimir. Así "mueve el cuerpo" y "borra eso" dan `null`. En `mkdir`, el nombre viene después de "llamada/called" o justo después de "carpeta/folder".
- [ ] **Step 4:** `node --test tests/fileops-parse.test.js` → PASS.
- [ ] **Step 5:** `git add src/renderer/js/chat.js tests/fileops-parse.test.js && git commit -m "Capri entiende frases para manejar archivos"`

### Task 2: Planes y límites (`fileops.js`, sin tocar el disco todavía)

**Files:**
- Create: `src/main/fileops.js`
- Test: `tests/fileops.test.js` (carpeta temporal `fs.mkdtempSync(path.join(os.tmpdir(), 'capri-'))` haciendo de carpeta personal)

**Interfaces:**
- Consumes: el `{ op, splits }` de Task 1.
- Produces: `createFileOps({ home: string, known?: Record<string,string>, trash: (p) => Promise<void>, archiver?: string, now?: () => number })` → `{ plan, run }`
  - `known`: alias en minúsculas y sin tildes → ruta absoluta (`{ downloads: '/home/u/Descargas', descargas: … }`).
  - `plan(ask) → Promise<Plan | Refusal>`
    - `Plan = { id: string, op, names: string[], to: string | null, choices: string[] }`. `names` son los basenames de los orígenes (o el nombre nuevo en mkdir). `to` es el destino mostrado con `~/` (en rename, el nombre nuevo; en trash, `null`). `choices` lista 1 o 2 destinos mostrados con `~/`; hay 2 cuando un nombre suelto de destino coincide con dos carpetas.
    - `Refusal = { error: 'missing' | 'outside' | 'exists' | 'notFolder' | 'inside' | 'unclear', name?: string }`. Se devuelve la del **primer** corte cuando ninguno se resuelve.
  - `run(id, choice = 0)`: Task 3.

- [ ] **Step 1: Write the failing tests** (con `ops = createFileOps({ home, trash: async () => {} })` y estos archivos dentro de `home`: `Descargas/pepito.mp4`, `Descargas/viaje a roma.mp4`, `Documentos/Comercio/`, `Imágenes/`, `.config/x`, y el enlace `enlace` → `/etc`)

```js
test('resolves relative, accents and case, bare folder names', async () => {
  const p = await ops.plan({ op: 'move', splits: [{ sources: ['descargas/pepito.mp4'], target: 'comercio' }] });
  assert.deepEqual([p.names, p.to, p.choices], [['pepito.mp4'], '~/Documentos/Comercio', ['~/Documentos/Comercio']]);
  assert.equal((await ops.plan({ op: 'copy', splits: [{ sources: ['descargas/pepito.mp4'], target: 'imagenes' }] })).to, '~/Imágenes');
});
test('two folders with the same name: two choices', async () => { /* + Descargas/comercio/ → choices.length === 2 */ });
test('first split that resolves wins', async () => {
  const p = await ops.plan({ op: 'move', splits: [
    { sources: ['descargas/viaje a roma.mp4'], target: 'comercio' }, { sources: ['descargas/viaje'], target: 'roma.mp4 a comercio' }] });
  assert.deepEqual(p.names, ['viaje a roma.mp4']);
});
test('refusals', async () => {
  const one = (op, sources, target, name) => ops.plan({ op, splits: [{ sources, target, name }] });
  assert.equal((await one('trash', ['descargas/nada.mp4'])).error, 'missing');
  assert.equal((await one('trash', ['/etc/passwd'])).error, 'outside');
  assert.equal((await one('trash', ['enlace'])).error, 'outside');
  assert.equal((await one('trash', ['.config/x'])).error, 'outside');
  assert.equal((await one('trash', ['~'])).error, 'outside');
  assert.equal((await one('move', ['Documentos'], 'documentos/comercio')).error, 'inside');
  assert.equal((await one('move', ['descargas/pepito.mp4'], 'descargas/pepito.mp4')).error, 'notFolder');
  assert.equal((await one('rename', ['descargas/pepito.mp4'], null, '../x.mp4')).error, 'unclear');
  assert.equal((await one('rename', ['descargas/pepito.mp4'], null, 'a/b.mp4')).error, 'unclear');
  // + Documentos/Comercio/pepito.mp4 existing → move gives 'exists'
});
```

- [ ] **Step 2:** `node --test tests/fileops.test.js` → FAIL (`Cannot find module`).
- [ ] **Step 3: Implement `createFileOps` and `plan`.** Resolver según 4.2 del spec. Para un nombre suelto que no está en la raíz de casa: recorrido en anchura propio, sin `app.getPath` para poder probarlo. Profundidad 5, se salta lo oculto y `node_modules`, como mucho 40000 entradas, nombre exacto comparado con `normalize('NFKD')` sin tildes y en minúsculas, el menos profundo primero. Este recorrido sustituye al `walked()` que nombra el spec, que depende de Electron. Comprobación de "dentro de casa" con `path.relative(realHome, real)`: no puede empezar por `..`, no puede estar vacío y ningún tramo puede empezar por `.`. Los planes van a un `Map` con `id = crypto.randomUUID()`, guardan las rutas absolutas resueltas y el `now()` de creación.
- [ ] **Step 4:** `node --test tests/fileops.test.js` → PASS.
- [ ] **Step 5:** `git add src/main/fileops.js tests/fileops.test.js && git commit -m "fileops: rutas, límites y planes"`

### Task 3: Hacerlo (`run`)

**Files:**
- Modify: `src/main/fileops.js`
- Test: `tests/fileops.test.js`

**Interfaces:**
- Produces: `run(id: string, choice = 0) → Promise<{ ok: true, path: string | null } | { ok: false, error: Refusal['error'] | 'expired' | 'noTool' | 'failed', name?: string, message?: string }>`. `path` es la ruta absoluta del resultado (la carpeta extraída, el zip, el archivo movido o la carpeta creada; en trash, `null`). Un plan se ejecuta una sola vez: después se borra del `Map`.

- [ ] **Step 1: Write the failing tests**

```js
test('move, copy, rename, mkdir, trash', async () => { /* each run → ok, file where expected; trash: the fake trash got the absolute path */ });
test('extract and compress with bsdtar, free names', async () => {
  // fixture zip made in the test: execFileSync('bsdtar', ['-a', '-cf', zip, '-C', dir, 'a.txt'])
  // extract twice → Descargas/juego/ then Descargas/juego (2)/, both with a.txt
  // compress ['descargas/pepito.mp4'] → Descargas/pepito.zip; two sources → Archivos.zip in the first one's folder;
  // compress with target 'documentos' → Documentos/pepito.zip; extract with target 'documentos' → Documentos/juego/
});
test('target appears between plan and click: no overwrite', async () => {
  const p = await ops.plan({ op: 'move', splits: [{ sources: ['descargas/pepito.mp4'], target: 'comercio' }] });
  fs.writeFileSync(path.join(home, 'Documentos/Comercio/pepito.mp4'), 'otro');
  assert.equal((await ops.run(p.id)).error, 'exists');
  assert.equal(fs.readFileSync(path.join(home, 'Documentos/Comercio/pepito.mp4'), 'utf8'), 'otro');
  assert.ok(fs.existsSync(path.join(home, 'Descargas/pepito.mp4')));
});
test('expired, unknown and reused ids', async () => { /* now() + 10 min + 1 → 'expired'; unknown id → 'expired'; second run of the same id → 'expired' */ });
test('no archiver', async () => { /* createFileOps({ …, archiver: 'no-such-tool' }) extract → 'noTool' */ });
```

- [ ] **Step 2:** `node --test tests/fileops.test.js` → FAIL.
- [ ] **Step 3: Implement `run`.** Antes de hacer nada se vuelven a pasar las comprobaciones de `plan`. Para no sobrescribir: `fs.rename` después de comprobar que el destino no existe, y `fs.cp(src, dst, { recursive: true, errorOnExist: true, force: false })`. Si mover da `EXDEV`, se copia con `cp` y luego `fs.rm(src, { recursive: true })`, en ese orden. Extraer: `mkdir` de la carpeta libre y luego `execFile(archiver, ['-xf', src, '-C', dir])`. El nombre se saca quitando `.tar.gz|.tar.xz|.tar.bz2|.tgz` o la última extensión. Comprimir: `execFile(archiver, ['-a', '-cf', out, ...sources.flatMap((s) => ['-C', path.dirname(s), path.basename(s)])])`. `ENOENT` del ejecutable → `noTool`. Cualquier otro fallo → `failed` con `message`.
- [ ] **Step 4:** `node --test tests/fileops.test.js` → PASS.
- [ ] **Step 5:** `git commit -am "fileops: mover, copiar, renombrar, papelera, carpetas y comprimidos"`

### Task 4: Conectarlo al chat

**Files:**
- Modify: `src/main/files.js` (exportar `allow(p)`, que hace `found.add(p)`)
- Modify: `src/main/main.js` (junto a `files:search`, línea ~933)
- Modify: `src/preload.js` (junto a `searchFiles`, línea ~71)
- Modify: `src/renderer/js/chat.js`: `asked()`, `doNow()`, `after()` y `powers()`
- Modify: `src/renderer/js/lines.js`: un bloque `chat.fileop` en los 5 idiomas

**Interfaces:**
- Consumes: `fileAsk` (Task 1), `createFileOps` / `plan` / `run` (Tasks 2-3).
- Produces:
  - IPC `fileops:plan` (ask) → `Plan | Refusal`, y `fileops:run` ({ id, choice }) → resultado de `run`. Si sale bien, main llama `files.allow(path)`.
  - Preload: `planFileOp(ask)`, `runFileOp(id, choice)`.
  - `chat.fileop` en `lines.js`: `verbs: { extract, compress, move, copy, rename, trash, mkdir }`, `plan: '{verb} {what} → {to}'`, `planHere: '{verb} {what}'`, `many: '{count} archivos ({list})'`, `doIt`, `doTo: '{verb} → {to}'`, `done: 'Hecho: {path}.'` (`{path}` con `~/`), `trashed: '{what}: a la papelera.'`, `failed: 'No pude: {why}'`, `errors: { missing, outside, exists, notFolder, inside, unclear, expired, noTool }` (con `{name}` donde aplique). Texto con la voz de Capri, un poco burlona.

- [ ] **Step 1: main y preload.** Crear la instancia una vez: `createFileOps({ home: app.getPath('home'), known, trash: (p) => shell.trashItem(p), archiver: process.platform === 'win32' ? 'tar' : 'bsdtar' })`. `known` sale de `app.getPath` para downloads, documents, desktop, pictures, music y videos, indexado por la clave en inglés y por el basename normalizado. Validar en el handler que `ask.op` es uno de los siete y que `splits` es un array de como mucho 20 elementos con strings; si no, `{ error: 'unclear' }`.
- [ ] **Step 2: chat.js.** En `asked()`, justo después de `if (SHOT_ASK…)`: `const ask = fileAsk(text); if (ask) return { kind: 'fileop', ask };`. En `doNow()`: `planFileOp`. Si es un `Refusal` → `{ line: fmt(t.fileop.errors[error], { name }), face: 'aside' }`. Si es un `Plan` → `{ fileop: plan }`. En `after()`, junto a `done?.offer`: `if (done?.fileop) return this.offerFileOp(done.fileop, answer)`. `offerFileOp` añade la línea del plan con `addLine`, pone un botón por cada `choices[i]` (el primero `primary`, con `doIt` si hay uno solo y `doTo` si hay dos) más `t.no`. Al pulsar, `runFileOp`; luego `addLine` de `done`/`trashed`/error, y si hay `path`, un botón `t.showFolder` → `host.openFile(path, true)`. En `powers()`: el texto del spec 4.5, y en la línea "you can't touch anything else… (settings, files)" quitar "files".
- [ ] **Step 3: lines.js.** El bloque `chat.fileop` en fr, en, es, pt y ru.
- [ ] **Step 4:** `node --test tests/` → 53 de los anteriores siguen pasando, más los nuevos. El único fallo sigue siendo `Codex onboarding…`, que recorre todas las líneas: comprueba que su mensaje de error es el mismo que antes del cambio (el bloque nuevo no puede tener un valor que no sea string ni array).
- [ ] **Step 5: A mano.** `npm start` en Hyprland con Ollama, y dentro de una carpeta de prueba `~/capri-prueba/` con un zip, un mp4 y una subcarpeta `comercio`. Probar las tres frases del usuario y un renombrar: botón, clic, resultado en el disco, el mp4 en la papelera (`~/.local/share/Trash/files`) y "Ver la carpeta" abre el gestor.
- [ ] **Step 6:** `git add src/main/files.js src/main/main.js src/preload.js src/renderer/js/chat.js src/renderer/js/lines.js && git commit -m "Capri maneja tus archivos desde el chat, con confirmación"`
