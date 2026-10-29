# Capri en Arch + Hyprland: plan de implementación

> **Para agentes:** se ejecuta con superpowers:executing-plans (lo hace la misma sesión, tarea por tarea).

**Objetivo:** que Capri funcione en Hyprland y sume música en Pear, VSCodium, volumen y apps abiertas.

**Arquitectura:** el código de Linux va en archivos nuevos de `src/main/` (`hyprland.js`, `linux-windows.js`,
`media.js`, `linux-apps.js`) con el mismo contrato que su par de Windows, y en `main.js` solo hay ramas cortas.
En el renderer, la música es otra animación de fondo (el `base` de `capri.js`, como flotar o estar sentada) y las
reacciones son actos cortos de `acting.js` que se ponen encima: es el reparto en dos capas del diseño, sobre lo que el
original ya tiene.

**Tecnología:** Electron 44, Node 26 (`node:test`), sockets de Hyprland, `playerctl`, `pactl`/`wpctl`.

**Diseño:** `docs/superpowers/specs/2026-10-28-arch-hyprland-design.md`

## Restricciones globales

- El código y sus comentarios en inglés, con el estilo del original. Commits y documentación en español.
- Cambios mínimos en archivos del upstream. Lo de Linux va detrás de `process.platform === 'linux'` o `hyprland.active`.
- Ningún título de ventana sale de la app. A Capri solo le llegan claves (`ai`, `game`, `coding`).
- Nunca `sudo`, nunca editar `~/.config/hypr/` sin el OK del usuario.
- Probar en vivo con `ydotool` (socket en `/tmp/claude-1000/ydo.sock`) solo moviendo el puntero, sin clics.

## Puntos a vigilar en la revisión

1. Recargar la configuración de Hyprland con Capri abierta: la ventana no debe pasar a mosaico ni bloquear los clics.
2. Pear abierto y en pausa, o Brave reproduciendo un vídeo: solo cuenta Pear en `Playing`.
3. Mantener apretada la tecla de volumen: una sola reacción.
4. Muchas ventanas abiertas de golpe (al iniciar la sesión): como mucho una reacción cada 15 s, ninguna en los 5 s
   tras arrancar.
5. El permiso de Claude con música sonando: `alert` interrumpe y después vuelve la música.

---

### Tarea 1 (hecha): la ventana en Hyprland

`src/main/hyprland.js`: la regla `capri-overlay`, `no_focus` encendido por defecto y apagado con el puntero encima,
el foco del chat y `cursorpos`. Commits `d0e02dc` y `33690f6` (este último también añade las casillas del menú y
"Iniciar con CachyOS").

### Tarea 2: ventanas en Linux (`src/main/linux-windows.js`)

**Archivos:** crear `src/main/linux-windows.js` y `tests/linux-windows.test.js`. En `src/main/windows.js`, que
`startWindowWatch` delegue en Linux.

**Interfaces:**
- `snapshot({ clients, active, monitors, self }) -> { fg, taskbar: false, ai: string[], game: string|null, coding: boolean, usb: [], plug: null, wins: [{ id, x, y, w, h, max }] }`.
  Es una función pura.
  - `id`: `parseInt(address, 16)`.
  - `wins`: ventanas de los workspaces visibles (y el especial si se ve), mapeadas y no ocultas, sin `self`, de al
    menos 200×120. Las flotantes primero y luego por `focusHistoryID`.
  - `max`: pantalla completa, o mosaico que ocupa el área útil del monitor (`reserved`).
- `coding`: la clase de la ventana activa es `codium`, `VSCodium`, `code` o `code-oss`.
- `ai`: la misma lista de `windows.ps1`, aplicada al título y la clase de la activa.
- `game`: clase `steam_app_\d+`, o `/proc/<pid>/cwd` bajo `steamapps/common/<juego>`.
- `startLinuxWindowWatch({ overlay, onUpdate })`: escucha el socket de eventos, agrupa durante 100 ms, pide
  `clients`, `activewindow` y `monitors`, y emite solo si cambió algo. Devuelve `{ stop, refresh }`.

**Pruebas:** `snapshot` con JSON de ejemplo de `hyprctl`:
- VSCodium activo da `coding: true`.
- El título "ChatGPT - Brave" da `ai: ['chatgpt']`.
- Las ventanas de otro workspace no aparecen.
- La ventana propia no aparece.
- Una ventana en mosaico que llena el área útil da `max: true`.
- `steam_app_570` da un juego.

### Tarea 3: estados (música, programar) en el renderer

**Archivos:** `src/renderer/js/acting.js` (actos `groove` y `grooveSit`, con bucle a unos 103 pulsos por minuto: 7
fotogramas por pulso a 12 fps), `src/renderer/js/capri.js` y `src/renderer/js/app.js`.

