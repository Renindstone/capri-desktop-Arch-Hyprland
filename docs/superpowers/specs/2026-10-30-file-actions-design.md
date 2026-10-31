# Capri maneja tus archivos: diseño

Fecha: 2026-10-30. Fork: `Renindstone/capri-desktop` (v0.4.4), copia local en
`/home/renindstone/Proyectos/Claude/capri-desktop`.

Lo marcado **[decisión del usuario]** lo pidió él. Lo marcado **[decisión mía]** lo decidí yo y él puede
cambiarlo al revisar. Lo demás son hechos comprobados en su máquina o en el código.

## 1. Intención

El dueño quiere pedirle a Capri en el chat que haga cosas con sus archivos, como haría con un ayudante:
"Extrae este zip por mí, Capri", "Mueve estos archivos a la carpeta de comercio", "Elimina este video
descargas/pepito.mp4". Hoy Capri solo sabe **buscar** y **abrir** archivos (`src/main/files.js`). Si le pides
otra cosa, su prompt le dice que conteste que no puede (`powers()` en `src/renderer/js/chat.js`).

Éxito: dice la frase, Capri le enseña qué va a hacer, él pulsa un botón y ya está hecho, sin abrir el
gestor de archivos ni la terminal.

## 2. Objetivos, no objetivos y anti-objetivos

**Objetivos** **[decisión del usuario]**

- Siete acciones: **extraer** un comprimido, **comprimir** archivos o carpetas, **mover**, **copiar**,
  **renombrar**, **eliminar** y **crear carpeta**.
- Él dice qué archivos con una **ruta** o con el **nombre de una carpeta**. Capri no adivina "este" por lo
  que tengas seleccionado o acabes de descargar.
- **Botón de confirmación** antes de hacer nada.
- **Eliminar = papelera**, nunca borrado definitivo.

**No objetivos** **[decisión mía]**

- Deshacer (salvo eliminar, que se recupera desde la papelera).
- Comodines y filtros ("los .mp4 de descargas", `*.mp4`).
- Saber qué tienes seleccionado en el gestor de archivos, o arrastrarle archivos encima.
- Frases en francés, portugués o ruso. Las frases se reconocen en español e inglés. Sus líneas de respuesta
  sí van en todos sus idiomas, como el resto de `lines.js`.
- Cuando el chat va por **Claude Code** (`this.agent`), Capri no interpreta nada: Claude hace las cosas a su
  manera, como ya pasa con todo lo demás.

**Anti-objetivos**: sería un fracaso aunque funcione si…

- borra algo para siempre, sobrescribe un archivo existente o actúa sin que pulses el botón;
- toca algo fuera de tu carpeta personal;
- dice "hecho" cuando no lo hizo, o hace algo distinto de lo que mostraba el botón.

## 3. Restricciones

- Su chat va con **Ollama**, un modelo local pequeño (`provider: "ollama"` en su `config.json`). No se
  puede confiar en que escriba bien una etiqueta. Por eso **[decisión mía]** las frases se reconocen con
  expresiones regulares en `asked()` de `chat.js`, igual que "busca mi CV" o "haz una captura". El modelo
  solo pone la personalidad.
- El sistema que importa es **CachyOS + Hyprland**. El código tiene que seguir arrancando en Windows, que es
  la plataforma del proyecto original.
- Comprimidos: `bsdtar` (libarchive) viene en Arch, porque pacman depende de él, y extrae zip, rar, 7z y tar.
  En Windows 10+, `tar.exe` es ese mismo bsdtar. **[decisión mía]** Se usa una sola herramienta para todo:
  `bsdtar` en Linux y `tar` en Windows. El GNU `tar` de Linux no sirve, porque no maneja zip. Comprimir
  siempre genera `.zip` (`-a -cf nombre.zip`).
- Papelera: `shell.trashItem()` de Electron, que funciona con archivos y carpetas en Linux y Windows.
- El proceso principal no se fía del renderer. Ya lo hace así `files.js`, que solo abre rutas que él mismo
  encontró (`found`). Aquí pasa igual: **main** resuelve las rutas y arma el plan; el botón solo ejecuta un
  plan que main ya aprobó, identificado por su id.

## 4. Cómo funciona

### 4.1 Frases

Ejemplos de lo que tiene que entender (y sus equivalentes en inglés):

| Acción | Frases |
|---|---|
| extraer | "extrae descargas/juego.zip", "descomprime X", "extrae X en Y" |
| comprimir | "comprime X", "comprime X y Z", "comprime X en Y" (Y: carpeta destino) |
| mover | "mueve X a Y", "mueve X y Z a Y", "pasa X a la carpeta Y" |
| copiar | "copia X a Y", "copia X en Y" |
| renombrar | "renombra X a N", "renombra X como N", "cambia el nombre de X a N" |
| eliminar | "elimina X", "borra X", "manda X a la papelera" |
| crear carpeta | "crea una carpeta llamada N", "crea la carpeta N en Y" |

- Pueden ir antes o después de "Capri," y con "por mí", "por favor" o "porfa" al final, como las demás frases
  (`POLITE_END`).
- Una carpeta como origen es **la carpeta entera**: "mueve descargas/fotos a comercio" deja
  `~/Comercio/fotos`. **[decisión del usuario]** Mover solo lo que hay dentro queda fuera por ahora (va con
  los comodines de los no objetivos).
- Varios archivos van separados por comas o por "y".
- Se aceptan rutas entre comillas (`"mis fotos/a b.png"`).
- Sin comillas, un nombre puede contener " a " o " y " ("viaje a roma.mp4"). **[decisión mía]** El intérprete
  prueba los cortes posibles y se queda con el primero en el que las rutas de origen existen. El reconocedor
  (renderer) devuelve la acción y la lista de cortes candidatos (`[{ sources: [...], target }]`), en orden.
  Main, que sí puede mirar el disco, elige el primero que se resuelve.
