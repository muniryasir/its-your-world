// Shared helpers for the fielding view: the original's projection for the top-down view, the
// boundary shape, ball predictions, fielder movement and the animation scripts that drive the
// fielders' actions. Ported from $034D78-$035090 and $0389DC-$039136.
//
// Fielder record (stride $68, 11 records from the pointer at $B522):
//   +$02 attributes pointer, +$06 role (3 bowler, 4 keeper), +$26 flags byte (bit 1 catch assigned,
//   bit 2 catch out of reach), +$28 intercept time (long), +$2C/$2E/$30 target x/height/y,
//   +$32 target time, +$34/$36 placing (pitch units), +$38 state to return to, +$3A state word
//   (low byte = state, high byte = step within the state), +$3C x (16.16), +$40 height (16.16),
//   +$44 y (16.16), +$48 speed, +$4A/$4E/$52 dive velocity, +$56 facing (2048 per circle),
//   +$58/$5A/$5C animation script position / rate / countdown, +$5E animation frame (16.16),
//   +$64 distance to the ball when he started to gather it.

import { Ram, ROM, SIN, COS } from "./mem";
import { w, l, muls, mulu, asr, hiAfterShift, div32, divs, divu } from "./m68k";
import { angleTo, hypot } from "./trig";

export const REC = 0x68;
export const fielders = (m: Ram): number => m.rl(0xb522) & 0xffff;
export const ptr = (m: Ram, a: number): number => m.rl(a) & 0xffff;
/** a pointer to work RAM as the original stores it ($FFxxxx) */
export const fullPtr = (a: number): number => l(0xffff0000 | (a & 0xffff));
export const state = (m: Ram, a0: number): number => m.rw(a0 + 0x3a) & 0xff;
export const step = (m: Ram, a0: number): number => m.rb(a0 + 0x3a) & 0xff;
export const setStep = (m: Ram, a0: number, v: number): void => m.wb(a0 + 0x3a, v);

const absW = (v: number): number => { v = w(v); return v < 0 ? w(-v) : v; };

/** sub_049E9A: integer square root of a long (0 -> 0, >= $FFFE0001 -> $FFFF) */
export function isqrt(x: number): number {
  const d4 = x >>> 0;
  if (d4 === 0) return 0;
  if (!(d4 < 0xfffe0001)) return 0xffff;
  let lo = 0, hi = d4 > 0xffff ? 0xffff : d4;
  for (;;) {
    const mid = ((lo + hi) >>> 0) >>> 1;
    let sq = mulu(mid, mid) >>> 0;
    if (sq === d4) return mid & 0xffff;
    if (sq > d4) { hi = mid; continue; }
    sq = (sq + mid + mid + 1) >>> 0;
    if (sq === d4) return (mid + 1) & 0xffff;
    if (sq > d4) return mid & 0xffff;
    lo = mid;
  }
}

// ---------------------------------------------------------------- projection (top-down view)

/** sub_034FA8: field position (x, height, y) to screen, given the camera at $8D02/$8D08 */
export function fieldScreen(m: Ram, x: number, h: number, y: number): [number, number] {
  let d1: number;
  if (w(h) === 0) d1 = muls(w(-y), ROM.rw(0x4a22a));
  else d1 = l(muls(h, ROM.rw(0x4a62a)) - muls(y, ROM.rw(0x4a22a)));
  d1 = w(l(d1 << 2) >>> 16);
  let sy = divs(d1, 9).q;
  sy = w(sy + 0x70 - m.rw(0x8d02) + 0x230 + 0x70);
  let sx = divs(l(w(x) * 2), 9).q;
  sx = w(sx + 0xa0 - m.rw(0x8d08) + 0x3c8 + 0xa0);
  return [sx, sy];
}

/** sub_034D78: camera target for a field point */
export function camTarget(m: Ram, x: number, y: number): [number, number] {
  let [d0, d1] = fieldScreen(m, x, 0, y);
  d0 = w(d0 + m.rw(0x8d08) - 0x3c8 - 0xa0);
  d1 = w(d1 + m.rw(0x8d02) - 0x230 - 0x70);
  d0 = w(d0 - (d0 >> 6));
  d1 = w(d1 - (d1 >> 5));
  return [d0, d1];
}

