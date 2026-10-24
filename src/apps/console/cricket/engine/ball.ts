// Ball physics: sub_0486DC (one step), sub_048AE0 (spin turn at the bounce).
// Ball state at $E5A2.. : state/phase words, then longs (16.16): ax $E5A4, vx $E5A8, vz $E5AC,
// vy $E5B0, x $E5B4, z (height) $E5B8, y (along the pitch) $E5BC. Gravity is $3333 per step.

import { Ram, SIN, COS } from "./mem";
import { w, l, muls, asr, hiAfterShift } from "./m68k";

export const GRAVITY = 0x3333;

/** sub_048AE0: rotate the horizontal velocity by the spin angle ($D282) plus the pitch's turn ($C5CC) */
export function spinTurn(m: Ram): void {
  const ang = w(-(m.rw(0xd282) + m.rw(0xc5cc))) & 0x7ff;
  const s = SIN(ang), c = COS(ang);
  const d0 = hiAfterShift(m.rl(0xe5a8), 6);
  const d1 = hiAfterShift(m.rl(0xe5b0), 6);
  m.wl(0xe5b0, asr(l(muls(c, d1) + muls(s, d0)), 5));
  m.wl(0xe5a8, asr(l(muls(c, d0) - muls(s, d1)), 5));
}

/** sub_0486DC. `onFirstBounce` runs sub_045614 (the batting timing assist), supplied by the batting code. */
export function ballStep(m: Ram, onFirstBounce: () => void): void {
  if (m.rw(0xe936) === 0) return;
  const hold = m.rw(0xe58c);
  if (hold === -1) return;
  if (hold !== 0) {
    m.ww(0xe58c, hold < 0 ? hold + 1 : hold - 1);
    return;
  }
  const phase = m.rw(0xe936);
  if (phase === 1) {
    let vx = m.rl(0xe5a8), vz = m.rl(0xe5ac);
    const vy = m.rl(0xe5b0);
    vx = l(vx + m.rl(0xe5a4));
    m.wl(0xe5b4, m.rl(0xe5b4) + vx);
    vz = l(vz - GRAVITY);
    m.wl(0xe5b8, m.rl(0xe5b8) + vz);
    m.wl(0xe5bc, m.rl(0xe5bc) + vy);
    m.wl(0xe5a8, vx);
    m.wl(0xe5ac, vz);
    if (m.rl(0xe5b8) >= 0) return;
    // first bounce
    m.wl(0xe5b8, 0);
    m.ww(0xe598, m.rw(0xe5b4));
    m.ww(0xe580, -1);
    m.aw(0xe5a2, 1);
    m.aw(0xe936, 1);
    m.wl(0xe5a8, muls(hiAfterShift(vx, 8), m.rw(0xc5ba)));
    m.wl(0xe5b0, muls(hiAfterShift(vy, 8), m.rw(0xc5ba)));
    m.wl(0xe5ac, l(-muls(hiAfterShift(vz, 8), m.rw(0xc5bc))));
    spinTurn(m);
    if (m.rl(0xe5ac) > 0x92666) m.wl(0xe5ac, 0x92666);
    onFirstBounce();
    m.ww(0x86bc, -1);
    m.ww(0x86b8, 0);
    m.ww(0x86ba, 0);
    m.wb(0xe564, 0xff);
    return;
  }
  if (phase === 2) {
    const vx = m.rl(0xe5a8), vy = m.rl(0xe5b0);
    const vz = l(m.rl(0xe5ac) - GRAVITY);
    m.wl(0xe5ac, vz);
    m.wl(0xe5b4, m.rl(0xe5b4) + vx);
    m.wl(0xe5b8, m.rl(0xe5b8) + vz);
    m.wl(0xe5bc, m.rl(0xe5bc) + vy);
    if (m.rl(0xe5b8) >= 0) return;
    m.wl(0xe5b8, 0);
    m.ww(0xe580, -1);
    m.wl(0xe5a8, muls(hiAfterShift(vx, 8), m.rw(0xc5be)));
    m.wl(0xe5b0, muls(hiAfterShift(vy, 8), m.rw(0xc5be)));
    m.wl(0xe5ac, l(-muls(hiAfterShift(vz, 8), m.rw(0xc5c0))));
    m.ww(0x86bc, -1);
    m.ww(0x86b8, 0);
    m.ww(0x86ba, 0);
    if (m.rl(0xe5ac) <= 0x8000) {
      m.aw(0xe5a2, 1);
      m.aw(0xe936, 1);
      m.wl(0xe5ac, 0);
      m.wb(0xe564, 0xff);
    }
    return;
  }
  // rolling
  m.ww(0xe580, -1);
  const vx = m.rl(0xe5a8);
  m.wl(0xe5b4, m.rl(0xe5b4) + vx);
  const nvx = muls(hiAfterShift(vx, 8), m.rw(0xc5c2));
  m.wl(0xe5a8, nvx);
  const vy = m.rl(0xe5b0);
  m.wl(0xe5bc, m.rl(0xe5bc) + vy);
  const nvy = muls(hiAfterShift(vy, 8), m.rw(0xc5c2));
  m.wl(0xe5b0, nvy);
  m.wb(0xe564, 0xff);
  if (Math.abs(nvx) < 0x4800) m.wl(0xe5a8, 0);
  if (Math.abs(nvy) < 0x4800) m.wl(0xe5b0, 0);
}