- Palabras de relleno que se ignoran: "este", "estos", "el archivo", "el video", "la carpeta (de)", etc.
  "la carpeta de comercio" equivale a "comercio".

El reconocedor debe ser una función pura exportada desde `chat.js` (como `goTarget`), para poder probarla
con `node --test`.

### 4.2 Resolver rutas **[decisión mía]**

1. `/…` y `~/…`: tal cual (con `~` = carpeta personal).
2. Relativa (`descargas/pepito.mp4`): desde la carpeta personal. El primer tramo se compara sin mayúsculas
   ni tildes con lo que hay en ella (`descargas` → `~/Descargas`), y además se aceptan los nombres en inglés
   de las carpetas XDG (`downloads` → `app.getPath('downloads')`, lo mismo con documents, desktop, pictures,
   music y videos).
3. Un nombre solo, sin `/` ("comercio", "pepito.mp4"): primero en la carpeta personal. Si no está ahí, se
   busca por nombre exacto (sin mayúsculas ni tildes) con el recorrido de `walked()` en `files.js`: archivos
   o carpetas si es un origen, solo carpetas si es un destino. Si hay varias, el botón
   ofrece hasta dos con su ruta completa ("Mover a ~/Documentos/Comercio" / "Mover a ~/Descargas/comercio").

### 4.3 Límites que main comprueba siempre

- Todas las rutas, una vez resueltas (`fs.realpath`, para que un enlace no saque de ahí), quedan **dentro de
  la carpeta personal**, sin ser la carpeta personal misma, y **sin ningún tramo oculto** (`~/.config`,
  `~/.ssh`…). **[decisión mía]**
- El origen existe. El destino de mover o copiar es una carpeta que existe.
- **Nunca sobrescribe.** En mover, copiar y renombrar, si en el destino ya hay algo con ese nombre, Capri
  lo dice y no hace nada, porque el nombre lo eligió él. En extraer y comprimir, el nombre lo pone Capri,
  así que elige uno libre (`juego (2)`). **[decisión mía]**
- Mover una carpeta dentro de sí misma: se rechaza.
- Mover entre discos: `fs.rename` da `EXDEV`. En ese caso se copia y, solo si la copia salió bien, se borra
  el origen.
- Extraer: va a una carpeta nueva junto al comprimido, con su nombre sin extensión (`juego.zip` → `juego/`,
  `x.tar.gz` → `x/`). bsdtar ya rechaza rutas absolutas y `..` dentro del comprimido. No se le pasa `-P`.
- Comprimir: un solo archivo o carpeta → `nombre.zip` a su lado. Varios → `Archivos.zip` en la carpeta del
  primero, o en Y si se dijo "en Y".

### 4.4 Confirmar y hacer

1. Mientras Capri responde con su personalidad, debajo aparece la línea del plan con los botones, igual que
   hoy en `after()` con `done.offer` o `done.files`:
   "Mover pepito.mp4 → ~/Comercio" · [Hacerlo] [No]. Si son varios: "Mover 3 archivos (a.png, b.png, c.png)
   → ~/Comercio".
2. Si no se puede (no existe, está fuera de casa, ya existe en el destino), en vez del plan sale una línea que
   dice por qué, sin botón.
3. Al pulsar: main vuelve a comprobar los límites (algo pudo cambiar entretanto), lo hace y devuelve el
   resultado. Capri dice "Hecho: …" o el error real, y ofrece [Mostrar carpeta] (`openFile(path, true)`,
   que ya existe) con el resultado. Para que deje abrirlo, la ruta resultante se añade al `found` de `files.js`.
4. Los planes caducan a los 10 minutos o cuando llega un mensaje nuevo, igual que hoy, que un mensaje nuevo
   quita los botones anteriores (`setActions([])`).

### 4.5 El prompt

`powers()` hoy le dice que no puede tocar archivos. Hay que cambiarlo: "tu sistema también extrae,
comprime, mueve, copia, renombra, elimina (a la papelera) y crea carpetas cuando te lo piden con la ruta;
se muestra un botón para confirmar debajo de tu respuesta, así que nunca digas que ya está hecho".

### 4.6 Piezas

- `src/main/fileops.js` (nuevo): resolver, `plan(action, text)` → `{ id, summary, choices }` o
  `{ error }`, `run(id, choice)`. **[decisión mía]** Recibe la carpeta personal y la función de papelera
  como parámetros, para poder probarlo en una carpeta temporal sin Electron.
- `main.js`: dos `ipcMain.handle` (`fileops:plan`, `fileops:run`). `preload.js`: sus dos puentes.
- `chat.js`: el reconocedor, el nuevo `kind: 'fileop'` en `asked()` / `doNow()` / `after()`, y el cambio en
  `powers()`.
- `lines.js`: las líneas nuevas (plan, hecho, error, botones) en sus cinco idiomas.

## 5. Pruebas

- `tests/fileops-parse.test.js`: el reconocedor, con las frases de la tabla 4.1 y las tres del usuario tal
  cual.
- `tests/fileops.test.js`: `fileops.js` sobre una carpeta temporal haciendo de carpeta personal. Cubre cada
  acción, que no sobrescribe, que rechaza fuera de casa, rutas ocultas y enlaces que salen de casa, el corte
  con " a " dentro del nombre y la elección de nombre libre al extraer.
- A mano, en su Hyprland: las tres frases del usuario con Ollama.

## 6. Lo que queda al constructor

Los textos exactos de las líneas (con la voz de Capri, `persona: "Se un poco mas burlona"`), las
expresiones regulares concretas, la cara que pone en cada caso y cómo se trocea el código dentro de cada
archivo.