// ---------------------------------------------------------------- the boundary

/** sub_035090: is the point (x, y) beyond the boundary? (an octagon-like shape, longer straight) */
export function outside(x: number, y: number): boolean {
  let d1 = divs(muls(w(-y), ROM.rw(0x4a22a)) << 2 >> 16, 9).q;
  // muls -> lsl.l #2 -> swap -> ext.l -> divs #9
  let d0 = divs(l(w(x) * 2), 9).q;
  if (d0 < 0) d0 = w(-d0);
  if (d1 < 0) d1 = w(-d1);
  else { d1 = w(d1 + 0x10); if (d1 < 0) d1 = 0; }
  if (d0 >= 0x460) return true;
  if (d0 >= 0x418) return !(d1 < w(-w(w(d0 - 0x418) * 2) + 0x120));
  if (d0 >= 0x398) return !(d1 < w(-w(d0 - 0x398) + 0x1a0));
  if (d0 >= 0x2d8) return !(d1 < w(-(w(d0 - 0x2d8) >> 1) + 0x200));
  if (d0 >= 0x1d8) return !(d1 < w(-(w(d0 - 0x1d8) >> 2) + 0x242));
  if (d0 >= 0xd8) return !(d1 < w(-(w(d0 - 0xd8) >> 3) + 0x262));
  return !(d1 < 0x262);
}

/** sub_035078: the same test on the point pushed out by 1/32 */
const outsideWide = (x: number, y: number) => outside(w(x + (w(x) >> 5)), w(y + (w(y) >> 5)));

/** sub_035030: pull a point beyond the boundary back onto it, along the line from the ball's start ($C736/$C738) */
export function clampToBoundary(m: Ram, x: number, y: number): [number, number] {
  if (!outside(x, y)) return [x, y];
  let d3 = m.rw(0xc736), d4 = m.rw(0xc738), d5 = w(x), d6 = w(y);
  let d0 = 0, d2 = 0;
  for (let i = 0; i < 16; i++) {
    d0 = w(d3 + d5) >> 1;
    d2 = w(d4 + d6) >> 1;
    if (outsideWide(d0, d2)) { d5 = d0; d6 = d2; } else { d3 = d0; d4 = d2; }
  }
  return [d0, d2];
}

// ---------------------------------------------------------------- ball predictions

const G = 0x3333;

/** sub_038DA4 / sub_038D9A: where the ball is after n more steps (x, height, y words). Later bounces
 *  only (the fielding view never sees the first one); a bounce step is not counted. */
export function ballAfter(m: Ram, n: number): [number, number, number] {
  let d7 = w(n);
  let x = m.rl(0xe5b4), z = m.rl(0xe5b8), y = m.rl(0xe5bc);
  let vx = m.rl(0xe5a8), vz = m.rl(0xe5ac), vy = m.rl(0xe5b0);
  const done = (): [number, number, number] => [w(x >>> 16), w(z >>> 16), w(y >>> 16)];
  if (m.rw(0xe936) !== 3) {
    for (;;) {
      x = l(x + vx); y = l(y + vy); vz = l(vz - G); z = l(z + vz);
      if (z >= 0) { d7 = w(d7 - 1); if (d7 === -1) return done(); continue; }
      // dbmi: condition true, no decrement
      if (d7 < 0) return done();
      z = 0;
      vx = muls(hiAfterShift(vx, 8), m.rw(0xc5be));
      vy = muls(hiAfterShift(vy, 8), m.rw(0xc5be));
      vz = l(-muls(hiAfterShift(vz, 8), m.rw(0xc5c0)));
      if (vz > 0x8000) continue;
      break;
    }
  }
  for (;;) {
    x = l(x + vx); y = l(y + vy);
    vx = muls(hiAfterShift(vx, 8), m.rw(0xc5c2));
    vy = muls(hiAfterShift(vy, 8), m.rw(0xc5c2));
    d7 = w(d7 - 1);
    if (d7 === -1) return done();
  }
}

