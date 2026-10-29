[English](README.md) · [Français](README.fr.md) · **Español (Arch + Hyprland)**

# Capri para Arch Linux + Hyprland

Este es un fork de [capri-desktop](https://github.com/mochiiwuff/capri-desktop), de mochiiwuff. Hace que Capri, el
constructo de *Project Capricorn* (Cyberpunk: Edgerunners), viva en un escritorio Arch Linux con Hyprland. La lista
completa de lo que hace está en el [README en inglés](README.md). Aquí está lo propio de esta versión.

Probado en CachyOS con Hyprland 0.56 (Wayland), un monitor y el panel Caelestia.

## Lo que hace en Linux

- **Flota encima de tus ventanas** en todos los escritorios y deja pasar tus clics. Solo puedes tocarla cuando el
  ratón está sobre ella.
- **Se sienta en tus ventanas**, también en las de mosaico. Además sabe cuál tienes delante, si es otra IA o un juego.
- **Baila cuando suena música en [Pear](https://github.com/pear-devs/pear-desktop)**: mueve la cabeza y la melena al
  ritmo y suelta notas ♪. Si pausas, sigue 5 segundos más por si solo cambias de canción. Se apaga en su menú, con
  "Bailar con la música".
- **Trabaja contigo** cuando tienes VSCodium (o Code) delante, con la misma animación que cuando Claude Code trabaja.
- **Reacciona a tu PC** (opción "Reaccionar a mi PC"):
  - al subir, bajar o silenciar el volumen, muestra el nivel sobre su cabeza (▮▮▮▯▯ 55 %) y a veces hace un gesto;
  - mira hacia la ventana que acabas de abrir;
  - nota los USB y aparatos que conectas.
- **Qué gana cuando pasan varias cosas a la vez:** la música va primero y después programar; si no pasa nada, pasea.
  Si Claude te pide permiso, eso interrumpe todo, también la música. Lo que hace Claude sigue en el letrero sobre su
  cabeza aunque esté bailando.
- **Su menú** está en el icono de tu barra (clic derecho). Cada opción muestra ☑/☐ o ◉/○ según esté activa, porque
  algunas barras, como la de Caelestia, no dibujan las casillas. "Iniciar con CachyOS" la arranca con tu sesión.
- **Desde su chat** abre y cierra apps, controla la música y el volumen, busca archivos y hace capturas.

## Instalar

```bash
git clone https://github.com/Renindstone/capri-desktop.git
cd capri-desktop/packaging/arch
makepkg -si
```

Instala el comando `capri` sobre el Electron de Arch (`electron44`), con `playerctl`, `wireplumber`, `libpulse` y
`grim`. Ábrela desde tu lanzador de apps o con `capri`. Para conectarla a Claude Code: clic derecho en su icono, y
luego **Instalar los hooks de Claude Code**.

No toca tu configuración de Hyprland: añade sus reglas de ventana en caliente por el socket de Hyprland, y otra vez si
recargas la configuración.

## Lo que no hace (todavía)

- No está probada fuera de Hyprland ni con varios monitores.
- "Claude Code con Ollama en una ventana" sigue siendo solo de Windows.
- Si no tienes Ollama, su panel te lleva a la página de descarga. Instálalo con `sudo pacman -S ollama`.

## Licencia

Igual que el original: [PolyForm Noncommercial 1.0.0](LICENSE). Se puede usar, cambiar y compartir, siempre que nadie
cobre por ello. El arte de `assets/capri/` y `docs/` pertenece a sus dueños.
