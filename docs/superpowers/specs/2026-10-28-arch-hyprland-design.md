# Capri en Arch + Hyprland: diseño

Fecha: 2026-10-28. Fork: `Renindstone/capri-desktop` (upstream: `mochiiwuff/capri-desktop`, v0.4.4).
Copia local: `/home/renindstone/Proyectos/Claude/capri-desktop`.

Lo marcado **[decisión del usuario]** lo pidió él. Lo marcado **[decisión mía]** lo decidí yo y él puede
cambiarlo al revisar. Lo demás son hechos comprobados en su máquina o en el código.

## 1. Intención

El dueño usa CachyOS (Arch) con Hyprland y quiere a Capri en su escritorio. El original solo se publica para Windows:
en Linux arranca desde el código sin haberse probado nunca, y todo lo que depende de ventanas, apps, archivos e
instalación pasa por PowerShell.

Lo que más quiere ver **[decisión del usuario]**:

1. Que pasee por el escritorio.
2. Que reaccione a lo que hace: abrir aplicaciones, subir o bajar el volumen.
3. Una animación mientras programa con Claude Code, y la misma animación cuando está en VSCodium.
4. Una animación mientras escucha música en Pear (pear-desktop).
5. Un icono en su panel (como cachy-update, Claude o Steam) con clic derecho para apagarla.
6. Que el resto de funciones del original también anden en Arch, si se puede.

Éxito: arranca sola al iniciar sesión, no estorba (no ocupa media pantalla, no roba el foco, deja pasar los
clics), y reacciona a la música, a Claude, a VSCodium, al volumen y a las apps que abre.

## 2. Objetivos, no objetivos y anti-objetivos

**Objetivos**

- Funcionar en **Hyprland sobre Wayland**, que es su sesión. Es el caso a cuidar; X11 y otros escritorios no.
- Paquete de Arch instalable con `makepkg -si`.
- Las funciones nuevas de la sección 5 y el porte de las de Windows de la sección 6.

**No objetivos** **[decisión mía]**

- Otros escritorios (KDE, GNOME, X11). Si algo funciona ahí, bien, pero no se prueba.
- Publicar en el AUR. Se puede hacer después.
- Sincronizar la animación de música con el ritmo real de la canción. Va a un ritmo fijo.
- Dibujos nuevos. Las animaciones nuevas se hacen con las poses y efectos que ya tiene (`acting.js`, `fx.js`). El
  arte de `assets/capri/` no es nuestro y la licencia no lo cubre.
- Que comente el título de la canción. Se puede añadir después.

**Anti-objetivos** (aunque funcione, sería un fracaso)

- Que su ventana se coloque en mosaico, ocupe espacio, le robe el foco o tape los clics.
- Editar la configuración de Hyprland del usuario sin preguntar. Su configuración es Lua (`~/.config/hypr/hyprland.lua`
  y `hyprland/*.lua`), y es suya.