/** sub_038FE2: the top of the ball's flight (cached in $86BC for the tick) */
export function peakHeight(m: Ram): number {
  if (m.rw(0x86bc) >= 0) return m.rw(0x86bc);
  if (m.rw(0xe936) === 3) { m.ww(0x86bc, 0); return 0; }
  let d1 = asr(m.rl(0xe5ac), 7);
  d1 = muls(d1, d1);
  d1 = l(d1 + asr(d1, 2));
  d1 = asr(d1, 1);
  d1 = l(d1 + m.rl(0xe5b8));
  const v = w(d1 >>> 16);
  m.ww(0x86bc, v);
  return v;
}

/** sub_038F40 / sub_038F2A: where the ball will stop ($86BE x, $86C6 y, pulled inside the rope) */
export function restPoint(m: Ram): void {
  let x: number, z: number, y: number;
  if (m.rw(0x86b6) !== 0) {
    x = m.rl(0x86be); z = m.rl(0x86c2); y = m.rl(0x86c6);
  } else {
    x = m.rl(0xe5b4); z = m.rl(0xe5b8); y = m.rl(0xe5bc);
    let vx = m.rl(0xe5a8), vz = m.rl(0xe5ac), vy = m.rl(0xe5b0);
    if (m.rw(0xe936) !== 3) {
      for (;;) {
        x = l(x + vx); y = l(y + vy); vz = l(vz - G); z = l(z + vz);
        if (z >= 0) continue;
        z = 0;
        vx = muls(hiAfterShift(vx, 8), m.rw(0xc5be));
        vy = muls(hiAfterShift(vy, 8), m.rw(0xc5be));
        vz = l(-muls(hiAfterShift(vz, 8), m.rw(0xc5c0)));
        if (vz > 0x8000) continue;
        break;
      }
    }
    const d4 = l(w(0x100 - m.rw(0xc5c2)));
    x = l(x + div32(l(vx << 8), d4));
    y = l(y + div32(l(vy << 8), d4));
    m.ww(0x86b6, -1);
    m.wl(0x86be, x); m.wl(0x86c2, z); m.wl(0x86c6, y);
  }
  const [cx, cy] = clampToBoundary(m, w(x >>> 16), w(y >>> 16));
  m.ww(0x86be, cx);
  m.ww(0x86c6, cy);
}

/** sub_038E2A / sub_038E1E: where a skied ball comes down to catching height ($86DA x, $86DE
 *  height, $86E2 y, $86E8 ticks; $86BA set). Returns [x, height, y, ticks] as words; ticks < 0 = no catch. */
export function catchPoint(m: Ram): [number, number, number, number] {
  let d0: number, d1: number, d2: number, d3: number;
  const words = (): void => {
    d0 = m.rw(0xe5b4); d1 = m.rw(0xe5b6); d2 = m.rw(0xe5b8); d3 = 0;
  };
  const out = (): [number, number, number, number] => [w(d0 >>> 16), w(d1 >>> 16), w(d2 >>> 16), w(d3)];
  const store = (): void => {
    m.ww(0x86ba, -1);
    m.wl(0x86da, d0); m.wl(0x86de, d1); m.wl(0x86e2, d2); m.wl(0x86e6, d3);
  };
  if (m.rw(0x86b8) !== 0) {
    d0 = m.rl(0x86ca); d1 = m.rl(0x86ce); d2 = m.rl(0x86d2); d3 = m.rl(0x86d6);
    return out();
  }
  const st = m.rw(0xe5a2);
  let noCatch = st === 0 || st === 3;
  if (!noCatch && peakHeight(m) < 0x3c) noCatch = true;
  if (!noCatch && m.rw(0xe5ac) < 0) {
    if (m.rw(0xe5b8) < 0x3c) noCatch = true;
    else if (!(m.rw(0xe5b8) > 0x74)) {
      words();
      return out();
    }
  }
  if (noCatch) {
    words();
    d3 = 0x0000ffff;
    store();
    return out();
  }
  // still rising (or above catching height): time to fall to height $74
  let a = asr(m.rl(0xe5ac), 8);
  a = muls(a, a);
  let b = l(m.rl(0xe5b8) - 0x740000);
  b = l(b + b);
  b = div32(b, 5);
  a = l(a + b);
  a = isqrt(a);
  a = l(a << 16) >> 8;
  a = l(a + m.rl(0xe5ac));
  d3 = l(a * 5);
  const d4 = hiAfterShift(d3, 6);
  d0 = l(muls(d4, asr(m.rl(0xe5a8), 7)) * 2 + m.rl(0xe5b4));
  d2 = l(muls(d4, asr(m.rl(0xe5b0), 7)) * 2 + m.rl(0xe5bc));
  d1 = 0x740000;
  d3 = (d3 >>> 16) & 0xffff;
  store();
  return out();
}

