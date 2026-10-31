// The computer batsman: how he reads the field and the delivery, picks a shot, decides whether to loft
// it, and shuffles across his crease. Ported from sub_04BAB2 / sub_04BB3A / sub_04BC96 / sub_04BCA4 (the
// computer branches of the batting input), sub_046450 (choose a shot), sub_0465F4 (score one shot),
// sub_0468EE (sorted insert), sub_046572, sub_04498C, and the per-bowler tables of sub_04630A /
// sub_046384 / sub_046D80.
//
// RAM used: $E93A decided, $E93C the decision (pad bits), $E93E reaction delay; $E000 the 11 shot
// options (+0 frame, +2 index, +4 pad direction, +6 bat height); $DD30 per-option reach curves (32
// bytes each); $DFDA pointer to the weight record (ROM); $DF08/$DF0A sorted scores; $0F06 scores.

import { Ram, ROM } from "./mem";
import { w, l, muls, divs, divu, div32, asr } from "./m68k";
import { Context } from "./context";
import { rngNextAt } from "./rngAt";
import { predictAtY } from "./ball";
import { project } from "./project";
import { splineInit, splineStep } from "./bowler";
import { bodyScreen, heightForScreenY } from "./batsman";
import { wicketsDown } from "./score";

const BAT = 0x8610;
const OPTIONS = 0xe000;
const OPTION_TABLE = 0x46df2;

const weights = (m: Ram) => m.rl(0xdfda) & 0xffffff;

/** sub_04BC70: a depth into the perspective divisor used for the batsman's footwork */
function depthScale(d0: number): number {
  const p = l(muls(w(d0 - 0x59f), ROM.rw(0x4a5da)) * 2);
  return w((p >> 16) + 0x7e2);
}

/** sub_04BAB2 (computer): before the bowler lets go, step back towards the middle of the crease */
export function aiHeld(m: Ram): number {
  if (m.rw(0xd28c) !== 0) return 0;
  const x = m.rw(BAT);
  const d0 = m.rw(0xd2c6) === 0 ? w(x - 0x28) : w(x + 0x28);
  const d2 = depthScale(0x86a);
  const a = w(divs(l(w(d0) << 8), d2).reg);
  const b = w(w(divs(l(w(x) << 8), d2).reg) + 2);
  if (b < 0) {
    if (b >= -4) return 0;
    if (a >= 0xa) return 0;
    return 8;
  }
  if (b <= 4) return 0;
  if (a <= 0) return 0;
  return 4;
}

/** sub_04BB3A (computer): "a button" once the bowler has started */
export const aiButtons = (m: Ram): number => (m.rw(0xd28c) !== 0 ? 1 : 0);

/** sub_04BC96 (computer, loc_04BB58): forget the last decision. The reaction delay it draws is cleared
 *  again straight away (as in the original), but the random number is still used up. */
export function aiReset(m: Ram): void {
  m.ww(0xe93a, 0);
  m.ww(0xe93c, 0);
  let d0 = rngNextAt(m) & 7;
  if (m.rw(0xd28e) === 0) d0 &= 1;
  m.ww(0xe93e, d0);
  m.ww(0xe93e, 0);
}

/** sub_04BCA4 (computer, loc_04BB88): once the ball is live and the delay has run out, choose a shot
 *  (a direction) and whether to keep it down (A, $40) or loft it (B, $10); the same answer is given
 *  until the next reset */