- Pedir `sudo` desde la app o instalar cosas por su cuenta.
- Leer el contenido de las ventanas, o mandar títulos fuera de la app. El original se precia de esto (README, "What
  leaves your machine"), y se mantiene.
- Que reaccione a cada cosa sin parar: tiene que poder ignorarse.

## 3. El entorno del usuario (comprobado el 2026-10-28)

| Pieza | Valor |
|---|---|
| Distro | CachyOS (Arch), kernel 7.3.0-5-cachyos |
| Sesión | Wayland, Hyprland 0.56.2, configuración en Lua (`hl.window_rule`, `hl.on(...)`) |
| Monitor | Uno solo: `DP-1`, 2560×1440 a 180 Hz, escala 1. `reserved` de Hyprland `[60,10,10,10]` (la barra va a la izquierda) |
| Panel y bandeja | Caelestia shell (`qs -c caelestia`), barra vertical a la **izquierda**. Es el `StatusNotifierHost`/`Watcher` en D-Bus |
| Portal | `xdg-desktop-portal-hyprland 1.4.1` (tiene atajos globales) |
| Inicio automático | El autostart XDG funciona: hay servicios `app-…@autostart.service` (cachy-update, etc.) |
| Electron en repos | `extra/electron44 44.9.3-1`, la misma versión que pide el `package.json` (`^44.9.3`) |
| Node | v26.12.1 |
| Herramientas ya instaladas | `playerctl`, `wpctl`, `pactl`, `grim`, `gio`, `plocate`, `codium` |
| Pear | `pear-desktop 3.12.0` en `/usr/lib/pear-desktop/app.asar`, corre sobre `electron42`. Clase de ventana en Hyprland: `com.github.th-ch.youtube-music`. En MPRIS aparece como reproductor genérico `chromium.instance<pid>`, con el pid de su proceso principal, el mismo que el `pid` de su ventana en `hyprctl clients -j` |
| VSCodium | `vscodium-bin`, comando `codium`. Su `.desktop` dice `StartupWMClass=VSCodium`; en Wayland la clase puede ser `codium`, así que se aceptan las dos |

## 4. Restricciones

- **Licencia** PolyForm Noncommercial 1.0.0 con el aviso `Required Notice:` del autor. Se puede modificar y
  redistribuir sin cobrar. El `LICENSE` y el aviso se quedan tal cual. El arte no está cubierto por la licencia y
  pertenece a sus dueños.
- **Seguir el upstream.** El autor publica seguido. Para poder traer sus cambios con `git merge upstream/main`, el
  código de Linux va en archivos nuevos y los cambios a archivos compartidos son mínimos, detrás de
  `process.platform === 'linux'` **[decisión mía]**.
- El código y sus comentarios en inglés, con el estilo del original (comentarios cortos que explican el porqué). La
  documentación para el usuario en español.
- **Privacidad:** igual que el original. Los títulos de ventana solo se comparan dentro de la app (para la lista de
  IAs) y nunca salen. El puente de hooks sigue en `127.0.0.1:47823`.

## 5. Lo nuevo

### 5.1 Estados y reacciones: qué animación gana

**[decisión del usuario]**, con el reparto en dos capas propuesto por mí y aceptado por él.

El original ya separa dos cosas:

- **Modo** (`capri.mode`: `idle | work | alert | sleep`, en `capri.js`): lo que dura.
- **Acto** (`ACTS` en `acting.js`, cada uno con `priority` de 0 a 4): una animación corta. Si llega uno de prioridad
  menor que el que se está reproduciendo, se descarta (`capri.js:605`).

Esto se extiende así:

**Estados que duran.** Solo hay uno a la vez. Gana el de nivel más alto y, cuando termina, se baja al siguiente:

| Nivel | Estado | Cuándo está activo |
|---|---|---|
| 1 (el más alto) | **Música** | Pear está en `Playing` |
| 2 | **Programando** | Claude Code trabajando (hooks; el `work` de hoy) **o** VSCodium es la ventana activa |
| 3 | **Paseando** | nada de lo anterior (`idle` de hoy: pasea, se sienta, mira el satélite) |
| 4 | **Durmiendo** | `sleep` de hoy, sin actividad |

- Con música y Claude trabajando a la vez, el cuerpo hace la animación de música, pero **el letrero sobre su cabeza
  sigue mostrando lo que hace Claude** (el ticker va aparte del cuerpo). Así la música no oculta a Claude.
- Para bajar de nivel espera: **5 s** al pausar la música (para no parpadear al cambiar de canción) y **10 s** al
  salir de VSCodium (para no parpadear al cambiar de ventana un momento) **[decisión mía]**.
- En VSCodium es la misma animación de programar, pero sin el letrero de acciones, porque no hay acciones de Claude
  que mostrar **[decisión mía]**. Si Claude trabaja además, el letrero sale como siempre.
- Hoy `mode` es un solo valor que asignan varios sitios (`brain.js` llama a `setMode('work'|'idle')`). El cambio:
  cada fuente marca o desmarca su estado (`music`, `claude`, `editor`) y una sola función decide el modo a mostrar
  según la tabla. `alert` (Claude espera permiso) queda fuera de la tabla; ver abajo.

**Reacciones cortas** (1 a 3 s). Se reproducen encima del estado y después vuelve a él. Si coinciden dos, se ve solo
la de más prioridad y la otra se descarta, sin cola. Es lo que ya hace `acting.js`. De más a menos importante:

1. **Claude te pide permiso** (`alert`). **Interrumpe también a la música** **[decisión del usuario]**: va a buscarte
   como en el original y, cuando respondes o pasa el aviso, vuelve al estado que toque (música incluida).
2. Claude terminó (como en el original).
3. Subiste o bajaste el volumen, o lo silenciaste (nuevo, 5.3).
4. Abriste una aplicación (nuevo, 5.4).
5. Las reacciones del original: USB, cargador, batería, procesador al máximo, juego, otra IA delante.

### 5.2 Música en Pear

- Se detecta con `playerctl` siguiendo el estado (`playerctl -F -a status` o `--follow` con `metadata`). Así no hay
  que preguntar cada segundo.
- Para saber cuál de los reproductores `chromium.instance<pid>` es Pear: su `<pid>` es un proceso cuyo
  `/proc/<pid>/cmdline` contiene `pear-desktop` (o su ventana en Hyprland tiene la clase `com.github.th-ch.youtube-music`).
  Brave también aparece como `brave.instance…` o `chromium.instance…`, y **solo cuenta Pear** **[decisión del usuario]**.
- La animación de música es un acto nuevo en bucle hecho con poses que ya existen: cabeza y melena siguiendo un ritmo
  fijo (unos 100 a 110 pulsos por minuto), un balanceo (`bob`, `tilt`) y notas o glifos que suben (en `fx.js`, como
  los glifos de `work`). Mientras suena, se queda en su sitio (en el suelo o sentada en una ventana) en vez de
  pasear **[decisión mía]**.
- Puede apagarse desde su menú, junto a "Reaccionar a mi PC" **[decisión mía]**.

### 5.3 Volumen

- Se escucha con `pactl subscribe` (eventos `change` del sink) y se lee con `wpctl get-volume @DEFAULT_AUDIO_SINK@`
  para saber si subió, bajó o se silenció.
- Se agrupa: varios cambios seguidos (mantener la tecla) cuentan como **una** reacción cuando paran unos 400 ms
  **[decisión mía]**.
- Reacción: un acto corto con poses existentes (mira hacia arriba y hace un gesto si sube; se encoge si baja; se tapa
  o pone cara si se silencia), con una barrita de volumen como efecto. A veces una frase, no siempre.
- Se ignoran los cambios que hace la propia Capri (cuando se lo pides en el chat) y los del primer segundo tras
  arrancar.

### 5.4 Abrir una aplicación

- Evento `openwindow>>dirección,workspace,clase,título` del socket de eventos de Hyprland
  (`$XDG_RUNTIME_DIR/hypr/$HYPRLAND_INSTANCE_SIGNATURE/.socket2.sock`).
- Reacción: gira la cabeza o señala hacia donde aparece la ventana nueva (ya tiene `point`/`spot`) y, a veces, dice
  algo.
- Se ignora: su propia ventana; las ventanas de los primeros 5 s tras arrancar; las que no tienen clase; más de una
  reacción cada **15 s** **[decisión mía]**, para que no canse.
- Va dentro de "Reaccionar a mi PC".

### 5.5 Icono en el panel

**[decisión del usuario]** El original ya crea un `Tray` con su menú completo, que incluye "Salir" (en español,
`labels.js`). En Linux, Electron lo publica como StatusNotifierItem, y Caelestia lo muestra igual que el de Claude
desktop, que también es Electron y ya aparece en `busctl --user list` como `org.freedesktop.StatusNotifierItem-…`.

- Hay que comprobar que el icono se ve bien en la barra (tamaño, fondo transparente) y que el clic derecho abre el
  menú con "Salir".
- En Linux, el clic izquierdo de un StatusNotifierItem no siempre llega a Electron como `click`. Basta con que el
  derecho abra el menú.
- La guía en la que Capri "señala dónde está su icono" (`guide:tray`) usa `tray.getBounds()`, que en Linux no da la
  posición. En Linux esa parte de la guía se salta **[decisión mía]**.

## 6. Lo que se pasa de Windows a Linux

Todo en archivos nuevos (`src/main/linux/…` o `src/main/hyprland.js`), con el mismo contrato que su par de Windows,
para que el renderer no cambie.

### 6.1 La ventana de Capri en Hyprland (lo más delicado)

Capri es una ventana transparente a pantalla completa, siempre encima, que deja pasar los clics salvo cuando el
puntero está sobre ella (`main.js:172-200`). En Hyprland hay tres problemas:

1. **Mosaico:** sin reglas, Hyprland la coloca en mosaico y le quita media pantalla a lo demás. Necesita: flotante,
   fijada en todos los workspaces (`pin`), tamaño y posición exactos del monitor, sin borde, sin sombra, sin desenfoque,
   sin redondeo, sin animación de apertura y sin tomar el foco.
2. **"Siempre encima"** no existe en Wayland. En Hyprland, una ventana flotante queda encima de las de mosaico, que es
   lo que hace falta aquí. Encima de una ventana a pantalla completa no va a estar, y se acepta.
3. **Dejar pasar los clics:** `setIgnoreMouseEvents(true, { forward: true })` funciona en Wayland, pero la opción
   `forward` no existe en Linux. El renderer no recibe `mousemove` mientras la ventana deja pasar los clics, así que no
   sabe cuándo el puntero está encima de ella. Y `screen.getCursorScreenPoint()` en Wayland no sabe dónde está el
   puntero si no está sobre una ventana de la app.
   - Solución: leer la posición global del puntero de Hyprland (`cursorpos` por su socket de órdenes,
     `.socket.sock`) unas 10 veces por segundo, solo en Linux. Cuando el puntero entra en la caja de Capri, la
     ventana pasa a recibir clics, y cuando sale vuelve a dejarlos pasar. `overlay:cursor` (`main.js:681`) usa la misma
     fuente.

**El foco** **[decisión mía]**: la regla "no tomar el foco" solo vale mientras no la usas. Cuando abres su chat
(`overlay:focus`, que hace `setFocusable(true)` + `focus()`), en Wayland una ventana no puede darse el foco a sí
misma: se le pide a Hyprland (`focuswindow address:…`), y al cerrar el chat se devuelve el foco a la ventana que
lo tenía. Eso no cuenta como robar el foco, porque lo pediste tú.

**Un solo monitor** **[decisión mía]**: tiene uno, así que en Linux no se porta lo de pasar de una pantalla a otra
(`moveOverlay`, `screens:move`). Si algún día conecta otro, queda como pendiente.

**Cómo poner las reglas:** su configuración es Lua y el constructor tiene que comprobar qué funciona en Hyprland 0.56.2.
Por orden de preferencia **[decisión mía]**:

- a) Aplicarlas en tiempo de ejecución sin tocar su configuración: órdenes a la ventana por su dirección cuando
  aparece (`setfloating`, `pin`, mover y redimensionar exacto, `setprop` para borde, sombra, foco…), o una regla
  dinámica si 0.56 lo permite.