// ---------------------------------------------------------------- fielder geometry and movement

/** sub_038D4E: which of 8 directions the fielder faces (for the hand offset tables) */
export const octant = (m: Ram, a0: number): number => ((w(0x280 - m.rw(a0 + 0x56)) & 0xffff) >> 8) & 7;
/** sub_038D26: subtract the hand offset for his facing (table of 8 [dx, dy]) */
export function minusHand(m: Ram, a0: number, table: number, x: number, y: number): [number, number] {
  const o = octant(m, a0) * 4;
  return [w(x - ROM.rw(table + o)), w(y - ROM.rw(table + o + 2))];
}
export function plusHand(m: Ram, a0: number, table: number, x: number, y: number): [number, number] {
  const o = octant(m, a0) * 4;
  return [w(x + ROM.rw(table + o)), w(y + ROM.rw(table + o + 2))];
}
/** sub_038D86: squared distance from the fielder to (x, y) */
export function dist2(m: Ram, a0: number, x: number, y: number): number {
  const dx = w(x - m.rw(a0 + 0x3c)), dy = w(y - m.rw(a0 + 0x44));
  return l(muls(dx, dx) + muls(dy, dy));
}
/** sub_038D5E: to the ball */
export const dist2Ball = (m: Ram, a0: number): number => dist2(m, a0, m.rw(0xe5b4), m.rw(0xe5bc));
/** sub_038D74: to his target */
export const dist2Target = (m: Ram, a0: number): number => dist2(m, a0, m.rw(a0 + 0x2c), m.rw(a0 + 0x30));

/** sub_03911E: shortest signed turn from angle d1 to angle d0 */
function turnDiff(d0: number, d1: number): number {
  let d2 = w(d0 - d1);
  if (d2 < 0) { if (d2 < w(0xfc00)) d2 = w(d2 + 0x800); }
  else if (d2 > 0x400) d2 = w(d2 + 0xf800);
  return d2;
}
/** sub_0390EE: turn from `cur` towards `target` by at most $C706 */
export function turnToward(m: Ram, target: number, cur: number): number {
  const rate = m.rw(0xc706);
  let d1 = cur;
  if (turnDiff(target, d1) >= 0) {
    d1 = (d1 + rate) & 0x7ff;
    if (turnDiff(target, d1) < 0) d1 = target;
  } else {
    d1 = (w(d1 - rate)) & 0x7ff;
    if (turnDiff(target, d1) >= 0) d1 = target;
  }
  return w(d1);
}
/** sub_038CFC: turn to face (x, y); true once he faces it */
export function face(m: Ram, a0: number, x: number, y: number): boolean {
  const want = angleTo(x, y, m.rw(a0 + 0x3c), m.rw(a0 + 0x44));
  const now = turnToward(m, want, m.rw(a0 + 0x56));
  m.ww(a0 + 0x56, now);
  return w(now) === w(want);
}
export const faceBall = (m: Ram, a0: number): boolean => face(m, a0, m.rw(0xe5b4), m.rw(0xe5bc)); // sub_038CCC
export const faceTarget = (m: Ram, a0: number): boolean => face(m, a0, m.rw(a0 + 0x2c), m.rw(a0 + 0x30)); // sub_038CE6

/** sub_038C4A: running animation advances with speed */
export function runAnim(m: Ram, a0: number): void {
  const d0 = l(l(m.rw(a0 + 0x48) << 16) >> 6);
  m.wl(a0 + 0x5e, l(m.rl(a0 + 0x5e) + d0));
  if (m.rw(a0 + 0x5e) >= 9) m.ww(a0 + 0x5e, m.rw(a0 + 0x5e) - 8);
}

