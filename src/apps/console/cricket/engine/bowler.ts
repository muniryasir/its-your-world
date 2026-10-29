// The bowler: run-up spline, run-up animation counter and the release of the ball.
// Ported from sub_04357A, sub_043626, sub_04407A, sub_044146, sub_044190, sub_044236, sub_04444C,
// sub_044480 and sub_04863A. RAM addresses are the original ones (low 16 bits of $FFxxxx).

import { Ram, ROM, SIN } from "./mem";
import { w, l, muls, asr, lsl, swap, hiAfterShift, divs, divu, div32 } from "./m68k";
import { Context } from "./context";
import { ballTrack, resetObjects } from "./collide";

const SPL = 0xd22c; // spline struct: +0 template ptr, +6 frames left, +$A step, +$E t, +$12 x, +$16 y, +$1A points

/** sub_04357A: set up a cubic B-spline through the template's control points */
export function splineInit(m: Ram, a0: number, tpl: number, d0: number): void {
  // the template is in ROM, or in RAM when given as $FFxxxx
  const RD = { rw: (a: number) => (a >= 0xff0000 ? m.rw(a) : ROM.rw(a)), rl: (a: number) => (a >= 0xff0000 ? m.rl(a) : ROM.rl(a)) };
  m.wl(a0, tpl >= 0xff0000 ? (0xffff0000 | tpl) : tpl);
  m.ww(a0 + 6, d0 - 1);
  const n = RD.rw(tpl); // number of segments
  const d1 = w(n + 2);
  m.wl(a0 + 0xe, div32(0x7fffffff, d1));
  let d2 = div32(0x7fffffff, d0);
  let d3 = div32(0x7fffffff, muls(d0, d1));
  d3 = l(d3 + d3);
  d2 = l(d2 - d3);
  m.wl(a0 + 0xa, d2);
  m.wl(a0 + 0x12, RD.rw(tpl + 2) << 16);
  m.wl(a0 + 0x16, RD.rw(tpl + 4) << 16);
  // control points, padded with mirrored end points (2*p0 - p1 and 2*pn - p(n-1))
  let a3 = a0 + 0x1a;
  m.ww(a3, n + 2);
  a3 += 2;
  const p = (i: number) => RD.rw(tpl + 2 + 2 * i);
  m.ww(a3, 2 * p(0) - p(2)); m.ww(a3 + 2, 2 * p(1) - p(3)); a3 += 4;
  for (let i = 0; i <= n; i++) { m.wl(a3, RD.rl(tpl + 2 + 4 * i)); a3 += 4; }
  const k = 2 * (n - 1); // last two points: p(n-1), p(n)
  m.ww(a3, 2 * p(k + 2) - p(k)); m.ww(a3 + 2, 2 * p(k + 3) - p(k + 1));
}