- b) Si nada de eso basta, un archivo de reglas para que el usuario lo enganche desde `rules.lua`, **con su OK
  explícito** antes de tocar nada en `~/.config/hypr/`.

Electron debe ir en Wayland nativo (`--ozone-platform=wayland`). XWayland queda como plan B si la transparencia o los
clics fallan.

**Esto se prueba primero (paso 0 del plan):** un prototipo mínimo con Electron 44 en su Hyprland que muestre la
ventana transparente encima de todo, deje pasar los clics, se vuelva clicable al pasar el puntero y no entre en
mosaico. Si no se consigue, se para y se replantea con el usuario antes de portar nada más.

### 6.2 Ventanas en las que sentarse (`windows.js` / `windows.ps1`)

Un `startWindowWatch` para Linux que emite **la misma instantánea** que `windows.ps1`:
`{ fg, taskbar, ai, game, usb, plug, wins: [{ id, x, y, w, h, max }] }`.

- Escucha el socket de eventos de Hyprland (`.socket2.sock`: `activewindowv2`, `openwindow`, `closewindow`,
  `movewindowv2`, `workspacev2`, `changefloatingmode`, `fullscreen`, `monitoradded/removed`). Con cada evento (agrupados
  unos 100 ms) pide `j/clients`, `j/activewindow` y `j/monitors` por `.socket.sock`, y emite solo si algo cambió. No usa
  el comando `hyprctl`; habla con los sockets con `node:net` **[decisión mía]**.