/** sub_038B2A: run straight ahead (facing $56) at his speed */
export function runAhead(m: Ram, a0: number): void {
  const i = m.rw(a0 + 0x56) & 0x7ff;
  const c = COS(i), s = SIN(i);
  const sp = w(m.rw(a0 + 0x48) << 5);
  m.wl(a0 + 0x3c, l(m.rl(a0 + 0x3c) + asr(muls(sp, c), 4)));
  m.wl(a0 + 0x44, l(m.rl(a0 + 0x44) + asr(muls(sp, s), 4)));
  runAnim(m, a0);
}

/** sub_038BAC: run towards the target ($2C, $30) at his speed, without overshooting it */
function runToTarget(m: Ram, a0: number): void {
  const d6 = w(m.rw(a0 + 0x2c) - m.rw(a0 + 0x3c));
  const d7 = w(m.rw(a0 + 0x30) - m.rw(a0 + 0x44));
  const dist = hypot(d6, d7);
  const unit = (d: number): number => {
    const n = l(l(d << 16) >> 1);
    if (w(dist) === 0) return n; // the original's divide-by-zero trap returns with the register unchanged
    const r = divs(n, dist);
    return r.overflow ? ((n & ~0xffff) | 0x7fff) : r.reg;
  };
  let d0 = unit(d6), d1 = unit(d7);
  const sp = w(m.rw(a0 + 0x48) << 5);
  d0 = asr(muls(sp, d0), 4);
  m.wl(a0 + 0x3c, l(m.rl(a0 + 0x3c) + d0));
  if (d0 >= 0) { if (!(m.rw(a0 + 0x2c) >= m.rw(a0 + 0x3c))) m.ww(a0 + 0x3c, m.rw(a0 + 0x2c)); }
  else if (!(m.rw(a0 + 0x2c) <= m.rw(a0 + 0x3c))) m.ww(a0 + 0x3c, m.rw(a0 + 0x2c));
  d1 = asr(muls(sp, d1), 4);
  m.wl(a0 + 0x44, l(m.rl(a0 + 0x44) + d1));
  if (d1 >= 0) { if (!(m.rw(a0 + 0x30) >= m.rw(a0 + 0x44))) m.ww(a0 + 0x44, m.rw(a0 + 0x30)); }
  else if (!(m.rw(a0 + 0x30) <= m.rw(a0 + 0x44))) m.ww(a0 + 0x44, m.rw(a0 + 0x30));
}

/** sub_038B66: run to the target, but not over the rope (he stops and stands there) */
export function moveToTarget(m: Ram, a0: number): void {
  const x = m.rw(a0 + 0x3c), y = m.rw(a0 + 0x44);
  runToTarget(m, a0);
  if (outside(m.rw(a0 + 0x3c), m.rw(a0 + 0x44))) {
    m.ww(a0 + 0x3c, x); m.ww(a0 + 0x44, y);
    standFrame(m, a0);
  } else runAnim(m, a0);
}

/** sub_038994: standing frame: $15 (holding the ball, ready) for the fielder in play, else 0 */
export function standFrame(m: Ram, a0: number): void {
  const st = m.rw(0xc6d0);
  let active = false;
  if (st < 2) active = false;
  else if (st === 2) active = a0 === ptr(m, 0xc730) && m.rl(0xc730) === fullPtr(a0);
  else if (st === 3 || st === 4) active = m.rl(0xc776) === fullPtr(a0);
  else active = m.rl(0xc730) === fullPtr(a0);
  m.ww(a0 + 0x5e, active ? 0x15 : 0);
}

/** sub_038C7A: a fielder's running speed (by difficulty, computer or human side) */
export function fielderSpeed(m: Ram): number {
  let d0 = w(m.rw(0x8604) << 3);
  if (m.rw(0xb526) < 0) d0 = w(d0 + 4);
  if (m.rw(0x8602) !== 0) d0 = w(d0 + 2);
  return ROM.rw(0x38cb4 + d0);
}

// ---------------------------------------------------------------- animation scripts