/** sub_043626: evaluate the spline at t (16.16) with the uniform cubic B-spline basis, then advance t */
export function splineStep(m: Ram, a0: number): void {
  if (m.rw(a0 + 6) < 0) return;
  let a1 = a0 + 0x1a;
  const n = m.rw(a1); a1 += 2;
  m.wl(a0 + 0x12, 0);
  m.wl(a0 + 0x16, 0);
  const thi = m.rw(a0 + 0xe); // high word of t
  for (let d3 = n; d3 >= 0; d3--) {
    let d4 = w(n - d3) << 16;
    let d5 = muls(thi, n);
    d5 = l(d5 + d5);
    d4 = l(d4 - d5);
    if (d4 < 0) d4 = l(-d4);
    if (d4 <= 0x20000) {
      const px = m.rw(a1), py = m.rw(a1 + 2);
      if (d4 < 0x10000) {
        // (4 - 6t^2 + 3t^3) / 6
        d4 = asr(d4, 2);
        let d5l = lsl(muls(d4, d4), 2); // muls d5,d5 ; lsl #2
        const d5w = w(d5l >>> 16); // swap
        let m4 = muls(d5w, d4);
        m4 = l(m4 + m4);
        let d6 = m4;
        m4 = l(m4 + m4);
        m4 = l(m4 + d6);
        d6 = d5l;
        d5l = l(d5l + d5l);
        d5l = l(d5l + d6);
        m4 = l(m4 - d5l);
        m4 = asr(m4, 8);
        m4 = asr(m4, 6);
        m4 = l(m4 + 0x20000);
        const q = divs(m4, 6).q;
        m.wl(a0 + 0x12, m.rl(a0 + 0x12) + l(2 * muls(q, px)));
        m.wl(a0 + 0x16, m.rl(a0 + 0x16) + l(2 * muls(q, py)));
      } else {
        // (2 - t)^3 / 6
        d4 = l(-d4 + 0x20000);
        d4 = asr(d4, 2);
        const d5w = w(muls(d4, d4) >>> 16);
        let m4 = muls(d5w, d4);
        m4 = asr(m4, 8);
        m4 = asr(m4, 2);
        const q = divs(m4, 6).q;
        m.wl(a0 + 0x12, m.rl(a0 + 0x12) + muls(q, px));
        m.wl(a0 + 0x16, m.rl(a0 + 0x16) + muls(q, py));
      }
    }
    a1 += 4;
  }
  m.wl(a0 + 0xe, m.rl(a0 + 0xe) + m.rl(a0 + 0xa));
  m.aw(a0 + 6, -1);
}

/** sub_04407A: start the run-up along template `tpl`, lasting `frames` animation steps */
export function runupInit(m: Ram, tpl: number, frames: number): void {
  splineInit(m, SPL, tpl, 0x40);
  const d0 = w(frames);
  m.ww(SPL + 6, d0 - 1);
  const idx = 4 * (ROM.rw(tpl) - 3);
  m.wl(SPL + 0xe, ROM.rl(0x440e6 + idx));
  m.wl(SPL + 0xa, div32(ROM.rl(0x44116 + idx), d0));
  m.ww(0xd26c, m.rw(SPL + 0x12));
  m.ww(0xd270, m.rw(SPL + 0x16));
  m.wl(0xd27c, div32(0x280000, d0));
}

/** sub_044146: change the run-up speed (frames to the end) */
function runupSpeed(m: Ram, frames: number): void {
  const tpl = m.rl(SPL);
  const idx = 4 * (ROM.rw(tpl) - 3);
  const d0 = w(frames);
  m.wl(SPL + 0xa, div32(ROM.rl(0x44116 + idx), d0));
  m.wl(0xd27c, div32(0x280000, d0));
}

/** sub_044190 */
function runupStep(m: Ram): void {
  splineStep(m, SPL);
  m.ww(0xd26c, m.rw(SPL + 0x12));
  m.ww(0xd270, m.rw(SPL + 0x16));
}

export const bowlerScaleExport = (m: Ram, ctx: Context, d0: number): number => bowlerScale(m, ctx, d0);

/** sub_04444C: scale a bowling value by the bowler's accuracy (human bowler only) */
function bowlerScale(m: Ram, ctx: Context, d0: number): number {
  if (m.rw(0xb526) < 0) return d0;
  let d1 = w(0x150 - ctx.bowler.a12 - ctx.bowler.a12);
  if (d1 > 0x100) d1 = 0x100;
  return asr(muls(d0, d1), 8);
}

/** sub_04863A: the ball becomes live */
export function ballLive(m: Ram, d0: number): void {
  if (m.rw(0xe5a2) !== 0) return;
  m.ww(0xe5a2, d0);
  m.ww(0xe936, d0);
  m.ww(0xe58c, 0);
  m.ww(0xe934, 0);
  m.ww(0x86ba, 0);
  m.ww(0x86b6, 0);
  m.ww(0x86bc, -1);
  m.ww(0xe8d2, 0);
  m.ww(0xe564, 0);
  resetObjects(m); // sub_048B98
  ballTrack(m); // sub_048910
}