- `wins`: ventanas mapeadas y visibles de los workspaces que se ven en cada monitor (no las del workspace especial
  `special:*` si está oculto), sin la de Capri. El orden de delante hacia atrás se aproxima así: flotantes antes que
  mosaico, y dentro de cada grupo por `focusHistoryID`. `max` = pantalla completa o mosaico que ocupa todo el área útil
  del monitor.
- Con ventanas en mosaico sigue habiendo bordes donde sentarse: el de arriba de cada ventana y la línea entre ventanas
  apiladas. Hay que comprobar con `canSit` (renderer) que el borde de arriba, pegado a la barra, no la deje en un sitio
  absurdo.
- Coordenadas: Hyprland da coordenadas lógicas (ya escaladas por monitor). Hay que comprobar con `hyprctl monitors -j`
  (`scale`) que coinciden con los DIP de Electron, en lugar de usar `screenToDipRect` como en Windows.
- `ai`: la misma lista de nombres de IA que `windows.ps1`, comparada con la clase y el título de la ventana activa,
  dentro de la app.
- `game`: ventanas con clase `steam_app_<id>`, o cuyo proceso tiene el directorio de trabajo bajo
  `…/steamapps/common/<juego>`.
- `usb` y `plug`: con `udevadm monitor --udev` (o leyendo `/sys`) para lo que se enchufa y desenchufa, con el nombre
  que da el dispositivo. Las memorias USB por su punto de montaje en lugar de una letra de unidad. Los tipos de
  `pc.js:kindOf` (`DiskDrive`, `WPD`, `AudioEndpoint`…) son de Windows: en Linux se mapean desde las propiedades de
  udev (`ID_TYPE`, `ID_INPUT_JOYSTICK`, `ID_MTP_DEVICE`…).