export function aiShot(m: Ram, ctx: Context): number {
  if (m.rw(0xe5a2) < 1) return 0;
  if (m.rw(0xe93e) >= 0) { m.aw(0xe93e, -1); return 0; }
  if (m.rw(0xe93a) !== 0) return m.rw(0xe93c);
  const opt = chooseShot(m, ctx);
  const dir = m.rw(opt + 4);
  const b = ctx.batsman;
  let lofted: boolean;
  const q = divs(l(w(b.s1c) << 8), b.a0e === 0 ? 1 : b.a0e);
  if (q.overflow) lofted = true;
  else {
    let d0 = (w(q.reg) & 0xffff) >>> 4;
    const style = Math.abs(b.a10);
    if (style === 3) d0 = w(d0 + 0x10);
    else if (style === 2) d0 = w(d0 + 8);
    if (m.rw(0xbe7a) >= 0) {
      const d1 = d0;
      let t = w(m.rw(0xbe96) - m.rw(0xbe7a) + 4); // overs left, the fewer the bolder
      if (t < 0) t = 0;
      d0 = w(w(t << 3) + d1);
    }
    if (m.rw(0x8604) !== 2) { d0 = w(d0 + 8); if (m.rw(0x8604) !== 1) d0 = w(d0 + 8); }
    const r = rngNextAt(m) & 0xff;
    lofted = !(d0 < w((3 * r) >> 1));
  }
  const v = dir | (lofted ? 0x10 : 0x40);
  m.ww(0xe93c, v);
  m.ww(0xe93a, -1);
  return v;
}

// ---------------------------------------------------------------- choosing the shot

/** sub_046450: score the 11 shot options against this delivery and the field; returns the best one
 *  (its address in $E000). Also leaves the predicted ball at the batsman ($DFC6..$DFD8) and at the
 *  stumps ($DFBA..$DFC4). */
export function chooseShot(m: Ram, ctx: Context): number {
  const saved = m.rw(0xe936);
  m.ww(0xe936, m.rw(0xe5a2));
  for (let i = 0; i < 11; i++) m.wl(0xdeb0 + 4 * i, 0xffffe000 + 8 * i); // sub_04655A
  m.ww(0xdfc6, project(m.rw(BAT), 0, m.rw(BAT + 4))[0]);
  let p = predictAtY(m, m.rw(BAT + 4)); // sub_045F10
  m.ww(0xdfc8, m.rw(0xd356));
  m.ww(0xdfce, p.x); m.ww(0xdfd0, p.z); m.ww(0xdfd2, p.y);
  m.ww(0xdfd4, p.x); m.ww(0xdfd6, p.z); m.ww(0xdfd8, p.z);
  let s = project(p.x, w(-p.z), p.y);
  m.ww(0xdfca, s[0]); m.ww(0xdfcc, s[1]);
  p = predictAtY(m, 0x400);
  m.ww(0xdfba, m.rw(0xd356));
  m.ww(0xdfc0, p.x); m.ww(0xdfc2, p.z); m.ww(0xdfc4, p.y);
  s = project(p.x, w(-p.z), p.y);
  m.ww(0xdfbc, s[0]); m.ww(0xdfbe, s[1]);
  const a6 = weights(m);
  for (let i = 0; i < 11; i++) {
    m.wl(0x0f06 + 4 * i, scoreOption(m, ctx, a6, a6 + 0x1a + 16 * i, 0xdd30 + 32 * i, OPTIONS + 8 * i));
  }
  m.ww(0xdf08, -1);
  for (let i = 0; i < 11; i++) insertSorted(m, m.rl(0x0f06 + 4 * i), m.rl(0xdeb0 + 4 * i));
  const best = m.rl(0xdf0e) & 0xffff;
  const d6 = heightToAim(m, best);
  m.ww(0xdfd6, Math.abs(w(m.rw(best + 6) - d6)));
  m.ww(0xe936, saved);
  return best;
}

/** the signed byte table lookup used three times by sub_0465F4 */
const tbl = (m: Ram, base: number, i: number) => (i > 0x1f ? 0 : m.rb(base + i));

/** sub_0465F4: how attractive one shot option is for this ball. a6 weights (ROM), a2 option (ROM), a3
 *  its reach curve ($DD30 + 32 i), a4 the option ($E000 + 8 i) */
