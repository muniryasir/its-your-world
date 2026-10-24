// Before the ball: per-delivery set-up and the computer bowler's aim and meters.
// Ported from sub_00E13E (the delivery loop), sub_043E4C (delivery init), sub_043FAC, sub_043298,
// sub_04336A / sub_0434D2 / sub_043C54 (computer aim), sub_0439BA (marker), sub_04BDFA / sub_04BE9E
// (swing/spin meter), sub_04BF62 / sub_04C082 (pace/line meter), sub_04C10A, sub_04C2BE.

import { Ram, ROM, SIN, COS } from "./mem";
import { w, l, muls, mulu, divs, divu } from "./m68k";
import { Context } from "./context";
import { rngNextAt } from "./rngAt";
import { runupInit, splineInit, splineStep, bowlerScaleExport } from "./bowler";
import { resetObjects } from "./collide";
import { batsmanReset, setHandedness } from "./batsman";

const MARKER_SPL = 0xd174; // computer aim path (spline struct)

/** sub_043E4C: set up the bowler for a new delivery */
export function deliveryInit(m: Ram, ctx: Context): void {
  for (let i = 0; i < 13; i++) m.ww(0xd212 + 2 * i, m.rw(0x6c8a + 2 * i)); // $FF6C8A copy of ROM $546CE
  for (const a of [0xd28a, 0xd28c, 0xd28e, 0xd290, 0xd280, 0xd274, 0xd278, 0xd28c]) m.ww(a, 0);
  m.wl(0xe5a4, 0); m.wl(0xd282, 0); m.wl(0xd286, 0);
  m.ww(0xd276, 2);
  const type = ctx.bowler.a14;
  if (type < 0) m.ww(0xd274, -1);
  m.ww(0xe574, 0x18);
  let tpl = 0x441c2;
  if (w(m.rw(0xd292) ^ type) < 0) { m.ww(0xe574, -0x18); tpl = 0x441ac; }
  let t = Math.abs(type) - 1;
  if (t < 0) t = 0;
  m.ww(0xd28e, t);
  runupInit(m, tpl, w(0x98 - (m.rw(0xe95a) >> 1)));
  let d0 = w(3 * ctx.bowler.a12) >> 1;
  if (d0 < 0x28) d0 = 0x28;
  if (d0 > 0x80) d0 = 0x80;
  d0 = w(((d0 - 0x28) >> 1) + 0x28);
  m.ww(0xd1bc, w(3 * d0) >> 3);
}

/** sub_043FAC: reset the meters */
export function meterReset(m: Ram): void {
  m.ww(0xe954, 0); m.ww(0xe956, 0); m.ww(0xe95a, 0); m.ww(0xe952, 0);
  m.ww(0xe94c, 0xe8); m.ww(0xe94e, 8); m.ww(0xe95c, -1);
}

/** sub_043298: the computer bowler's aim marker starts somewhere random */
export function aimInit(m: Ram, ctx: Context): void {
  let r = rngNextAt(m) & 0x7fff;
  let d0 = w(mulu(r, 0xc0) >>> 16);
  if (m.rw(0xe574) >= 0) d0 = w(-d0);
  m.ww(0xd1d6, d0);
  r = rngNextAt(m) & 0x7fff;
  m.ww(0xd1da, w((mulu(r, 0x900) >>> 16) - 0x80));
  m.wl(0xd1ce, 0x10000);
  const s = w(bowlerScaleExport(m, ctx, 0x100)); // ext.l d0 ; lsl.w #8,d0
  m.wl(0xd1ce, l((s & ~0xffff) | ((s << 8) & 0xffff)));
  if (m.rw(0xb526) >= 0) {
    let v = w(0x63 - ctx.bowler.a12);
    if (v < 0) v = 0;
    if (v > 0x43) v = 0x43;
    m.wl(0xd1ce, l((divu(mulu(v, 0xc000), 0x43).reg & 0xffff) + 0x4000));
  }
  m.wl(0xd1de, 0); m.wl(0xd1e2, 0);
  m.ww(0xd1d2, 0x12c);
  m.ww(0xd1e6, -0x8000); m.ww(0xd1e8, -0x8000); m.ww(0xd1ea, -0x8000);
}

