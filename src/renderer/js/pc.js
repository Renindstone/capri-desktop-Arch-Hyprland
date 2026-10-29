// She lives in your PC, so she feels it: the processor maxed out, the charger, the battery, the
// network, things you plug in (a USB stick, a phone, a controller...) and the games you play.
// Her menu › React to my PC turns it off.

import { pick, fmt } from './util.js';

const HOT = 85; // % of the processor, for HOT_FOR
const HOT_FOR = 15000;
const HOT_EVERY = 30 * 60 * 1000;
const CHARGER_EVERY = 60 * 1000;
const PLUG_EVERY = 15 * 1000;
const GAME_AFTER = 6000;  // a game in front this long: you're playing
const GAME_OVER = 8000;   // and gone this long: you're done
// Linux: you at the sound (media.js) and a window you open (linux-windows.js)
const VOLUME_EVERY = 8000;   // her body reacts to the sound once in that long at most (the level shows each time)
const OPENED_EVERY = 15000;  // she turns to a window opening once in that long at most
const OPENED_AFTER = 5000;   // and not right as she starts, with the session opening its windows
const SAY_EVERY = 90 * 1000; // a word about either, now and then
const VOLUME_ACTS = { up: 'hop', down: 'flinch', mute: 'huff', unmute: 'curious' };

const PHONE = /phone|iphone|apple|galaxy|samsung|pixel|xiaomi|redmi|poco|oneplus|huawei|honor|motorola|oppo|vivo|realme|nokia|xperia|android|mobile|t[ée]l[ée]phone|celular|телефон/i;
const PAD = /controller|gamepad|manette|mando|controle|xbox|dualsense|dualshock|joy-?con|геймпад/i;

// what was plugged in, from the name and the class Windows gives it
function kindOf({ name = '', class: cls = '' }) {
  if (PAD.test(name)) return 'controller';
  if (cls === 'DiskDrive' || cls === 'Volume') return 'drive'; // USB sticks: by their drive letter
  if (cls === 'WPD' || PHONE.test(name)) return 'phone';
  if (cls === 'AudioEndpoint' || cls === 'MEDIA') return 'audio';
  if (cls === 'Camera' || cls === 'Image') return 'camera';
  if (['Keyboard', 'Mouse', 'HIDClass'].includes(cls)) return 'input';
  return 'device';
}

export class Pc {
  constructor({ capri, panel, brain, host, voice, chat, guide }) {
    Object.assign(this, { capri, panel, brain, host, voice, chat, guide });
    this.enabled = true;
    this.wantsOut = () => true; // not put away in her settings
    this.hotSince = 0;
    this.hot = false;
    this.hotAt = -Infinity;
    this.charging = null;
    this.chargerAt = -Infinity;
    this.warned = 1; // lowest battery level she warned about (1: none yet)
    this.cutOff = false;
    this.drives = null;
    this.startedAt = Date.now();
    this.volumeAt = -Infinity;
    this.openedAt = -Infinity;
    this.saidAt = -Infinity;
    this.plugs = null; // count of plug events seen (windows.ps1)
    this.plugAt = -Infinity;
    this.game = null;
    setInterval(() => this.checkCpu(), 3000);
    setInterval(() => this.checkGame(), 1000);
    this.watchBattery();
    window.addEventListener('offline', () => this.offline());
    window.addEventListener('online', () => this.online());
  }

  get t() {
    return this.brain.t.pc;
  }

  // not in the middle of something that matters more
  get quiet() {
    return this.enabled && this.capri.mode !== 'alert' && !this.chat.open && !this.guide.running;
  }

  say(line, face = 'smug', hold = 4500) {
    if (this.quiet) this.panel.say({ kind: 'info', face, line, hold });
  }

  // waits a few seconds for her to be free to move, if she's busy
  async whenFree(ms = 6000) {
    for (let waited = 0; !this.capri.free && waited < ms; waited += 250) await new Promise((r) => setTimeout(r, 250));
    return this.capri.free;
  }

  async checkCpu() {
    if (!this.enabled) return;
    const cpu = await this.host.cpu().catch(() => null);
    if (cpu == null) return;
    const now = Date.now();
    if (cpu < HOT) {
      this.hotSince = 0;
      if (this.hot && cpu < 55) {
        this.hot = false;
        if (!this.panel.visible) this.say(pick(this.t.cool), 'calm', 3000);
      }
      return;
    }
    this.hotSince ||= now;
    if (this.hot || now - this.hotSince < HOT_FOR || now - this.hotAt < HOT_EVERY || !this.quiet) return;
    this.hot = true;
    this.hotAt = now;
    this.capri.wake();
    this.say(fmt(pick(this.t.hot), { cpu }), 'wide', 5000);
    this.voice.play('charge');
    if (await this.whenFree()) this.capri.perform('overheat');
  }

  async watchBattery() {
    const battery = await navigator.getBattery?.().catch(() => null);
    if (!battery) return;
    const changed = () => this.battery(battery);
    battery.addEventListener('levelchange', changed);
    battery.addEventListener('chargingchange', changed);
    this.charging = battery.charging; // as it is when she starts: nothing to say
  }

  async battery({ level, charging }) {
    if (!this.enabled) return;
    const now = Date.now();
    if (charging !== this.charging) {
      this.charging = charging;
      if (now - this.chargerAt > CHARGER_EVERY) {
        this.chargerAt = now;
        if (charging) {
          this.warned = 1;
          this.say(pick(this.t.charging), 'laugh', 3500);
          this.capri.recharge();
        } else {
          this.say(pick(this.t.unplugged), 'aside', 3500);
        }
      }
    }
    if (charging) return;
    const at = level <= 0.05 ? 0.05 : level <= 0.15 ? 0.15 : 1;
    if (at >= this.warned) return;
    this.warned = at;
    this.capri.wake();
    this.say(fmt(pick(at === 0.05 ? this.t.critical : this.t.low), { level: Math.round(level * 100) }), 'aside', 6000);
    if (await this.whenFree()) this.capri.drain();
  }