function scoreOption(m: Ram, ctx: Context, a6: number, a2: number, a3: number, a4: number): number {
  const b = ctx.batsman;
  const W6 = (o: number) => ROM.rw(a6 + o);
  // where the ball will pass the stumps (screen x), against the table $DE90
  let d0 = l(muls(tbl(m, 0xde90, Math.abs(w(m.rw(0xdfbc) - ROM.rw(0x46d70)))), W6(0)) >> 7);
  if (m.rw(0xdfc2) > 0x50) d0 = d0 >> 2;
  d0 = l(-d0 + 0x100);
  // the batsman's form
  let d1: number;
  const q = divu(l(w(b.s1c) << 8), b.a0e === 0 ? 1 : b.a0e);
  d1 = q.overflow ? 0x100 : w(q.reg);
  if (d1 > 0x100) d1 = 0x100;
  d1 = l(asr(muls(w(d1 - 0x80), W6(2)), 8) + 0x80);
  d0 = l(d0 + d1);
  d1 = asr(muls(b.a1a ?? 0, W6(4)), 6);
  if (d1 > 0x100) d1 = 0x100;
  d0 = l(d0 + d1);
  // (the original reads the word 16 bytes on, i.e. two options later)
  const st = Math.abs(m.rw(a4 + 0x10));
  d0 = l(d0 + (st === 1 ? 0x2a : st === 2 ? 0x80 : 0xd5));
  // the state of the game: overs left in a limited-overs game, else wickets in hand
  const lim = m.rw(0xbe7a);
  if (lim >= 0) {
    const steps: [number, number][] = [[0x20, 0x59], [0x20, 0x3b], [0x10, 0x36], [0x10, 0x31], [0x20, 0x27], [0x20, 0x13]];
    let k = 0;
    for (; k < steps.length; k++) { d0 = l(d0 + steps[k][0]); if (lim === steps[k][1]) break; }
    if (k === steps.length) d0 = l(d0 + 0x20);
    // ext.l, lsl.w #8, divs.w: the high word keeps the sign of the overs
    const ov = m.rw(0xbe96);
    const num = l((ov < 0 ? 0xffff0000 : 0) | ((ov << 8) & 0xffff));
    d0 = l(d0 + w(divs(num, lim).reg));
  } else {
    d0 = l(d0 + muls(w(10 - wicketsDown(m)), 0x19));
  }
  d0 = d0 >> 2;
  if (d0 < 0) d0 = 0;
  if (d0 > 0x100) d0 = 0x100;
  let v = w(d0 - ROM.rw(a2 + 8));
  if (v >= 0) v = w(-v);
  v = w(v + 0x100);
  if (v < 0) v = 0;
  if (v > 0x100) v = 0x100;
  d0 = asr(muls(v, W6(6)), 8);
  // the line of the ball against where this shot hits it
  let dx = ROM.rw(a2);
  if (m.rw(0xd2c6) !== 0) dx = w(-dx);
  d1 = Math.abs(w(w(m.rw(0xdfca) - m.rw(0xdfc6)) - dx));
  const d2 = w(0x40 - d1);
  d1 = d1 > 0x1f ? 0 : m.rb(a3 + d1);
  d1 = w(d1 + d2);
  d0 = l(d0 + asr(muls(d1, W6(8)), 7));
  // the height of the ball against the bat's height for this shot
  d1 = Math.abs(w(m.rw(a4 + 6) - m.rw(0xdfd0)));
  d1 = w(divs(muls(d1, 0x108), 0x50).reg);
  d0 = l(d0 - asr(muls(d1, W6(0xa)), 7));
  // which side of the wicket the ball passes, for leg-side / off-side shots
  const r = w(m.rw(0xdfbc) - ROM.rw(0x46d70));
  const side = m.rw(0xd2c6) !== 0 ? w(-r) : r;
  d1 = tbl(m, 0xde90, Math.abs(r));
  const kind = ROM.rw(a2 + 0xa);
  let add = true;
  if (kind === 0) { if (side >= 0) add = false; else d1 = w(-d1 + 0x80); }
  else if (kind === 1) { if (side < 0) add = false; else d1 = w(-d1 + 0x80); }
  else { if (kind !== 2) d1 = 0x38; d1 = w(d1 + 0x10); }
  if (add) d0 = l(d0 + asr(muls(d1, W6(0xc)), 7));
  // shots played recently are less likely
  d1 = shotRepeats(m, m.rw(a4 + 4));
  d0 = l(d0 - (asr(muls(d1, W6(0xe)), 7) >> 1));
  // and some chance
  const rnd = rngNextAt(m) & 0xff;
  d0 = l(d0 + asr(muls(rnd, W6(0x10)), 8));
  return d0;
}