**Interfaces:**
- `capri.setMood({ music, coding })`: guarda los dos indicadores.
  - `music` (y modo distinto de `alert` y `sleep`): `baseAct()` devuelve `groove`/`grooveSit`.
  - `music` o `coding`: suelta glifos (notas `♪ ♫` con música) y no se duerme ni pasea.
  - Si empieza la música y está dormida, se despierta.
- En `app.js` se aplican las esperas antes de bajar de nivel (5 s al parar la música, 10 s al salir de VSCodium).
  Al pasar a `coding`, se pone a trabajar sin cambiar `mode`: `capri.settleForWork()`, que es `goToWork()` sin
  `setMode`.
- `alert` ya es un modo de `brain.js`: con `alert`, `baseAct()` no devuelve `groove`.

**Pruebas:** `tests/moods.test.js` con la lógica de esperas como función pura: `moodAt(events, now)` devuelve
`{ music, coding }`.

### Tarea 4: música en Pear (`src/main/media.js`)

**Interfaces:**
- `startMediaWatch({ onChange })`: lanza `playerctl -a -F metadata --format '{{playerName}} {{status}}'` y avisa
  `onChange({ playing: boolean })` cuando cambia el estado de Pear. Devuelve `{ stop }`.
- `isPear(playerName)`: `chromium.instance<pid>` cuyo `/proc/<pid>/cmdline` contiene `pear-desktop` o
  `youtube-music`.
- En `main.js`: `media:update` al renderer. En el menú, la casilla "Bailar con la música" (`cfg.music`, activa por
  defecto).

**Pruebas:** parseo de las líneas de `playerctl` e `isPear` con un `/proc` simulado (se pasa la función de lectura).

### Tarea 5: reacciones a volumen y apps

**Interfaces:**
- `startVolumeWatch({ onChange })` en `media.js`: `pactl subscribe`, filtra `change` en `sink`, lee
  `wpctl get-volume @DEFAULT_AUDIO_SINK@` y agrupa durante 400 ms. Emite `{ dir: 'up'|'down'|'mute'|'unmute', level }`.
- Apertura de ventanas: el evento `openwindow` de `linux-windows.js` emite `{ opened: { id } }`. Se ignoran la propia,
  las de los 5 s tras arrancar y más de una cada 15 s.
- Renderer (`pc.js`, bajo "Reaccionar a mi PC"):
  - Volumen: acto corto `volume` (prioridad 1) con una barrita (`fx`).
  - App nueva: `capri.glance(x, y)` hacia el centro de la ventana nueva (prioridad 1).
  - Alguna frase de vez en cuando, en `lines.js` (español e inglés; los demás idiomas usan el inglés).

**Pruebas:** la agrupación del volumen como función pura (`volumeChanges(samples) -> eventos`).

### Tarea 6: apps, archivos, Ollama y capturas en Linux (`src/main/linux-apps.js`)

**Interfaces** (el mismo contrato que `apps.js`, `launch.js`, `files.js` y `setup.js`):
- `launchables()`: lee los `.desktop` de `/usr/share/applications`, `~/.local/share/applications` y Flatpak. Usa
  `Name` y `Exec`, y omite `NoDisplay`.
- `launch(item)`: `gio launch <archivo.desktop>`.
- `media(action)`: `playerctl` / `wpctl`.
- `findFiles(query)`: `plocate -i -l 50` limitado a `$HOME`.
- `screenshot(display)`: `grim -o <salida>`.
- `list` / `close`: con `clients`, y `closewindow` para cerrar.
- Ollama: si falta, el panel muestra `sudo pacman -S ollama` con un botón para copiarlo. Si está instalado y apagado,
  lanza `ollama serve`.

**Pruebas:** el parseo de `.desktop`, con un archivo de ejemplo.

### Tarea 7: USB y dispositivos (`plug`/`usb`)

`udevadm monitor --udev --property` en `linux-windows.js`. Se pasan `ID_INPUT_JOYSTICK`, `ID_MTP_DEVICE`,
`ID_BUS=usb` + `DEVTYPE=disk` y el sonido a las clases que entiende `pc.js` (`DiskDrive`, `WPD`, `AudioEndpoint`…).
Las memorias USB se cuentan por punto de montaje.

**Pruebas:** el paso de propiedades a clase.

### Tarea 8: paquete, documentación y subida

- `packaging/arch/PKGBUILD`, `packaging/arch/capri` (lanzador con `electron44`) y `packaging/arch/capri.desktop`.
  Prueba: `makepkg` en un directorio temporal, sin instalar. Instalar lo hace el usuario.
- Una sección Linux/Hyprland en `README.md` y `README.es.md`.
- `git push origin main` al fork.