- `taskbar`: en Windows indica si la barra de tareas está delante. Caelestia es una capa de Wayland que no aparece
  en `clients`, así que en Linux vale `false` y se usa el área útil del monitor **[decisión mía]**.
- "La ventana de Claude es en la que escribiste" (`README` línea 41): se busca subiendo por los procesos padre del
  hook hasta un pid que tenga ventana en `clients` (la terminal o Claude desktop). Si se complica, queda pendiente.

### 6.3 Atajo para esconderla o traerla (Ctrl+Alt+C)

`globalShortcut` de Electron (`main.js:1050`) no funciona en Wayland por su cuenta. **[decisión mía]** Se prueba
con el portal de atajos globales (Electron con `--enable-features=GlobalShortcutsPortal`; su portal de Hyprland lo
tiene), que no toca su configuración. Si no funciona, en Linux no hay atajo y se usa el menú del icono o el clic
derecho sobre ella. Un `bind` en `~/.config/hypr/` solo con su OK.

### 6.4 El resto

| Original (Windows) | Linux | Archivo de origen |
|---|---|---|
| Lista y cierre de apps abiertas (`Get-Process`) | `j/clients` (clase, pid); cerrar con `closewindow address:…` | `apps.js` |
| Apps instaladas (`Get-StartApps`) | Leer `.desktop` de `/usr/share/applications`, `~/.local/share/applications` y Flatpak; abrir con `gio launch` | `launch.js` |
| Música y volumen por teclas multimedia | `playerctl play-pause/next/previous`, `wpctl set-volume @DEFAULT_AUDIO_SINK@ 5%+` | `launch.js` |
| Steam, Epic, Spotify, YouTube, Roblox | Ya usan `shell.openExternal`, que en Linux pasa por `xdg-open`. Solo comprobar | `launch.js` |
| Buscar archivos (índice de Windows) | `plocate` limitado a `$HOME`, con los mismos filtros de tipo; sin `plocate`, `find` con profundidad y tiempo limitados | `files.js` |
| Capturas de pantalla | `grim` (de un monitor con `-o <nombre>`) | `files.js` |
| Instalar Ollama con winget | No instala. Muestra el comando `sudo pacman -S ollama` (o la variante de CachyOS para su GPU) con botón para copiarlo. Si está instalado pero apagado, lanza `ollama serve` como usuario **[decisión mía]** | `setup.js` |
| "Iniciar con Windows" (`setLoginItemSettings`, que en Linux no hace nada) | Crear o borrar `~/.config/autostart/capri.desktop`. Su sesión lo arranca (comprobado) | `main.js:479` |
| Clave de la nube cifrada con la cuenta de Windows | `safeStorage` en Linux usa el llavero (kwallet / secret service, presentes). Si no hay, se guarda como hoy (`setup.js:134`) | `setup.js` |
| "Animaciones desactivadas" de Windows | `prefers-reduced-motion` ya lo lee el renderer. No cambia | — |
| Ventana de demo (`/debug/testwin`, `main.js:258`) | Opcional en Linux | `main.js` |