/** sub_046890: how often (recent first, halving) the shot direction `dir` was played by this batsman */
function shotRepeats(m: Ram, dir: number): number {
  const h = m.rw(0xdfde) !== 0 ? 0xdff0 : 0xdfe0;
  let d1 = 0, d2 = 0x100;
  for (let i = 0; i < 8; i++) { if (m.rw(h + 2 * i) === w(dir)) d1 = w(d1 + d2); d2 = d2 >> 1; }
  return d1;
}

/** sub_0468EE: insert (score, option) into the list at $DF0A, highest first ($DF08 = count - 1) */
function insertSorted(m: Ram, score: number, ptr: number): void {
  let a2 = 0xdf0a;
  let d1 = m.rw(0xdf08);
  if (d1 < 0) { m.wl(a2, score); m.wl(a2 + 4, ptr); m.ww(0xdf08, 0); return; }
  for (; d1 >= 0; d1--, a2 += 8) {
    if (score > m.rl(a2)) {
      // shift the rest down one place
      let a3 = a2 + 8 * d1 + 8;
      for (let k = d1; k >= 0; k--) {
        a3 -= 4; m.wl(a3 + 8, m.rl(a3));
        a3 -= 4; m.wl(a3 + 8, m.rl(a3));
      }
      break;
    }
  }
  m.wl(a2, score); m.wl(a2 + 4, ptr);
  m.aw(0xdf08, 1);
}

/** sub_046572: the ball height to line the chosen shot up with ($DFD0 unless the ball bounces between
 *  the marker and the batsman and its height there falls inside $D2B0..$D2AE) */
function heightToAim(m: Ram, opt: number): number {
  let d6 = m.rw(0xdfd0);
  if (m.rw(0xd354) === 0) return d6;
  const d2 = w(m.rw(BAT + 4) - m.rw(0xd1da));
  if (d2 < 0) return d6;
  let d3 = m.rl(0xd36c) >> 8;
  const d4 = w(m.rw(opt + 6) << 8);
  d3 = l(((d3 & 0xffff) * (d4 & 0xffff)) >>> 0); // mulu.w
  d3 = div32(d3, l(d2));
  let t = muls(d2, 0x3333);
  t = div32(t, m.rl(0xd36c) >> 7);
  d3 = l(d3 + l(t << 8));
  let d5 = div32(l(d3 << 4), m.rl(0xd368));
  if (d5 < 0) d5 = l(-d5);
  if (w(d5) < m.rw(0xd2ae) && w(d5) >= m.rw(0xd2b0)) d6 = m.rw(opt + 6);
  return d6;
}

/** sub_04498C: when a computer batsman starts his shot: is it one to run on? (sub_0449F4 = startRun) */
export function aiRunCheck(m: Ram, startRun: () => void): void {
  if (m.rw(0xb520) >= 0) return;
  const x = m.rw(0xdfc0);
  if (Math.abs(x) >= 0x78) { startRun(); return; } // the ball will miss the stumps by a distance
  if (x >= -0x18 && x <= 0x18 && m.rw(0xdfc2) <= 0x76) return; // straight at the stumps: stay
  let d0 = w(divs(l(ROM.rw(weights(m) + 0x12)), 5).reg);
  const d1 = Math.abs(w(m.rw((m.rl(0xd2da) & 0xffff) + 0x12) - m.rw(BAT)));
  if (d1 > d0) { startRun(); return; }
  d0 = d0 >> 1;
  if (d0 > m.rw(0xdfd6)) return;
  startRun();
}

