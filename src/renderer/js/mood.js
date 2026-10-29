// Her lasting states besides Claude's (music playing, you coding): they come on at once and only
// go off once they've been off a while, so a skipped song or a glance at another window doesn't
// flip her back and forth.

export class Held {
  constructor(holdMs) {
    this.holdMs = holdMs;
    this.on = false;
    this.offSince = null;
  }

  // what it is now, given what it really is (`raw`) at `now` (ms)
  set(raw, now) {
    if (raw) {
      this.on = true;
      this.offSince = null;
    } else if (this.on) {
      this.offSince ??= now;
      if (now - this.offSince >= this.holdMs) this.on = false;
    }
    return this.on;
  }
}