/** the per-delivery set-up done by sub_00E13E before the aim (game-logic parts only) */
export function newDeliverySetup(m: Ram, ctx: Context): void {
  for (const a of [0xbf22, 0xbeda, 0xbee2, 0xd280, 0xd1f6, 0xc7f0]) m.ww(a, 0);
  m.ww(0x860a, -1); m.ww(0xc03a, -1); m.ww(0x860e, -1);
  m.ww(0xe8f6, 0x58); m.ww(0xd1d4, 1);
  m.wl(0xd1de, 0); m.wl(0xd1e2, 0);
  m.ww(0xd1d2, 0x12c); m.ww(0xbf1e, -1); m.ww(0xbf20, -1);
  m.ww(0xe5a2, 0); m.ww(0xe936, 0); m.ww(0xe934, 0); // sub_0486A4
  deliveryInit(m, ctx);
  meterReset(m);
  resetObjects(m);
  setHandedness(m, ctx.batsman.s18 !== 0); // sub_04469A
  batsmanReset(m, ctx);
  // sub_00EEBA: stumps and bails
  m.ww(0xbf36, 0); m.ww(0xbf56, 0); m.ww(0xbf24, 0); m.ww(0xbf28, 0); m.wl(0xbf2e, 0xf256);
  // sub_048406: umpire
  m.ww(0xe578, 0); m.ww(0xe57c, 2); m.ww(0xe57e, 0); m.ww(0xe57a, -1); m.ww(0xe576, 0);
  m.ww(0x860e, -1);
  aimInit(m, ctx);
}

/** sub_004C26: crowd noise timer, drawn once per delivery (it uses the shared random generator) */
export function crowdNoise(m: Ram): void {
  m.ww(0xfc40, 1);
  m.ww(0xfc42, (rngNextAt(m) & 0x3f) + 0x25);
}

// ---------------------------------------------------------------- the computer's aim

/** sub_043DF0: the striker's average-like rating (record +$1C << 8) and divisor (+$0E) */
function strikerRating(ctx: Context): [number, number] {
  return [l(w(ctx.batsman.s1c) << 8), ctx.batsman.a0e === 0 ? 1 : ctx.batsman.a0e];
}

/** sub_043D38: the line for a fast bowler: usually at the stumps, sometimes outside off or leg */
function fastLines(m: Ram): void {
  m.ww(0xd202, -0x28); m.ww(0xd204, 0x50); m.ww(0xd20a, -0x28); m.ww(0xd20c, 0x50);
  if (m.rw(0x8604) >= 2) return;
  // (callers pass the striker rating through the context)
  void 0;
}

/** sub_043C54: where the computer bowler aims (pitch x, y) */
function chooseTarget(m: Ram, ctx: Context): [number, number] {
  let a0: number; // address of (xLo, xRange, yLo, yRange)
  let fromRam = true;
  let d0 = Math.abs(ctx.bowler.a14);
  if (d0 - 1 !== 0) {
    a0 = 0x43e16 + 8 * (d0 - 1);
    fromRam = false;
  } else {
    // sub_043D38
    fastLines(m);
    if (m.rw(0x8604) < 2) {
      let [d1, d2] = strikerRating(ctx);
      if (m.rw(0x8604) !== 0) d2 += d2;
      d1 = divs(d1, d2).reg;
      const r = rngNextAt(m) & 0xff;
      if (!(r <= w(d1))) {
        const side = rngNextAt(m) & 0x80;
        const [x, rg] = side === 0 ? [0x19, 0x28] : [-0x41, 0x28];
        m.ww(0xd202, x); m.ww(0xd204, rg); m.ww(0xd20a, x); m.ww(0xd20c, rg);
      }
    }
    a0 = -1;
    if (m.rw(0xd1fe) < 1) {
      // a bouncer, with a chance that falls as the over goes on
      const balls = m.rw(0xbe68 + 0x30); // sub_00C80E
      const left = w(6 - balls);
      let d1 = l(w(1 - m.rw(0xd1fe)) << 8);
      d1 = divs(d1, left).reg;
      const r = rngNextAt(m) & 0xff;
      if (w(d1) > r) { m.aw(0xd1fe, 1); a0 = 0xd202; }
    }
    if (a0 < 0) {
      a0 = 0xd20a;
      // sub_043DCC: a yorker-length ball, less likely the more have been bowled
      const d1 = divs(l(w(m.rw(0xd200)) << 8), 6).reg;
      const r = rngNextAt(m) & 0xff;
      if (r > w(d1)) { m.ww(a0 + 4, 0x244); m.ww(a0 + 6, 0xdc); }
      else { m.ww(a0 + 4, 0x34c); m.ww(a0 + 6, 0xb4); m.aw(0xd200, 1); }
    }
  }
  const rd = (o: number) => (fromRam ? m.rw(a0 + o) : ROM.rw(a0 + o));
  let r = rngNextAt(m) & 0xff;
  let y = w((muls(r, rd(6)) >> 8) + rd(4) + 0x47f);
  r = rngNextAt(m) & 0xff;
  let x = w((muls(r, rd(2)) >> 8) + rd(0) + 0x3e);
  x = divs(muls(x, y), 0x87f).q;
  x = w(x - 0x3e);
  y = w(y - 0x47f);
  if (m.rw(0xd292) !== 0) x = w(-x);
  return [x, y];
}

