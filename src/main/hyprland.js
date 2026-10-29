'use strict';

// Hyprland (Linux). Her window floats over the others on every workspace and lets the pointer
// through to them. Hyprland ignores the input region Electron gives a floating window, and only
// lets the pointer through a window it won't focus, so she's made unfocusable until the pointer
// is on her. Wayland doesn't tell an app where the pointer is when it's elsewhere: Hyprland does.
// All of it through Hyprland's own sockets, no hyprctl process.

const net = require('node:net');
const path = require('node:path');
const readline = require('node:readline');

const SIG = process.env.HYPRLAND_INSTANCE_SIGNATURE;
const DIR = SIG ? path.join(process.env.XDG_RUNTIME_DIR || `/run/user/${process.getuid()}`, 'hypr', SIG) : null;
const active = process.platform === 'linux' && Boolean(DIR);

// one request on the command socket, its whole answer back
function request(cmd) {
  return new Promise((resolve, reject) => {
    let out = '';
    const c = net.createConnection(path.join(DIR, '.socket.sock'));
    c.on('connect', () => c.end(cmd));
    c.on('data', (d) => { out += d; });
    c.on('end', () => resolve(out));
    c.on('error', reject);
  });
}

const json = async (what) => JSON.parse(await request(`j/${what}`));

// Lua, as in a Lua config: Hyprland answers "ok" or what went wrong
async function lua(code) {
  const out = (await request(`eval ${code}`)).trim();
  if (out !== 'ok') throw new Error(`hyprland: ${out}`);
}

// Hyprland's events, one line each ("name>>data"); reconnects if Hyprland restarts its socket
function listen(onEvent) {
  let sock = null;
  let stopped = false;
  const connect = () => {
    sock = net.createConnection(path.join(DIR, '.socket2.sock'));
    readline.createInterface({ input: sock }).on('line', (line) => {
      const at = line.indexOf('>>');
      if (at > 0) onEvent(line.slice(0, at), line.slice(at + 2));
    });
    sock.on('error', (err) => console.error('[capri] hyprland events:', err.message));
    sock.on('close', () => !stopped && setTimeout(connect, 3000));
  };
  connect();
  return {
    stop() {
      stopped = true;
      sock?.destroy();
    },
  };
}

const quiet = (err) => console.error('[capri]', err.message);

// Her window in Hyprland. The rule goes in before her window opens (rules apply when a window maps):
// floating, pinned to every workspace, over `area`, nothing drawn around it, fully opaque whatever
// the config's opacity, and unfocusable.
function overlay(area) {
  let address = null;
  let interactive = false; // the pointer is on her (app.js)
  let gaveBack = null;     // the window that had the keyboard before her chat took it

  const rule = () => lua(`hl.window_rule({ name = "capri-overlay", match = { class = "^capri-desktop$", title = "^Capri$" }, float = true, pin = true, no_focus = true, no_initial_focus = true, move = "${area.x} ${area.y}", size = "${area.width} ${area.height}", border_size = 0, no_shadow = true, no_blur = true, no_dim = true, rounding = 0, opacity = "1 override", no_anim = true })`);
  const dispatch = (dsp) => address && lua(`hl.dispatch(${dsp})`).catch(quiet);
  const update = () => dispatch(`hl.dsp.window.set_prop({ window = "address:${address}", prop = "no_focus", value = "${interactive ? 0 : 1}" })`);
  const giveBack = () => {
    if (gaveBack) dispatch(`hl.dsp.focus({ window = "address:${gaveBack}" })`);
    gaveBack = null;
  };

  // refused (a Hyprland that names things otherwise): her window would open tiled, taking every
  // click, so main.js doesn't show it at all
  const ready = rule();
  ready.catch(quiet);
  // reloading the config drops the rules added on the fly: hers again, and her window let through
  // again whatever became of the rule
  const events = listen((name) => {
    if (name === 'configreloaded') rule().catch(quiet).then(update);
  });

  return {
    ready,
    // once her window is up: its address, to change it later
    async attach(pid = process.pid) {
      for (let i = 0; i < 50 && !address; i++) {
        const win = (await json('clients').catch(() => [])).find((c) => c.pid === pid && c.class === 'capri-desktop' && c.title === 'Capri');
        if (win) address = win.address;
        else await new Promise((r) => setTimeout(r, 100));
      }
      if (!address) console.error('[capri] hyprland: her window never showed up');
      return update();
    },
    interactive(on) {
      interactive = on;
      return update();
    },
    // Wayland doesn't let a window take the keyboard: Hyprland hands it over (her window focusable
    // for that moment), and back after. The keyboard stays with her once her window lets the
    // pointer through again, so her chat open doesn't take every click.
    async focus(on) {
      if (!on) return giveBack();
      const before = await json('activewindow').catch(() => null);
      gaveBack = before?.address && before.address !== address ? before.address : null;
      await dispatch(`hl.dsp.window.set_prop({ window = "address:${address}", prop = "no_focus", value = "0" })`);
      await dispatch(`hl.dsp.focus({ window = "address:${address}" })`);
      return update();
    },
    // she took you to another window (her chat, "take me to…"): closing the chat leaves you there
    forgetFocus() {
      gaveBack = null;
    },
    // her page reloaded, gone or stuck: nothing will say the pointer left her, so it goes through
    release() {
      interactive = false;
      giveBack();
      return update();
    },
    // where the pointer is, in the layout's coordinates (logical pixels, like Electron's)
    cursor: () => json('cursorpos'),
    stop: () => events.stop(),
  };
}

module.exports = { active, request, json, lua, listen, overlay };