Los textos que hablan de "Windows" en `labels.js`/`lines.js` (p. ej. "Iniciar con Windows") dicen "Iniciar con la
sesión" en Linux **[decisión mía]**.

## 7. Paquete para Arch

**[decisión mía]** Un `PKGBUILD` en `packaging/arch/`:

- `depends=(electron44 nodejs playerctl wireplumber libpulse grim)`, `optdepends=(plocate ollama)`.
- Copia `src/`, `assets/`, `hooks/`, `scripts/`, `package.json` y `node_modules` (solo las fuentes, sin
  dependencias de desarrollo: `npm ci --omit=dev`) a `/usr/lib/capri-desktop/`, sin asar. Así los hooks quedan en
  una ruta fija, `/usr/lib/capri-desktop/hooks/capri-hook.js`.
- `/usr/bin/capri`: `exec electron44 /usr/lib/capri-desktop "$@"`, más las opciones de Wayland que haga falta.
- `/usr/share/applications/capri.desktop` y el icono en `/usr/share/icons/hicolor/…/apps/capri.png`.
- `LICENSE` en `/usr/share/licenses/capri-desktop/`.
- Se instala con `cd packaging/arch && makepkg -si`. El usuario escribe su contraseña de `sudo`; la IA no.
- Los hooks de Claude Code se instalan desde su menú, como en el original. El comando que escribe en
  `~/.claude/settings.json` es `node "/usr/lib/capri-desktop/hooks/capri-hook.js"` (`install-hooks.js:55`), que ya
  sirve. Hay que comprobar que `install-hooks.js` respeta los hooks que el usuario ya tiene (claude-mem y otros).
- `npm start` desde el código sigue funcionando para desarrollar.

## 8. Riesgos

1. **La ventana en Hyprland** (6.1): si no se consigue transparencia más clics más que no entre en mosaico, todo lo
   demás no sirve. Por eso va primero, como prototipo.
2. **Rendimiento** **[decisión mía]**: en el paso 0 se mide cuánto gasta la app tal cual en reposo (el renderer ya
   dibuja a 12 fps en una ventana del tamaño del monitor). El objetivo es para lo nuevo: el puntero, los sockets de
   Hyprland, `playerctl` y `pactl` juntos suman como mucho un 1 % de un núcleo sobre esa base. Si la base ya es alta,
   se le cuenta al usuario. No se optimiza el renderer del original sin preguntar, porque son archivos compartidos.
3. **Upstream:** cambios suyos en `main.js` o `windows.js` pueden chocar. Por eso se toca poco esos archivos.
4. **Pear cambia cómo se anuncia en MPRIS** en una versión futura: la detección por proceso lo aguanta mejor que por
   nombre.

## 9. Lo que queda a criterio del constructor

- La forma exacta de las animaciones nuevas (música, volumen, abrir app), siempre con las poses y efectos existentes,
  y con frases nuevas en `lines.js` en los idiomas que ya tiene (al menos español; las demás pueden quedar en inglés).
- Cómo comprobar la clase de ventana de VSCodium (`codium` / `VSCodium`).
- Los nombres de archivos nuevos y cómo se reparte el código de Linux.
- Si `hyprctl` resulta más simple que los sockets en algún punto concreto, siempre que no se lance un proceso cada
  100 ms.

## 10. Cómo se prueba

- `npm run test:hooks`, que ya existe, sigue pasando.
- Pruebas nuevas con `node --test` para la lógica pura: elegir el estado según la tabla 5.1 (con los tiempos de
  espera), agrupar los cambios de volumen, pasar la salida de `j/clients` a la instantánea `wins`, leer `.desktop` y
  reconocer a Pear entre los reproductores.
- A mano en su Hyprland, con capturas: arranca y no entra en mosaico; deja pasar los clics; se puede arrastrar y hacer
  clic derecho; el icono aparece en Caelestia y "Salir" la cierra; con Pear sonando baila; al pausar, a los 5 s vuelve;
  con Claude trabajando y música, baila y el letrero muestra las acciones; un permiso de Claude interrumpe la música;
  en VSCodium hace la animación de programar; subir el volumen y abrir una app provocan su reacción; inicia sola al
  entrar en la sesión.