/** sub_044480: release velocity. d0 = pace, d1 = release height term, d2/d3 = vector to the pitch marker */
function releaseVelocity(m: Ram, d0: number, d1: number, d2: number, d3: number): void {
  let d4 = l(w(d0) << 16);
  d4 = asr(d4, 1);
  d4 = l(d4 + 0x200000);
  m.wl(0xe5b0, d4); // vy
  d4 = swap(lsl(d4, 7));
  let d5 = w(d2 + d2);
  d5 = lsl(muls(d4, d5), 8);
  const dy = w(d3);
  d5 = div32(d5, dy);
  let d6 = l(m.rw(0xd286) << 16);
  d6 = asr(d6, 5);
  m.d6hi = w(d6 >> 16); // sub_044480 doesn't restore d6
  d5 = l(d5 - d6);
  m.wl(0xe5a8, d5); // vx
  d5 = w(m.rw(0xd286) << 5);
  d5 = muls(d5, d4);
  m.wl(0xe5a4, div32(d5, dy)); // ax (swing)
  let h = w(-d1);
  h = w(h + h);
  h = muls(h, d4);
  h = l(h + h);
  h = div32(h, dy);
  let g = muls(dy, 0x3333);
  g = div32(g, d4);
  g = asr(g, 1);
  h = l(h + g);
  h = lsl(h, 7);
  m.wl(0xe5ac, h); // vz
  ballLive(m, 1);
}

/** sub_044236: one tick of the bowler (run-up animation, release at frame 23) */
export function bowlerTick(m: Ram, ctx: Context): void {
  if (m.rw(0xd28c) === 0) return;
  if (m.rw(0xd278) < 0x28) {
    runupSpeed(m, w(0x98 - (m.rw(0xe95a) >> 1)));
    runupStep(m);
  }
  if (m.rw(0xd278) >= 0x28) {
    m.ww(0xd28c, -1);
    if (m.rw(0xd28a) !== 0) {
      m.aw(0xd278, 1);
      m.aw(0xd28a, -1);
    }
  } else {
    m.wl(0xd278, m.rl(0xd278) + m.rl(0xd27c));
  }
  if (m.rw(0xe5a2) !== 0 || m.rw(0xd278) !== 0x17) return;

  // release
  m.ww(0xe958, -1);
  m.ww(0xe580, 0);
  m.ww(0xe5b4, m.rw(0xd26c) + 8 - (m.rw(0xd274) !== 0 ? 0x10 : 0));
  m.ww(0xe5b8, 0xc4);
  m.ww(0xe5bc, m.rw(0xd270) + 0x20);
  m.wl(0xe5ac, 0);
  let d0 = SIN(m.rw(0xe956));
  if (d0 >= 0) d0 = w(-d0);
  d0 = w((d0 >> 8) + 0x80);
  const type = m.rw(0xd28e);
  const pace = m.rw(0xe95a);
  const B = (i: number) => m.rw(0xd212 + 2 * i); // bowling table $D212
  if (type - 1 < 0) {
    // fast
    d0 = l(muls(d0, B(0)) + muls(pace, B(1)));
    d0 = asr(d0, 8);
    d0 = bowlerScale(m, ctx, d0);
    d0 = w(d0 + B(2));
  } else if (type - 3 < 0) {
    // spin
    d0 = asr(muls(d0, m.rw(0xc5c6)), 8);
    d0 = asr(muls(d0, B(6)), 8);
    if (m.rw(0xe954) < 0) d0 = w(-d0);
    d0 = bowlerScale(m, ctx, d0);
    m.ww(0xd282, d0);
    d0 = asr(muls(pace, B(7)), 8);
    d0 = bowlerScale(m, ctx, d0);
    d0 = w(d0 + B(8));
  } else {
    // swing
    d0 = asr(muls(d0, m.rw(0xc5c8)), 8);
    d0 = asr(muls(d0, B(3)), 8);
    if (m.rw(0xe954) < 0) d0 = w(-d0);
    d0 = bowlerScale(m, ctx, d0);
    m.ww(0xd286, d0);
    d0 = asr(muls(pace, B(4)), 8);
    d0 = bowlerScale(m, ctx, d0);
    d0 = w(d0 + B(5));
  }
  // shorter deliveries are bowled slightly slower
  const d1 = hiAfterShift(muls(w(0x400 - m.rw(0xd1da)), B(12)), 6);
  d0 = w(d0 + d1);
  const d2 = w(m.rw(0xd1d6) - m.rw(0xe5b4));
  const d3 = w(m.rw(0xd1da) - m.rw(0xe5bc));
  if (m.rw(0xb526) < 0) d0 = w(d0 + 12 * m.rw(0x8604) + 8);
  releaseVelocity(m, d0, 0xbc, d2, d3);
  m.ww(0xe8fa, 0); // sub_04B944
}