// ---------------------------------------------------------------- per-bowler tables

/** sub_04634C: which weight record: bowler type - 1, + 4 in a limited-overs game */
function recordIndex(m: Ram, ctx: Context): number {
  let d0 = Math.abs(ctx.bowler.a14) - 1;
  if (m.rw(0xbe7a) >= 0) d0 += 4;
  return d0;
}

/** sub_04630A: choose the weight record for this bowler and build the reach curves */
export function aiTablesForBowler(m: Ram, ctx: Context): void {
  m.wl(0xdfda, 0x46ca6);
  reachCurve(m, 0xb);
  m.wl(0xdfda, ROM.rl(0x4632c + 4 * recordIndex(m, ctx)));
  for (let i = 10; i >= 0; i--) reachCurve(m, i);
}

/** sub_046384: option i's reach curve: a spline through the option's (x, width), sampled into 32 bytes */
function reachCurve(m: Ram, i: number): void {
  const a0 = weights(m) + 0x1a + 16 * i;
  const a1 = 0xdd30 + 32 * i;
  const d6 = ROM.rw(a0), d7 = ROM.rw(a0 + 2);
  const p = 0xd15a;
  let d0 = w(w(d6 - d7) - 0x18);
  m.ww(p, 5);
  m.ww(p + 2, d0); m.ww(p + 4, 0);
  d0 = w(d0 + 0x18);
  m.ww(p + 6, d0); m.ww(p + 8, 8);
  m.ww(p + 0xa, d0); m.ww(p + 0xc, 0x80);
  d0 = w(d6 + d7);
  m.ww(p + 0xe, d0); m.ww(p + 0x10, 0x80);
  m.ww(p + 0x12, d0); m.ww(p + 0x14, 8);
  d0 = w(d0 + 0x18);
  m.ww(p + 0x16, d0); m.ww(p + 0x18, 0);
  const s = 0xd174;
  splineInit(m, s, 0xff0000 | p, 0x40);
  m.ww(s + 6, 0x1f);
  m.wl(s + 0xe, 0x3fffffff);
  for (let k = 0; k < 32; k++) m.wb(a1 + k, 0);
  let d2 = -1;
  do {
    splineStep(m, s);
    const dx = Math.abs(w(m.rw(s + 0x12) - d6));
    if (dx <= 0x1f) {
      const v = m.rw(s + 0x16);
      if (!(d2 > dx)) {
        if (d2 === dx) m.wb(a1 + dx, v);
        else while (d2 !== dx) { d2++; m.wb(a1 + d2, v); }
      }
    }
  } while (m.rw(s + 6) >= 0);
}

/** sub_046D80: the shot options from ROM, with each one's bat height for this batsman's stance */
export function aiOptionsReset(m: Ram): void {
  let a0 = OPTION_TABLE, a1 = OPTIONS;
  while (ROM.rw(a0) >= 0) { m.wl(a1, ROM.rl(a0)); m.wl(a1 + 4, ROM.rl(a0 + 4)); a0 += 8; a1 += 8; }
  m.ww(a1, -1);
  m.ww(0xbf7e, 0); m.ww(0xbf7a, 0); m.ww(0xe8f2, 0xa0); m.ww(0xe8f4, 0x82);
  for (let a = OPTIONS; m.rw(a) >= 0; a += 8) {
    const f = m.rw(a);
    let [, sy] = bodyScreen(m, 0, 0x370, f);
    sy = w(sy + m.rw(0xd370 + 32 * f + 4));
    m.ww(a + 6, w(-heightForScreenY(sy, 0x370)));
  }
}