/** sub_0434D2: a wobbly path for the aim marker from (x0, y0) to (x1, y1) */
function aimPath(m: Ram, x0: number, y0: number, x1: number, y1: number): void {
  const p = 0xd15a;
  m.ww(p, 3);
  m.ww(p + 2, x0); m.ww(p + 4, y0);
  m.ww(p + 6, w((w(x1 - x0) >> 2) + x0)); m.ww(p + 8, w((w(y1 - y0) >> 2) + y0));
  m.ww(p + 0xa, w((w(x0 - x1) >> 2) + x1)); m.ww(p + 0xc, w((w(y0 - y1) >> 2) + y1));
  m.ww(p + 0xe, x1); m.ww(p + 0x10, y1);
  // sub_049CE0: sqrt of the squared distance (low 16 bits only, as in the original)
  const sq = l(muls(w(x0 - x1), w(x0 - x1)) + muls(w(y0 - y1), w(y0 - y1))) & 0xffff;
  let lo = 0, hi = sq, mid = 0;
  for (;;) {
    mid = (lo + hi) >>> 1;
    let s2 = mulu(mid, mid) >>> 0;
    if (s2 === sq) break;
    if (s2 > sq) { hi = mid; continue; }
    s2 = (s2 + 2 * mid + 2) >>> 0;
    if (s2 >= sq) break;
    lo = mid;
  }
  const d2 = w(mid) >> 1;
  const wobble = (o: number) => {
    const v = w(rngNextAt(m) | 0x4000);
    m.ww(p + o, w(m.rw(p + o) + w(muls(v, d2) >>> 16)));
  };
  wobble(0xa); wobble(0xc); wobble(6); wobble(8);
  splineInit(m, MARKER_SPL, 0xff0000 | p, 0x40);
}

/** sub_04336A (computer bowler): move the aim marker along its path */
export function computerAim(m: Ram, ctx: Context): void {
  if (m.rw(0xd1d4) !== 0) return;
  let d0 = m.rw(0xd1f6);
  if (d0 === 0) {
    let tx: number, ty: number;
    if (m.rw(0xd294) !== 0) { tx = m.rw(0xd296); ty = m.rw(0xd298); }
    else { [tx, ty] = chooseTarget(m, ctx); m.ww(0xd296, tx); m.ww(0xd298, ty); }
    m.ww(0xd1fa, tx); m.ww(0xd1fc, ty);
    aimPath(m, m.rw(0xd1d6), m.rw(0xd1da), tx, ty);
    m.aw(0xd1f6, 1);
    d0 = 0x40; // d0 is left at $40 by sub_04357A
  }
  if (d0 - 1 !== 0) return;
  splineStep(m, MARKER_SPL);
  m.ww(0xd1d6, m.rw(MARKER_SPL + 0x12));
  m.ww(0xd1da, m.rw(MARKER_SPL + 0x16));
  if (m.rw(MARKER_SPL + 6) < 0) { m.ww(0xd1d4, -1); m.ww(0xd1d2, -1); }
}

/** sub_043A38 for the computer bowler: "presses A" once the aim path has finished */
export function computerButton(m: Ram): number {
  if (m.rw(0xd1f6) === 1 && m.rw(MARKER_SPL + 6) < 0) {
    m.aw(0xd1f6, 1);
    m.ww(0xd1d4, -1);
    return m.rw(0xc0c2);
  }
  return 0;
}

/** $E37A: the ball lands near, not exactly on, the marker (scatter grows with the marker size) */
export function scatter(m: Ram): void {
  m.ww(0xd1d4, -1); m.ww(0xd1d2, -1);
  if (m.rw(0xd294) !== 0) { m.ww(0xd1b8, m.rw(0xd29a)); m.ww(0xd1ba, m.rw(0xd29c)); return; }
  let d1 = w(0x400 - m.rw(0xd1da) + 0x480);
  d1 = divs(muls(d1, m.rw(0xd1bc)), 0x900).q;
  const d2 = w(3 * d1);
  const a = rngNextAt(m) & 0x7ff;
  const x = w(w(muls(COS(a), d1) >>> 16) + m.rw(0xd1d6));
  const y = w(w(muls(SIN(a), d2) >>> 16) + m.rw(0xd1da));
  m.ww(0xd1b8, x); m.ww(0xd29a, x);
  m.ww(0xd1ba, y); m.ww(0xd29c, y);
}