  offline() {
    clearTimeout(this.offlineTimer);
    // a blip isn't worth it
    this.offlineTimer = setTimeout(() => {
      if (navigator.onLine || !this.enabled) return;
      this.cutOff = true;
      this.voice.play('error');
      this.say(pick(this.t.offline), 'wide', 5000);
      this.capri.hurt();
    }, 4000);
  }

  online() {
    clearTimeout(this.offlineTimer);
    if (!this.cutOff) return;
    this.cutOff = false;
    this.voice.play('hello');
    this.say(pick(this.t.online), 'laugh', 3500);
    if (this.capri.free) this.capri.perform('hop');
  }

  // what windows.ps1 sees: USB sticks by letter, devices plugged in or out, the game in front
  // a word now and then (chance), not every time
  sayNow(lines, chance) {
    const now = Date.now();
    if (now - this.saidAt < SAY_EVERY || Math.random() > chance) return;
    this.saidAt = now;
    this.say(pick(lines), 'smug', 3000);
  }

  // You turned the sound up, down, off or on again (Linux): the level floats over her head, and
  // now and then her body goes with it, a hop up, a flinch down, a huff at the silence.
  onVolume({ dir, level }) {
    if (!this.quiet) return;
    const n = Math.max(0, Math.min(10, Math.round(level * 10)));
    const h = this.capri.head();
    this.capri.fx.glyph(h.x, h.y - 40, [`${'▮'.repeat(n)}${'▯'.repeat(10 - n)} ${Math.round(level * 100)}%`]);
    const now = Date.now();
    if (now - this.volumeAt < VOLUME_EVERY || !this.capri.free) return;
    this.volumeAt = now;
    this.capri.perform(VOLUME_ACTS[dir], 1);
    this.sayNow(this.t.volume[dir], 0.35);
  }

  // A window you just opened (Linux): her head turns to it, a curious look.
  onOpened({ x }) {
    const now = Date.now();
    if (!this.quiet || now - this.startedAt < OPENED_AFTER || now - this.openedAt < OPENED_EVERY) return;
    this.openedAt = now;
    if (!this.capri.free) return;
    this.capri.perform('curious', x > this.capri.pos.x ? 1 : -1);
    this.sayNow(this.t.opened, 0.25);
  }

  onWindows({ usb = [], plug = null, game = null }) {
    if (!this.enabled) {
      this.drives = usb;
      this.plugs = plug?.n ?? 0;
      return;
    }
    if (this.drives) {
      const added = usb.find((d) => !this.drives.includes(d));
      const removed = this.drives.find((d) => !usb.includes(d));
      if (added) this.stick(added);
      else if (removed) this.say(pick(this.t.usbOut), 'smug', 3500);
    }
    this.drives = usb;

    if (this.plugs !== null && plug && plug.n !== this.plugs) this.device(plug);
    this.plugs = plug?.n ?? 0;

    const g = this.game;
    if (game) {
      if (g?.name === game) g.gone = 0;
      else this.game = { name: game, since: Date.now(), gone: 0, said: false, put: false };
    } else if (g && !g.gone) {
      g.gone = Date.now();
    }
  }

  // a USB stick: she dives into it to have a look
  async stick(drive) {
    this.capri.wake();
    this.say(fmt(pick(this.t.usb), { drive }), 'look', 2500);
    if (!this.quiet || !(await this.whenFree())) return;
    const { w, h } = this.capri.view;
    if (await this.capri.visit({ x: w - 140, y: h - 6 })) this.say(pick(this.t.usbBack), 'smug', 4500);
  }

  // anything else plugged in or out: a phone, a controller, a headset...
  device(plug) {
    const kind = kindOf(plug);
    if (kind === 'drive' || Date.now() - this.plugAt < PLUG_EVERY) return;
    this.plugAt = Date.now();
    const lines = plug.in ? this.t.plugIn : this.t.plugOut;
    this.capri.wake();
    // plugged in: a jolt of lightning down to where it came in (by the clock), before she talks
    if (plug.in && this.capri.free) {
      const { w, h } = this.capri.view;
      this.capri.zap(w - 140, h - 10);
    }
    this.say(fmt(pick(lines[kind] || lines.device), { name: plug.name }), plug.in ? 'look' : 'aside', 4000);
  }

  checkGame() {
    const g = this.game;
    if (!g || !this.enabled) return;
    const now = Date.now();
    // you're playing: a word about it, then she gets out of the way (she's always on top)
    if (!g.said && !g.gone && now - g.since >= GAME_AFTER) {
      g.said = true;
      if (this.capri.stowed || this.capri.mode === 'alert') return;
      this.capri.wake();
      this.say(fmt(pick(this.t.game), { game: g.name }), 'smug', 3000);
      setTimeout(() => {
        if (this.game !== g || g.gone || this.capri.stowed || this.capri.mode === 'alert') return;
        g.put = true;
        this.capri.stow();
      }, 2600);
    }
    // done playing: she comes back, if she's the one who left
    if (g.gone && now - g.gone >= GAME_OVER) {
      this.game = null;
      if (g.put && this.capri.stowed && this.wantsOut()) {
        this.capri.unstow().then(() => this.say(pick(this.t.gameBack), 'look', 5000));
      }
    }
  }
}