/** sub_0389DC: start an animation script */
export function animStart(m: Ram, a0: number, script: number): number {
  m.ww(a0 + 0x5a, 0); m.ww(a0 + 0x5c, 0); m.ww(a0 + 0x58, 0);
  return animStep(m, a0, script).code;
}

export interface AnimResult { code: "run" | "event" | "end"; value: number }

/** sub_0389EE: advance an animation script (nothing once it has ended) */
export function animTick(m: Ram, a0: number, script: number): AnimResult {
  // an ended script reports "ended" again (the flags of tst.w $58); d0 is left as it was
  if (m.rw(a0 + 0x58) < 0) return { code: "end", value: -1 };
  return animStep(m, a0, script);
}

/** sub_0389FA: script words: >= 0 frame; -1 n: set rate; -2 n: hold n+1 frames; -3 f n: frame f
 *  for n+1 ticks; -4 x: skip; -5 n: event n; anything else: end */
function animStep(m: Ram, a0: number, s: number): AnimResult {
  if (m.aw(a0 + 0x5c, -1) >= 0) return { code: "run", value: 0 };
  m.ww(a0 + 0x5c, m.rw(a0 + 0x5a));
  for (;;) {
    const p = m.rw(a0 + 0x58);
    const d1 = ROM.rw(s + p);
    if (d1 >= 0) { m.ww(a0 + 0x58, p + 2); m.ww(a0 + 0x5e, d1); return { code: "run", value: 0 }; }
    const op = w(-d1 - 1);
    if (op === 0) {
      const r = ROM.rw(s + p + 2);
      m.ww(a0 + 0x5a, r); m.ww(a0 + 0x5c, r); m.ww(a0 + 0x58, p + 4);
      continue;
    }
    if (op === 1) {
      m.ww(a0 + 0x5c, w(muls(w(ROM.rw(s + p + 2) + 1), w(m.rw(a0 + 0x5a) + 1)) - 1));
      m.ww(a0 + 0x58, p + 4);
      return { code: "run", value: 0 };
    }
    if (op === 2) {
      m.ww(a0 + 0x5e, ROM.rw(s + p + 2));
      m.ww(a0 + 0x5c, ROM.rw(s + p + 4));
      m.ww(a0 + 0x58, p + 6);
      return { code: "run", value: 0 };
    }
    if (op === 3) { m.ww(a0 + 0x58, p + 4); return { code: "run", value: 0 }; }
    if (op === 4) { m.ww(a0 + 0x58, p + 4); return { code: "event", value: ROM.rw(s + p + 2) }; }
    m.ww(a0 + 0x58, -1);
    return { code: "end", value: -1 };
  }
}

/** sub_038AD6 / sub_038AB0: ticks a script takes to reach event `ev` (or its end) from the start
 *  (fromNow: from where the fielder is in it now) */
export function animTicks(m: Ram, a0: number, s: number, ev: number, fromNow: boolean): number {
  let d4 = 0, d5 = 0, d7 = 0;
  const a1start = s;
  if (fromNow) {
    d4 = m.rw(a0 + 0x5c); d5 = m.rw(a0 + 0x5a);
    if (m.rw(a0 + 0x58) < 0) return 0;
    // the original computes the current position but then reads from the script's start (a1)
  }
  let a1 = a1start;
  for (;;) {
    d7 = w(d7 + d4); d4 = d5; // loc_038AE2
    for (;;) { // loc_038AE6
      const v = ROM.rw(a1); a1 += 2;
      if (v >= 0) break;
      const op = w(-v - 1);
      if (op === 0) { d5 = w(ROM.rw(a1) + 1); a1 += 2; d4 = d5; continue; }
      if (op === 1) { d4 = w(muls(w(ROM.rw(a1) + 1), d5)); a1 += 2; break; }
      if (op === 2) { a1 += 2; d4 = w(muls(w(ROM.rw(a1) + 1), d5)); a1 += 2; break; }
      if (op === 3) { a1 += 2; break; }
      if (op === 4) { const e = ROM.rw(a1); a1 += 2; if (e !== w(ev)) break; return d7; }
      return d7;
    }
  }
}

export { absW, mulu, divu };