/** sub_0439BA (in the tick): the marker settles onto the scattered point and shrinks */
export function markerTick(m: Ram): void {
  if (m.rw(0xd1d4) >= 0) return;
  let d0 = w(m.rw(0xd1bc) - 4);
  if (d0 !== 0) { d0 = d0 >> 4; if (d0 === 0) d0 = 1; m.ww(0xd1bc, m.rw(0xd1bc) - d0); }
  for (const [cur, tgt] of [[0xd1d6, 0xd1b8], [0xd1da, 0xd1ba]]) {
    let d = w(m.rw(tgt) - m.rw(cur));
    if (d === 0) continue;
    d = d >> 4;
    if (d === 0) d = 1;
    m.ww(cur, m.rw(cur) + d);
  }
}

/** sub_04C2BE (from sub_04C190 in the tick): the active meter's countdown */
export function meterBlink(m: Ram): void {
  const k = m.rw(0xe950);
  if (k < 1 || k > 3) return;
  if (m.rw(0xe95c) < 0) return;
  m.aw(0xe95c, -1);
  if (m.aw(0xe95e, 1) > 6 && m.rw(0xe95e) >= 8) m.ww(0xe95e, 0);
}

/** sub_04BE9E (computer): when to choose the swing/spin direction and when to stop the meter */
export function computerSwingButton(m: Ram): number {
  const st = m.rw(0xe944);
  if (st === 0) {
    m.ww(0xe946, (rngNextAt(m) & 0x1f) + 0x30);
    m.aw(0xe944, 1);
    return 0;
  }
  if (st === 1) {
    if (m.aw(0xe946, -1) >= 0) return 0;
    m.aw(0xe944, 1);
    m.ww(0xe946, (rngNextAt(m) & 0xf) + 0x20);
    if (m.rw(0xd294) !== 0) return m.rw(0xd29e) === 0 ? 8 : 4;
    return rngNextAt(m) < 0 ? 8 : 4;
  }
  if (st === 2) {
    if (m.aw(0xe946, -1) >= 0) return 0;
    m.aw(0xe944, 1);
    m.ww(0xe946, (rngNextAt(m) & 0xf) + 0x20);
    return m.rw(0xc0c2);
  }
  return 0;
}

/** sub_04C082 (computer): when to stop the pace/line meter */
export function computerMeterButton(m: Ram): number {
  const st = m.rw(0xe944);
  if (st === 0) {
    if (m.rw(0xd294) !== 0) m.ww(0xe946, m.rw(0xd2a0));
    else { const r = (rngNextAt(m) & 0x1f) + 0x20; m.ww(0xe946, r); m.ww(0xd2a0, r); }
    m.aw(0xe944, 1);
    return 0;
  }
  if (st !== 1) return 0;
  if (m.aw(0xe946, -1) >= 0) return 0;
  m.aw(0xe944, 1);
  m.ww(0xe946, (rngNextAt(m) & 0xf) + 0x10);
  return m.rw(0xc0c2);
}

/** sub_04C10A: the computer bowler's run-up pace target, and the pace meter */
export function paceInit(m: Ram): void {
  if (m.rw(0xb526) < 0) {
    if (m.rw(0xd294) !== 0) m.ww(0xd1f0, m.rw(0xd2a2));
    else { const r = (rngNextAt(m) & 0x3f) + 0x20; m.ww(0xd1f0, r); m.ww(0xd2a2, r); }
  }
  // sub_04B8C2(0x100, 0x100, $B526)
  const a0 = 0xe8fa;
  m.ww(a0, 0); m.ww(a0 + 6, 0); m.wl(a0 + 0x10, 0);
  m.wl(a0 + 8, l(((0x100 * 0xc000) >>> 8) + 0x2000));
  m.wl(a0 + 0xc, l(((0x100 * 0xc000) >>> 8) + 0x2000));
  m.ww(a0 + 2, m.rw(0xb526));
  for (let i = 0; i < 8; i++) m.ww(a0 + 0x1a + 2 * i, 0x7fff);
  m.ww(a0, -1);
  m.ww(0xe950, 3);
  m.ww(0xe95c, 0x28);
}