/** rotate a velocity (vx, vy) by the spin angle, as sub_048AE0 does (used by the predictions) */
function turned(m: Ram, vx: number, vy: number): [number, number] {
  const ang = w(-(m.rw(0xd282) + m.rw(0xc5cc))) & 0x7ff;
  const s = SIN(ang), c = COS(ang);
  const d3 = hiAfterShift(vx, 6), d5 = hiAfterShift(vy, 6);
  return [asr(l(muls(c, d3) - muls(s, d5)), 5), asr(l(muls(c, d5) + muls(s, d3)), 5)];
}

export interface Predicted { x: number; z: number; y: number; ticks: number }

/** sub_045F10: follow the ball until its y reaches `target`; returns the position one step before.
 *  Side effects as in the original: $D354 (-1 = will have bounced), $D356 (ticks), $D358.. state at the bounce. */
export function predictAtY(m: Ram, target: number): Predicted {
  const a0 = l(w(target) << 16);
  const ax = m.rl(0xe5a4);
  let x = m.rl(0xe5b4), z = m.rl(0xe5b8), y = m.rl(0xe5bc);
  let vx = m.rl(0xe5a8), vz = m.rl(0xe5ac), vy = m.rl(0xe5b0);
  m.ww(0xd354, m.rw(0xe5a2) === 1 ? 0 : -1);
  m.ww(0xd356, 0);
  const tick = () => m.aw(0xd356, 1);
  const done = (): Predicted => {
    y = l(y - vy);
    return { x: w(x >>> 16), z: w(z >>> 16), y: w(y >>> 16), ticks: m.rw(0xd356) };
  };
  let phase = m.rw(0xe936) === 1 ? 1 : 2;
  if (phase === 1) {
    for (;;) {
      y = l(y + vy);
      if (y >= a0) return done();
      tick();
      vx = l(vx + ax); x = l(x + vx); vz = l(vz - GRAVITY); z = l(z + vz);
      if (z >= 0) continue;
      z = 0;
      vx = muls(hiAfterShift(vx, 8), m.rw(0xc5ba));
      vy = muls(hiAfterShift(vy, 8), m.rw(0xc5ba));
      vz = l(-muls(hiAfterShift(vz, 8), m.rw(0xc5bc)));
      [vx, vy] = turned(m, vx, vy);
      if (vz > 0x92666) vz = 0x92666;
      m.ww(0xd354, -1);
      m.wl(0xd364, vx); m.wl(0xd368, vz); m.wl(0xd36c, vy);
      m.wl(0xd358, x); m.wl(0xd35c, z); m.wl(0xd360, y);
      break;
    }
  }
  for (;;) {
    y = l(y + vy);
    if (y >= a0) return done();
    tick();
    x = l(x + vx); vz = l(vz - GRAVITY); z = l(z + vz);
    if (z >= 0) continue;
    z = 0;
    vx = muls(hiAfterShift(vx, 8), m.rw(0xc5be));
    vy = muls(hiAfterShift(vy, 8), m.rw(0xc5be));
    vz = l(-muls(hiAfterShift(vz, 8), m.rw(0xc5c0)));
    if (vz > 0x8000) continue;
    break;
  }
  for (;;) {
    y = l(y + vy);
    if (y >= a0) return done();
    tick();
    x = l(x + vx);
    vx = muls(hiAfterShift(vx, 8), m.rw(0xc5c2));
    vy = muls(hiAfterShift(vy, 8), m.rw(0xc5c2));
    if (m.rw(0xd356) >= 0xfa) return done();
  }
}

/** sub_046076: where the ball will be after `n` more ticks (x, z, y as words) */
export function predictAfter(m: Ram, n: number): Predicted {
  let left = w(n);
  const ax = m.rl(0xe5a4);
  let x = m.rl(0xe5b4), z = m.rl(0xe5b8), y = m.rl(0xe5bc);
  let vx = m.rl(0xe5a8), vz = m.rl(0xe5ac), vy = m.rl(0xe5b0);
  m.ww(0xd354, m.rw(0xe5a2) === 1 ? 0 : -1);
  const done = (): Predicted => ({ x: w(x >>> 16), z: w(z >>> 16), y: w(y >>> 16), ticks: n });
  if (m.rw(0xe936) === 1) {
    for (;;) {
      if (--left < 0) return done();
      vx = l(vx + ax); x = l(x + vx); y = l(y + vy); vz = l(vz - GRAVITY); z = l(z + vz);
      if (z >= 0) continue;
      z = 0;
      vx = muls(hiAfterShift(vx, 8), m.rw(0xc5ba));
      vy = muls(hiAfterShift(vy, 8), m.rw(0xc5ba));
      vz = l(-muls(hiAfterShift(vz, 8), m.rw(0xc5bc)));
      [vx, vy] = turned(m, vx, vy);
      if (vz > 0x92666) vz = 0x92666;
      m.wl(0xd358, x); m.wl(0xd35c, z); m.wl(0xd360, y);
      m.wl(0xd364, vx); m.wl(0xd368, vz);
      break;
    }
  }
  for (;;) {
    if (--left < 0) return done();
    x = l(x + vx); y = l(y + vy); vz = l(vz - GRAVITY); z = l(z + vz);
    if (z >= 0) continue;
    z = 0;
    vx = muls(hiAfterShift(vx, 8), m.rw(0xc5be));
    vy = muls(hiAfterShift(vy, 8), m.rw(0xc5be));
    vz = l(-muls(hiAfterShift(vz, 8), m.rw(0xc5c0)));
    if (vz > 0x8000) continue;
    break;
  }
  for (;;) {
    if (--left < 0) return done();
    x = l(x + vx); y = l(y + vy);
    vx = muls(hiAfterShift(vx, 8), m.rw(0xc5c2));
    vy = muls(hiAfterShift(vy, 8), m.rw(0xc5c2));
  }
}