/** sub_04B962 + sub_04C154: the run-up pace meter at $E8FA, copied to $E95A each pass.
 *  +0 active, +2 controller (<0 = computer), +4 frames since the last tap, +6 tap state,
 *  +8 acceleration, +$C deceleration, +$10 pace (long), +$14 target (long), +$18 tap ring index,
 *  +$1A eight tap intervals. A human bowler raises the pace by tapping the button ($C0C4). */
export function paceMeter(m: Ram, buttonsHeld: (ctl: number) => number): void {
  const a0 = 0xe8fa;
  if (m.rw(a0) !== 0) {
    if (m.rw(a0 + 2) < 0) {
      if (m.rw(0xd1f0) > m.rw(a0 + 0x10)) m.wl(a0 + 0x10, m.rl(a0 + 0x10) + 0x10000);
    } else {
      if (m.aw(a0 + 4, 1) < 0) m.aw(a0 + 4, -1);
      for (let i = 0; i < 8; i++) if (m.aw(a0 + 0x1a + 2 * i, 1) < 0) m.aw(a0 + 0x1a + 2 * i, -1);
      const down = buttonsHeld(m.rw(a0 + 2)) & m.rw(0xc0c4);
      const st = m.rw(a0 + 6);
      let tap = false;
      if (st === 0) {
        m.ww(a0 + 6, down ? 1 : -1);
        m.ww(a0 + 4, 1);
      } else if (st < 0) {
        if (down) { m.ww(a0 + 6, 1); tap = true; }
      } else if (!down) {
        m.ww(a0 + 6, -1); tap = true;
      }
      if (tap) {
        const k = (m.rw(a0 + 0x18) + 1) & 7;
        m.ww(a0 + 0x18, k);
        m.ww(a0 + 0x1a + 2 * k, m.rw(a0 + 4));
        m.ww(a0 + 4, 1);
      }
      let d0 = 2 * m.rw(a0 + 0x18);
      let d1 = 0;
      for (let i = 0; i < 8; i++) {
        const r = divu(0x12000, m.rw(a0 + 0x1a + d0));
        d1 = l(d1 + l((r.reg & 0xffff) << 16));
        d0 = (d0 - 2) & 0xe;
      }
      d1 = l((d1 >>> 7) - 0x500000);
      if (d1 < 0) d1 = 0;
      if (d1 > 0x7f0000) d1 = 0x7f0000;
      m.wl(a0 + 0x14, d1);
      let v = m.rl(a0 + 0x10);
      const target = m.rl(a0 + 0x14);
      if (v !== target) {
        if (v > target) {
          v = l(v - m.rl(a0 + 0xc));
          if (v < 0) v = 0;
        } else {
          v = l(v + m.rl(a0 + 8));
          if (v > target) v = target;
        }
        m.wl(a0 + 0x10, v);
      }
    }
  }
  m.ww(0xe95a, m.rw(a0 + 0x10)); // sub_04B952 -> $E95A
}
