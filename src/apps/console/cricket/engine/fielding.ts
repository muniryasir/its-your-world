// The fielding view: what happens after the ball leaves the batting view (sub_0343E2). A top-down
// camera follows the ball; fielders chase it, field it or catch it and throw it in; the batsmen
// run between the wickets; the ball may reach the rope. One pass of the loop at $034866 is one game
// step (one video frame). Ported from $033C08-$039F0E; every function names the routine it rebuilds.
//
// Main state words:
//   $C6D0 play state: 0 ball loose, 1 ball thrown, 2 fielder has it, 3/4 thrown to the man at the
//         stumps ($C776 / $C77A), 5 a fielder runs it to the stumps, 6 (human) holding it
//   $C730 the fielder going for the ball; $C776 / $C77A the men backing up at each end
//   $C7EC countdown to the end of the ball (-1 = none), $C7E4 ball back at the stumps,
//   $C6D2 the ball reached the rope, $C7F0 times the batsmen crossed, $C7CA it was thrown
//   $C800 / $C81E the two batsmen while running (+0 x, +4 y 16.16, +8 direction, +$A top speed,
//         +$E stride frame, +$12 speed, +$16 run state, +$18 0 out of his ground / 1 in / -1 run made)

import { placeFielders } from "./teams";
import { Ram, ROM, SIN, COS } from "./mem";
import { w, l, muls, mulu, asr, lsl, divs, divu, div32, hiAfterShift, swap } from "./m68k";
import { angleTo, hypot } from "./trig";
import { rngNextAt } from "./rngAt";
import { ballStep } from "./ball";
import { bounceAssist } from "./batsman";
import { padHeld } from "./pads";
import {
  REC, fielders, ptr, fullPtr, state, step, setStep, isqrt, fieldScreen, camTarget, outside,
  clampToBoundary, ballAfter, peakHeight, restPoint, catchPoint, octant, minusHand, plusHand, dist2,
  dist2Ball, dist2Target, turnToward, face, faceBall, faceTarget, runAnim, runAhead, moveToTarget,
  standFrame, fielderSpeed, animStart, animTick, animTicks,
} from "./fieldlib";

// ROM tables (hand offsets per facing, animation scripts)
const HAND_GATHER = 0x36bfe, HAND_CATCH = 0x36c1e, HAND_ZERO = 0x36c3e, HAND_DIVE = 0x36c7e;
const RELEASE = 0x38858;
const A_CATCH = 0x37e60, A_CELEBRATE = 0x381b0, A_DROP = 0x382f6, A_STOOP = 0x387c0, A_PICKUP = 0x387da,
  A_MISS = 0x387f4, A_THROW = 0x38878, A_DIVE = 0x37766, A_DIVE_UP = 0x37778, A_JUMP = 0x3804a, A_JUMP_LAND = 0x38062;

const C800 = 0xc800, C81E = 0xc81e;

/** pad access for the fielding view: which buttons were pressed since the last read */
export interface FieldPads {
  /** sub_043A38 (the fielding side; computer = 0) */
  fielding(m: Ram): number;
  /** sub_04BB3A (the batting side; consumes the presses) */
  batting(m: Ram): number;
}

const recs = (m: Ram): number[] => { const b = fielders(m); return Array.from({ length: 11 }, (_, i) => b + REC * i); };
const isSet = (m: Ram, a: number) => m.rw(a) !== 0; // tst.w of a pointer's high word
const is = (m: Ram, a: number, rec: number) => m.rl(a) === fullPtr(rec); // cmpa.l

// ---------------------------------------------------------------- small state helpers

const toState0 = (m: Ram, a0: number) => m.ww(a0 + 0x3a, 0); // sub_0366F4 / sub_03591C
const toThrow = (m: Ram, a0: number) => m.ww(a0 + 0x3a, 2); // sub_036CBE
const toIdle = (m: Ram, a0: number) => { standFrame(m, a0); m.ww(a0 + 0x3a, 9); }; // sub_036D48
const setPlay = (m: Ram, v: number) => m.ww(0xc6d0, v); // sub_036D5A
const endSoon = (m: Ram, n: number) => { if (m.rw(0xc7ec) < 0) m.ww(0xc7ec, n); }; // sub_039168
const holdBall = (m: Ram) => { m.ww(0xe58c, -1); m.ww(0xe934, -1); }; // sub_04BA84

/** sub_04863A: make the ball live again (state d0) if it is dead */
function ballLive(m: Ram, d0: number): void {
  if (m.rw(0xe5a2) !== 0) return;
  m.ww(0xe5a2, d0); m.ww(0xe936, d0);
  m.ww(0xe58c, 0); m.ww(0xe934, 0);
  m.ww(0x86ba, 0); m.ww(0x86b6, 0); m.ww(0x86bc, -1);
  m.ww(0xe8d2, 0); m.ww(0xe564, 0);
  // sub_048B98: empty the collision lists
  m.wl(0xe5c8, 0xffffe5cc); m.ww(0xe5cc, -1); m.wl(0xe5c4, 0xffffe74e); m.ww(0xe74e, -1);
  ballView(m); // sub_048910 (fielding view: the rope check)
}

/** sub_0486A4: ball dead */
function ballDead(m: Ram): void { m.ww(0xe5a2, 0); m.ww(0xe936, 0); m.ww(0xe934, 0); }

/** sub_00C7D2 / sub_00C7E6: runs on this ball (match struct $BE68 + $32 + 2 * ball of the over) */
const ballOfOver = (m: Ram) => m.rw(0xbe68 + 0x30); // sub_00C80E
export const ballRuns = (m: Ram) => m.rw(0xbe68 + 0x32 + 2 * ballOfOver(m));
export const setBallRuns = (m: Ram, v: number) => m.ww(0xbe68 + 0x32 + 2 * ballOfOver(m), v);

// ---------------------------------------------------------------- camera (sub_034C94, sub_034B5E)

function camOn(m: Ram, x: number, y: number, who: number): void {
  const prev = m.rw(0xc6ca);
  if (prev !== 0 && prev !== who) {
    if (who === 1) camSmooth(m, m.rw(0xe5b4), m.rw(0xe5bc)); // sub_034D3A
    else if (prev === 1) {
      const a0 = who === 2 ? ptr(m, 0xc730) : who === 3 ? ptr(m, 0xc77a) : ptr(m, 0xc776);
      camSmooth(m, m.rw(a0 + 0x3c), m.rw(a0 + 0x44)); // sub_034D00
    }
  }
  m.ww(0xc6ca, who);
  m.ww(0x86b2, 0);
  const [d0, d1] = camTarget(m, x, y);
  m.ww(0xe59a, d0 + m.rw(0xc6cc));
  m.ww(0xe59e, d1 + m.rw(0xc6ce));
}
function camSmooth(m: Ram, x: number, y: number): void {
  let [d0, d1] = camTarget(m, x, y);
  d0 = w(d0 + m.rw(0xc6cc) - m.rw(0xe59a));
  m.ww(0xc6cc, m.rw(0xc6cc) - d0);
  d1 = w(d1 + m.rw(0xc6ce) - m.rw(0xe59e));
  m.ww(0xc6ce, m.rw(0xc6ce) - d1);
}
function camScroll(m: Ram): void {
  const absw = (v: number) => { v = w(v); return v < 0 ? w(-v) : v; };
  if (m.rw(0xc6c8) === 0) {
    if (absw(m.rw(0x8d08) - 0x3c8 - m.rw(0xe59a)) >= m.rw(0xc6f2)) m.ww(0xc6c8, 1);
    else if (!(absw(m.rw(0x8d02) - 0x230 - m.rw(0xe59e)) < m.rw(0xc6f2))) m.ww(0xc6c8, 1);
  }
  camMove(m);
  if (m.rw(0xc6c8) !== 0) {
    if (absw(m.rw(0xe59a) - m.rw(0x8d08) + 0x3c8) > m.rw(0xc6fa)) return;
    if (absw(m.rw(0xe59e) - m.rw(0x8d02) + 0x230) > m.rw(0xc6fa)) return;
    m.ww(0xc6c8, 0);
  }
}
function camMove(m: Ram): void { // sub_034BE2
  if (m.rw(0xc6c8) === 0) return;
  const axis = (cam: number, tgt: number, off: number) => {
    const d7 = l(m.rw(0xc6f8) << 16);
    let d0 = l(m.rl(cam) - off);
    let d3 = l(m.rl(tgt) - d0);
    if (d3 !== 0) {
      const shw = m.rw(m.rw(0xe5a2) !== 0 ? 0xc6f4 : 0xc6f6);
      m.fd6 = l((m.fd6 & ~0xffff) | (shw & 0xffff)); // move.w ...,d6
      const sh = shw & 63;
      d3 = sh >= 32 ? (d3 < 0 ? -1 : 0) : (d3 >> sh);
      if (d3 < 0) { if (d3 < l(-d7)) d3 = l(-d7); }
      else if (d3 > d7) d3 = d7;
      d0 = l(d0 + d3);
    }
    m.wl(cam, l(d0 + off));
  };
  axis(0x8d08, 0xe59a, 0x3c80000);
  axis(0x8d02, 0xe59e, 0x2300000);
}

// ---------------------------------------------------------------- the ball in the fielding view

/** sub_048910 -> loc_034E60: the rope check (and the ball's screen position) */
function ballView(m: Ram): void {
  if (m.rw(0xe936) === 0) {
    // sub_0476D6 (a close fielder holding the ball) is never the case here
    return;
  }
  if (m.rw(0x86b2) < 0) return;
  if (m.rw(0xc6d0) < 2 && m.rw(0xc6d2) === 0) {
    const x = m.rw(0xe5b4), y = m.rw(0xe5bc);
    if (outside(x, y)) {
      m.ww(0xe5b4, x); m.ww(0xe5bc, y);
      m.wl(0xe5a8, 0); m.wl(0xe5b0, 0);
      m.ww(0xc6d2, -1);
    }
  }
  const [sx, sy] = fieldScreen(m, m.rw(0xe5b4), w(-m.rw(0xe5b8)), m.rw(0xe5bc));
  m.ww(0xe582, sx); m.ww(0xe584, sy);
  // sub_034F86: the ball's sprite box
  m.ww(0xe586, w(sx - 3)); m.ww(0xe588, w(sy - 3)); m.ww(0xe58a, 0x183);
}

// ---------------------------------------------------------------- intercepts (sub_035922 & co)

/** sub_035D5E: steps for the ball to travel `dist` along its path */
function ballTime(m: Ram, dist: number): number {
  const d0a = hiAfterShift(m.rl(0xe5a8), 6), d1a = hiAfterShift(m.rl(0xe5b0), 6);
  let d3 = l(l(hypot(d0a, d1a) << 16) >> 6);
  let d2 = 0x100;
  let d0 = l(w(dist) << 16);
  let z = m.rl(0xe5b8), vz = m.rl(0xe5ac);
  let rolling = m.rw(0xe936) === 3;
  if (!rolling) {
    for (;;) {
      d2 = w(d2 - 1); if (d2 < 0) return w(0xff - d2);
      d0 = l(d0 - d3); if (d0 < 0) return w(0xff - d2);
      vz = l(vz - 0x3333); z = l(z + vz);
      if (z >= 0) continue;
      z = 0;
      d3 = muls(hiAfterShift(d3, 8), m.rw(0xc5be));
      vz = l(-muls(hiAfterShift(vz, 8), m.rw(0xc5c0)));
      if (vz > 0x8000) continue;
      break;
    }
  }
  for (;;) {
    d2 = w(d2 - 1); if (d2 < 0) break;
    d0 = l(d0 - d3); if (d0 < 0) break;
    d3 = muls(hiAfterShift(d3, 8), m.rw(0xc5c2));
  }
  return w(0xff - d2);
}

/** sub_035C84: upper bound of the intercept time for a fielder ($FF = can't get there) */
function interceptBound(m: Ram, a0: number): number {
  const bx = m.rw(0xc736), by = m.rw(0xc738);
  const ax = w(hiAfterShift(m.rl(0xe5a8), 6) + bx), ay = w(hiAfterShift(m.rl(0xe5b0), 6) + by);
  const dir = angleTo(bx, by, ax, ay);
  let d2 = w(angleTo(bx, by, m.rw(a0 + 0x3c), m.rw(a0 + 0x44)) - dir);
  if (d2 < 0) d2 = w(-d2);
  if (d2 >= 0x200) return 0xff;
  const s = SIN(d2);
  const dist = hypot(w(m.rw(a0 + 0x3c) - bx), w(m.rw(a0 + 0x44) - by));
  let t = w(l(muls(dist, s) * 2) >>> 16);
  t = divs(t, m.rw(a0 + 0x48)).q;
  t = w(t + 0xa + (m.rw(0x8602) !== 0 ? 0x14 : 0));
  const bt = ballTime(m, dist);
  if (t > bt) return 0xff;
  return bt;
}

/** sub_035ABA: when and where can this fielder reach the ball? A binary search on the time, d7
 *  steps of it per call; a search can continue over several ticks ($C774). */
function intercept(m: Ram, a0: number, d7: number): void {
  if (m.rw(0xc768) !== 0) {
    // loc_035C38: once the ball is past everyone, run to where it stops
    m.ww(a0 + 0x2c, m.rw(0x86be)); m.ww(a0 + 0x2e, 0); m.ww(a0 + 0x30, m.rw(0x86c6));
    let dx = l(m.rw(0x86be) - m.rw(a0 + 0x3c)) >> 1, dy = l(m.rw(0x86c6) - m.rw(a0 + 0x44)) >> 1;
    let d0 = isqrt(l(muls(dx, dx) + muls(dy, dy)));
    d0 = w(divu(l(w(d0)), m.rw(a0 + 0x48)).q + 0xa);
    m.ww(a0 + 0x32, d0);
    return;
  }
  let lo: number, hi: number, ax: number, ay: number;
  if (m.rw(0xc774) !== 0) {
    m.ww(0xc774, m.rw(0xc774) - d7);
    if (m.aw(0xc774, -1) < 0) { d7 = w(d7 + m.rw(0xc774)); m.ww(0xc774, 0); }
    ax = m.rw(0xc76a); ay = m.rw(0xc76c); lo = m.rw(0xc76e); hi = m.rw(0xc770);
  } else {
    if (m.rw(0x86ba) !== 0) {
      if (m.rb(a0 + 0x26) & 2) return;
      if (m.rw(0x86e6) >= 0) {
        const dx = l(m.rw(0x86da) - m.rw(a0 + 0x3c)) >> 1, dy = l(m.rw(0x86e2) - m.rw(a0 + 0x44)) >> 1;
        let d0 = isqrt(l(muls(dx, dx) + muls(dy, dy)));
        d0 = w(divu(l(w(d0)), m.rw(a0 + 0x48)).q + 0xa);
        if (m.rw(0x8602) !== 0) d0 = w(d0 + 0x14);
        const left = w(m.rw(0x86e8) - m.rw(0x86e6));
        if (!(d0 > left)) {
          m.ww(a0 + 0x2c, m.rw(0x86da)); m.ww(a0 + 0x2e, m.rw(0x86de)); m.ww(a0 + 0x30, m.rw(0x86e2));
          m.ww(a0 + 0x32, d0);
          m.wb(a0 + 0x26, m.rb(a0 + 0x26) | 2);
          return;
        }
        m.wb(a0 + 0x26, m.rb(a0 + 0x26) | 4);
      }
    }
    m.wb(a0 + 0x26, m.rb(a0 + 0x26) & ~2);
    m.ww(0xc774, w(7 - d7));
    hi = interceptBound(m, a0);
    m.ww(0xc772, 0);
    ax = m.rw(a0 + 0x3c); m.ww(0xc76a, ax);
    ay = m.rw(a0 + 0x44); m.ww(0xc76c, ay);
    lo = 0;
  }
  let mid = 0, px = 0, py = 0, pz = 0;
  for (;;) {
    mid = w(lo + hi) >> 1;
    [px, pz, py] = ballAfter(m, w(mid - m.rw(0xc772)));
    const dx = w(px - ax), dy = w(py - ay);
    const d0 = l(muls(dx, dx) + muls(dy, dy));
    let d3 = w(mid - 0xa - (m.rw(0x8602) !== 0 ? 0x14 : 0));
    if (d3 < 0) d3 = 0;
    let d1 = mulu(d3, m.rw(a0 + 0x48));
    d1 = mulu(d1, d1);
    if (d1 > d0) hi = mid; else lo = mid;
    d7 = w(d7 - 1);
    if (d7 === -1) break;
  }
  if (m.rw(0xc774) !== 0) { m.ww(0xc76e, lo); m.ww(0xc770, hi); return; }
  m.ww(a0 + 0x2c, px); m.ww(a0 + 0x2e, pz); m.ww(a0 + 0x30, py); m.ww(a0 + 0x32, mid);
}

/** sub_035984: every fielder's intercept time, sorted into the list at $C73C */
function rankFielders(m: Ram): void {
  m.ww(0xc73a, -1);
  for (const a0 of recs(m)) {
    m.ww(a0 + 0x26, 0);
    m.ww(0xc774, 0);
    intercept(m, a0, 7);
    let t = m.rw(a0 + 0x32) & 0xffff;
    if (m.rb(a0 + 0x26) & 4) t = l(t + 0xfa);
    m.wl(a0 + 0x28, t);
    const n = m.rw(0xc73a);
    if (n < 0) { m.ww(0xc73a, 0); m.wl(0xc73c, fullPtr(a0)); continue; }
    let k = 0;
    for (; k <= n; k++) {
      const other = ptr(m, 0xc73c + 4 * k);
      if ((t >>> 0) < (m.rl(other + 0x28) >>> 0)) break;
    }
    for (let j = n; j >= k; j--) m.wl(0xc73c + 4 * (j + 1), m.rl(0xc73c + 4 * j));
    m.wl(0xc73c + 4 * k, fullPtr(a0));
    m.aw(0xc73a, 1);
  }
}

/** sub_035A24: send the fielder at place $C734 in the list after the ball */
function pickChaser(m: Ram): number {
  let a0 = ptr(m, 0xc73c + 4 * m.rw(0xc734));
  if (m.rw(0xc6d0) > 1) { m.ww(0x86ec, -1); return ptr(m, 0xc730); }
  if (m.rl(0xc730) !== 0) m.ww(ptr(m, 0xc730) + 0x38, 0);
  m.wl(0xc730, fullPtr(a0));
  const st = m.rw(a0 + 0x3a);
  if (st !== 0 && st !== 0xc && st !== 0xd) { m.aw(0x86ec, 1); return a0; }
  toState0(m, a0);
  m.ww(0x86ec, -1);
  m.ww(0xc78c, -1);
  if (is(m, 0xc776, a0)) m.ww(0xc776, 0);
  else if (is(m, 0xc77a, a0)) m.ww(0xc77a, 0);
  return a0;
}

/** sub_035922: choose who goes for the ball, and his target */
function chooseChaser(m: Ram): number {
  m.wb(0xfd0c, 0);
  catchPoint(m);
  rankFielders(m);
  pickChaser(m);
  m.ww(0xc768, 1);
  const a0 = ptr(m, 0xc730);
  const [x, y] = clampToBoundary(m, m.rw(a0 + 0x2c), m.rw(a0 + 0x30));
  m.ww(a0 + 0x2c, x); m.ww(a0 + 0x30, y);
  m.ww(0xc786, x); m.ww(0xc788, y); m.ww(0xc792, x); m.ww(0xc794, y);
  m.ww(0xc78c, m.rw(a0 + 0x32));
  planDistance(m);
  return a0;
}

/** sub_0358E0 */
function reassign(m: Ram): void {
  if (m.rw(0xc730) !== 0) {
    if (m.rw(0xe5a2) === 0) return;
    if (m.rw(0xc6d0) === 2) return;
  }
  const a0 = chooseChaser(m);
  if (is(m, 0xc776, a0)) m.ww(0xc776, 0);
  else if (is(m, 0xc77a, a0)) m.ww(0xc77a, 0);
}

/** sub_036596: remember how far the ball is from the chaser's planned point */
function planDistance(m: Ram): void {
  m.ww(0xc784, 0);
  const dx = w(m.rw(0xe5b4) - m.rw(0xc786)), dy = w(m.rw(0xe5bc) - m.rw(0xc788));
  m.wl(0xc78e, l(muls(dx, dx) + muls(dy, dy)));
  m.ww(0xc784, -1);
}
/** sub_0365F2: is the ball getting closer to the planned point? (keeps the closest distance) */
function ballNearingPlan(m: Ram): boolean {
  const dx = w(m.rw(0xe5b4) - m.rw(0xc786)), dy = w(m.rw(0xe5bc) - m.rw(0xc788));
  const d0 = l(muls(dx, dx) + muls(dy, dy));
  if (d0 >= m.rl(0xc78e)) return false;
  m.wl(0xc78e, d0);
  return true;
}

/** sub_035E58: the free fielder nearest to the stumps at y (within sqrt(max)), not `except` */
function nearestTo(m: Ram, y: number, max: number, except: number): number {
  let best = 0x7fff0000, a2 = 0;
  const c730 = m.rl(0xc730);
  for (const a3 of recs(m)) {
    const full = fullPtr(a3);
    if (full === except || full === c730) continue;
    if (state(m, a3) === 5 && (m.rw(a3 + 0x3a) === 5)) continue; // cmpi.w #5,$3a: the whole word
    let dx = w(m.rw(a3 + 0x3c)) >> 1;
    let d3 = muls(dx, dx);
    const dy = l(l(m.rw(a3 + 0x44)) - l(w(y))) >> 1;
    d3 = l(d3 + muls(dy, dy));
    if (m.rw(a3 + 6) === 3 && w(y) === m.rw(0xc6fc)) d3 = l((d3 & ~0xffff) | (w(d3) >> 2 & 0xffff));
    if (d3 > max) continue;
    if (!(d3 < best)) continue;
    best = d3; a2 = full;
  }
  return a2;
}

/** sub_035DF8: someone backs up at each set of stumps */
function backUp(m: Ram): void {
  if (m.rw(0xc6d0) === 5) return;
  if (!isSet(m, 0xc776)) {
    const a2 = nearestTo(m, m.rw(0xc6fc), 0x100000, m.rl(0xc77a));
    m.wl(0xc776, a2);
    if (a2 !== 0) { const a = a2 & 0xffff; standFrame(m, a); m.ww(a + 0x3a, 0xc); m.ww(a + 0x38, 0xc); }
  }
  if (!isSet(m, 0xc77a)) {
    const a2 = nearestTo(m, m.rw(0xc6fe), 0x90000, m.rl(0xc776));
    m.wl(0xc77a, a2);
    if (a2 !== 0) { const a = a2 & 0xffff; standFrame(m, a); m.ww(a + 0x3a, 0xd); m.ww(a + 0x38, 0xd); }
  }
}

// ---------------------------------------------------------------- ball reaches a target / stumps

/** sub_035718: (distance/2)^2 from (x, y) to the ball */
function ballDist2(m: Ram, x: number, y: number): number {
  const dx = l(l(w(x)) - l(m.rw(0xe5b4))) >> 1, dy = l(l(w(y)) - l(m.rw(0xe5bc))) >> 1;
  return l(muls(dx, dx) + muls(dy, dy));
}

/** sub_03565C: a thrown ball that passes its target (or hits the stumps) */
function throwCheck(m: Ram): void {
  if (m.rw(0xbee2) !== 0) return;
  if (m.rw(0xc6d0) !== 1) return;
  let d0 = ballDist2(m, m.rw(0xc7ce), m.rw(0xc7d2));
  if (m.rw(0xc72a) < 0) { m.wl(0xc72a, d0); return; }
  d0 = l(d0 - m.rl(0xc72a));
  if (d0 < 0) { m.wl(0xc72a, d0); return; }
  if (m.rw(0xc7d8) === 0) {
    if (d0 < 0x19000) return;
  } else {
    if (!(ballDist2(m, 0, m.rw(0xc6fc)) > 0x9000)) { hitStumps(m); return; }
    if (!(ballDist2(m, 0, m.rw(0xc6fe)) > 0x9000)) { hitStumps(m); return; }
  }
  // the throw went past: the ball is loose again
  m.wl(0xc72a, d0);
  if (m.rw(0xb526) >= 0 && humanFields(m)) m.ww(0x8602, -1);
  m.ww(0x86b6, 0); m.ww(0x86b8, 0); m.ww(0x86bc, -1); m.ww(0x86ec, 0);
  setPlay(m, 0);
  m.ww(0xc768, 0);
  restPoint(m);
  reassign(m);
  m.ww(0xc6ca, 0);
}

/** sub_01259C: does the human field this ball himself (option per controller)? */
function humanFields(m: Ram): boolean {
  const rec = m.rw(0xb526) === 0 ? 0xfc18 : 0xfc1e; // sub_013962
  let sel = 0;
  if (m.rw(0xb526) >= 0) sel = m.rw(0xbe68 + 0x2e) & 1; // sub_013990
  const d1 = sel === 0 ? m.rw(rec) : m.rw(rec + 2);
  return m.rw(0x695c + 2 * w(d1)) !== 0;
}

/** sub_03913C: the ball hit the stumps */
function hitStumps(m: Ram): void {
  if (m.rw(0xe5a2) < 2) m.ww(0xe5a2, 2);
  m.ww(0x86ea, -1);
  holdBall(m);
  ballHome(m);
}

/** sub_037AC8: the ball is back at the stumps: play stops (flags for the run-out replay) */
function ballHome(m: Ram): void {
  m.wb(0xc84c, 0);
  if (m.rw(0xc6d0) < 3) m.wb(0xc84c, -1);
  let a0 = 0;
  if (m.rw(0xe5bc) >= 0) {
    m.wb(0xc850, 0); m.wb(0xc852, 0); m.wb(0xc84e, 0);
    if (m.rw(0xe5b0) < 0) m.wb(0xc84e, -1);
    if (isSet(m, 0xc776)) a0 = ptr(m, 0xc776);
  } else {
    m.wb(0xc850, -1); m.wb(0xc852, -1); m.wb(0xc84e, 0);
    if (m.rw(0xe5b0) >= 0) m.wb(0xc84e, -1);
    if (isSet(m, 0xc77a)) a0 = ptr(m, 0xc77a);
  }
  if (a0) {
    m.wb(0xc848, 0);
    if (m.rw(a0 + 6) !== 4) m.wb(0xc848, -1);
    m.wb(0xc84a, -1);
    if (dist2Target(m, a0) > 0x40000) m.wb(0xc84a, 0);
  } else {
    a0 = ptr(m, 0xc730);
    const st = m.rb(a0 + 0x3b) & 0xff;
    if ((st === 0xc || st === 0xd) && m.rw(0xc6d0) >= 5) {
      m.wb(0xc848, -1); m.wb(0xc84a, -1);
      if (dist2Target(m, a0) > 0x40000) m.wb(0xc84a, 0);
    } else m.wb(0xc84a, 0);
  }
  m.ww(0xc7e4, -1);
}

// ---------------------------------------------------------------- catches

/** sub_037D4E: a ball in the air at catching height comes to his hands: catch it */
function tryCatch(m: Ram, a0: number, reach: number): boolean {
  if (m.rw(0xc6d0) >= 2) return false;
  const [x, h, y] = ballAfter(m, 1);
  if (h <= 0x3c) return false;
  if (h > 0xb4) return false;
  const [hx, hy] = minusHand(m, a0, HAND_CATCH, x, y);
  let d0 = dist2(m, a0, hx, hy);
  const vx = m.rw(0xe5a8), vy = m.rw(0xe5b0);
  d0 = l(d0 - l(muls(vx, vx) + muls(vy, vy)));
  if (d0 > muls(reach, reach)) return false;
  catchIt(m, a0);
  return true;
}

/** sub_037DC6 */
function catchIt(m: Ram, a0: number): void {
  animStart(m, a0, A_CATCH);
  m.ww(a0 + 0x3a, 6);
  holdBall(m);
  let d0 = 2;
  if (is(m, 0xc77a, a0)) d0 = 4;
  else if (is(m, 0xc776, a0)) d0 = 3;
  setPlay(m, d0);
  m.wb(0xfd0c, -1);
  if (m.rw(0x8606) === 0 || m.rw(0xe580) === 0) throwArrows(m);
}

/** sub_036A78: the human's throw-target arrows ($FD0E) */
function throwArrows(m: Ram): void {
  if (m.rw(0x8602) === 0) return;
  if (m.rw(0xc6d0) !== 2) return;
  if (m.rb(0xfd0e) !== 0) return;
  m.wb(0xfd0e, -1);
  arrowPads?.fielding(m); // sub_043A38: presses so far are dropped
}
/** the fielding view's pads, for routines the original calls without them being passed down */
let arrowPads: FieldPads | null = null;
/** sub_036B06 */
function clearArrows(m: Ram): void { if (m.rb(0xfd0e) !== 0) m.wb(0xfd0e, 0); }

/** sub_038256: does the fielder drop the catch? (once per ball: $C7E6) */
function drops(m: Ram): boolean {
  if (m.rw(0x8602) !== 0 || m.rw(0xc7e6) !== 0) return false;
  const a1 = striker(m);
  const a2 = m.rl(a1 + 2) & 0xffffff;
  let d1 = l(w(m.rw(a1 + 0x1c)) << 8);
  let div = romOrRam(m, a2 + 0xe);
  if (div === 0) div = 1;
  const q = divs(d1, div);
  if (q.overflow) return false;
  d1 = w(-q.q + 0x2a0);
  if (d1 < 0) d1 = 0;
  if (m.rw(0xb520) >= 0) d1 = w(d1 + 0xa0);
  let d0 = rngNextAt(m) & 0x3ff;
  if (m.rw(0x8604) !== 0) { d0 = w(d0 + d0); if (m.rw(0x8604) !== 1) d0 = w(d0 + d0); }
  if (d1 < d0) return false;
  m.ww(0xc7e6, -1);
  return true;
}
/** the batsman on strike ($B51C team, role 1): sub_00BF1E(1) */
function striker(m: Ram): number {
  let a1 = m.rl(0xb51c) & 0xffff;
  for (let i = 0; i < 11; i++, a1 += REC) if (m.rw(a1 + 6) === 1) return a1;
  return a1;
}
/** player attribute words live in ROM (or RAM for edited players) */
function romOrRam(m: Ram, a: number): number { return a >= 0xff0000 ? m.rw(a & 0xffff) : ROM.rw(a); }

// ---------------------------------------------------------------- the fielders' states

type StateFn = (m: Ram, a0: number, pads: FieldPads) => void;

/** state 0 (and 4, 9, 15): the chaser runs to his intercept point */
function chase(m: Ram, a0: number, pads: FieldPads): void {
  if (m.rw(0x8602) !== 0) { humanChase(m, a0, pads); return; }
  if (m.rw(0xc6d0) === 2) {
    if (m.rw(0xc7ec) < 0) { toThrow(m, a0); return; }
  }
  if (m.rw(0xc6d0) !== 0) { standFrame(m, a0); return; }
  if (!ballNearingPlan(m)) {
    m.ww(0xc774, 0);
    intercept(m, a0, 7);
    m.ww(0xc786, m.rw(a0 + 0x2c)); m.ww(0xc788, m.rw(a0 + 0x30)); m.ww(0xc78c, m.rw(a0 + 0x32));
    m.ww(0xc78c, -1);
    planDistance(m);
  }
  faceTarget(m, a0);
  moveToTarget(m, a0);
  if (tryCatch(m, a0, m.rw(0xc6ea))) return;
  if (!(dist2Ball(m, a0) > muls(m.rw(0xc6e8), m.rw(0xc6e8)))) {
    if (!(peakHeight(m) > 0x3c)) {
      m.wl(0xe5a8, 0); m.wl(0xe5ac, 0); m.wl(0xe5b0, 0);
      toGather(m, a0);
      return;
    }
  }
  if (dist2Target(m, a0) > 0x40) return;
  if (m.rw(a0 + 0x2e) > 0x3c) {
    // the ball will be above his head when it gets here: jump for it
    m.ww(a0 + 0x3a, 0xb);
    const keep = m.rw(a0 + 0x56);
    m.ww(a0 + 0x56, angleTo(m.rw(0xe5b4), m.rw(0xe5bc), m.rw(a0 + 0x3c), m.rw(a0 + 0x44)));
    const [x, y] = minusHand(m, a0, HAND_CATCH, m.rw(a0 + 0x2c), m.rw(a0 + 0x30));
    m.ww(a0 + 0x2c, x); m.ww(a0 + 0x30, y);
    m.ww(a0 + 0x56, keep);
    m.wb(0xfd0c, -1);
    return;
  }
  toStoop(m, a0);
}

/** the human-controlled fielder (loc_036828): the pad steers him; he catches, gathers and jumps by
 *  himself; near the stumps with the ball he runs it in; A / B (with the arrows up) throw to an end;
 *  C (before anyone has the ball) switches to the next-best fielder */
function humanChase(m: Ram, a0: number, pads: FieldPads): void {
  if (!ballNearingPlan(m)) {
    m.ww(0xc774, 0);
    intercept(m, a0, 7);
    m.ww(0xc786, m.rw(a0 + 0x2c)); m.ww(0xc788, m.rw(a0 + 0x30)); m.ww(0xc78c, m.rw(a0 + 0x32));
    planDistance(m);
  }
  const dir = padHeld(m, m.rw(0xb526)) & 0xf; // sub_0045D0
  if (dir === 0) {
    standFrame(m, a0);
    m.ww(0xc79c, 0);
  } else {
    const want = ROM.rw(0x36a58 + 2 * dir);
    let turn = true;
    if (m.rw(0xc79c) !== 1) {
      let fresh = true;
      if (m.rw(0xc79c) !== 0) { let d = w(want - m.rw(a0 + 0x56)); if (d < 0) d = w(-d); if (d <= 0x200) fresh = false; }
      if (fresh) { standFrame(m, a0); m.ww(0xc79c, 1); }
    }
    let d1 = turnToward(m, want, m.rw(a0 + 0x56));
    d1 = turnToward(m, want, d1);
    m.ww(a0 + 0x56, d1);
    if (m.rw(0xc79c) === 1 && want !== d1) turn = false; // still turning to the new direction
    if (turn) {
      const x = m.rw(a0 + 0x3c), y = m.rw(a0 + 0x44);
      runAhead(m, a0); // sub_038B2A (sub_038C6A before it does nothing)
      if (outside(m.rw(a0 + 0x3c), m.rw(a0 + 0x44))) { standFrame(m, a0); m.ww(a0 + 0x3c, x); m.ww(a0 + 0x44, y); }
      m.ww(0xc79c, 2);
    }
  }
  if (!tryCatch(m, a0, m.rw(0xc6ea))) {
    let gathered = false;
    if (m.rw(0xc6d0) < 2) {
      if (!(dist2Ball(m, a0) > muls(m.rw(0xc6e8), m.rw(0xc6e8))) && !(peakHeight(m) > 0x3c)) {
        m.wl(0xe5a8, 0); m.wl(0xe5ac, 0); m.wl(0xe5b0, 0);
        toGather(m, a0);
        return;
      }
    }
    gathered = gatherNear(m, a0, m.rw(0xc6e2));
    if (!gathered) jumpCatch(m, a0, m.rw(0xc6f0));
  }
  // with the ball, close to one set of stumps: run it in (states 12 / 13)
  if (m.rw(0xe5a2) !== 0 && m.rw(0xc6d0) === 2) {
    const x3 = w(3 * m.rw(a0 + 0x3c));
    const dx = muls(x3, x3);
    const y = m.rw(a0 + 0x44);
    let dy = w(y - 0x400);
    if (!(l(muls(dy, dy) + dx) > 0x27100)) { runItIn(m, a0, 0xc776, 0xc); return; }
    dy = w(y + 0x400);
    if (!(l(muls(dy, dy) + dx) > 0x27100)) { runItIn(m, a0, 0xc77a, 0xd); return; }
  }
  if (m.rb(0xfd0e) === 0) {
    if (m.rw(0xc6d0) !== 0) return;
    const d0 = pads.fielding(m); // sub_043A38
    if ((d0 & 0x20) && m.rb(0xfd0c) === 0) {
      // sub_035922 leaves a0 = the chaser it chose, so the original's cmpa.l $C730,a0 always matches
      chooseChaser(m);
      m.ww(0xc734, m.rw(0xc734) ^ 1);
      pickChaser(m);
    }
    return;
  }
  const d0 = pads.fielding(m);
  if (d0 & 0x40) m.ww(0xc7c6, 1);
  else if (d0 & 0x10) m.ww(0xc7c6, 2);
  else return;
  clearArrows(m);
  toThrow(m, a0);
}
/** loc_036982 / loc_0369BE: the human fielder runs the ball to the stumps himself; whoever was
 *  waiting there walks off (sub_0388CC) */
function runItIn(m: Ram, a0: number, slot: number, st: number): void {
  if (m.rw(slot) !== 0) walkOff(m, ptr(m, slot), a0);
  m.wl(slot, fullPtr(a0));
  m.ww(a0 + 0x3a, st); m.ww(a0 + 0x38, st);
  m.ww(0x8602, 0);
  setPlay(m, 5);
}
/** sub_0388CC: a fielder makes way: he turns roughly away from a0 (random +-$200) and walks (state 15) */
function walkOff(m: Ram, a1: number, a0: number): void {
  const d2 = angleTo(m.rw(a1 + 0x2c), m.rw(a1 + 0x30), m.rw(a0 + 0x3c), m.rw(a0 + 0x44));
  let d0 = rngNextAt(m) & 0x400;
  d0 = w(d0 - 0x200 + d2) & 0x7ff;
  m.ww(a1 + 0x2c, d0);
  m.ww(a1 + 0x38, 0);
  m.ww(a1 + 0x3a, 0xf);
  m.ww(a1 + 0x5e, 0);
}
/** sub_038346: a slow ball on the ground within `reach` of him: he gathers it */
function gatherNear(m: Ram, a0: number, reach: number): boolean {
  if (m.rw(0xc6d0) >= 2) return false;
  const vx = m.rw(0xe5a8), vy = m.rw(0xe5b0);
  if (l(muls(vx, vx) + muls(vy, vy)) > muls(m.rw(0xc6e6), m.rw(0xc6e6))) return false;
  if (peakHeight(m) > 0x3c) return false;
  if (!(dist2Ball(m, a0) <= muls(reach, reach))) return false;
  toGather(m, a0);
  return true;
}
/** sub_037BB6: a skied ball he can get under in time: he gets ready to catch it (state 11). The
 *  original reuses d0 (a squared distance) as a coordinate and divides by d6, which it never sets:
 *  both are kept (Ram.fd6). */
function jumpCatch(m: Ram, a0: number, reach: number): boolean {
  if (m.rw(0xc6d0) >= 2) return false;
  if (peakHeight(m) < 0x74) return false;
  const d4lim = muls(reach, reach);
  const [, , y, ticks] = catchPoint(m); // sub_038E1E
  if (ticks < 0) return false;
  const d0 = dist2(m, a0, m.rw(0x86da), m.rw(0x86e2)); // sub_038D86
  if (d0 > d4lim) return false;
  const dx = w(m.rw(a0 + 0x3c) - w(d0));
  const dy = w(m.rw(a0 + 0x44) - y);
  let d4 = l(muls(dx, dx) + muls(dy, dy));
  d4 = div32(d4, m.fd6);
  const d3 = w(l(muls(ticks, ticks) - d4));
  if (d3 < -0x10) return false;
  toReceive(m, a0);
  return true;
}

/** sub_03839E: gather a ball rolling to him (state 10) */
function toGather(m: Ram, a0: number): void {
  m.ww(a0 + 0x3a, 0xa);
  faceAtBall(m, a0);
  m.wb(0xfd0c, -1);
}
/** sub_038418: face the ball, target = where his hands meet it */
function faceAtBall(m: Ram, a0: number): void {
  m.ww(a0 + 0x56, angleTo(m.rw(0xe5b4), m.rw(0xe5bc), m.rw(a0 + 0x3c), m.rw(a0 + 0x44)));
  const [x, y] = minusHand(m, a0, HAND_GATHER, m.rw(0xe5b4), m.rw(0xe5bc));
  m.ww(a0 + 0x2c, x); m.ww(a0 + 0x30, y);
}
/** sub_03849E: stoop to pick it up (state 1) */
function toStoop(m: Ram, a0: number): void {
  animStart(m, a0, A_STOOP);
  m.ww(a0 + 0x3a, 1);
  m.wb(0xfd0c, -1);
}

/** state 10 (loc_0383BA): close in on a rolling ball */
function gather(m: Ram, a0: number): void {
  if (step(m, a0) === 0) {
    faceBall(m, a0) && (setStep(m, a0, 1), true);
  }
  if (!(dist2Ball(m, a0) > muls(m.rw(0xc6e8), m.rw(0xc6e8)))) {
    m.wl(0xe5a8, 0); m.wl(0xe5ac, 0); m.wl(0xe5b0, 0);
  }
  faceAtBall(m, a0);
  moveToTarget(m, a0);
  // sub_038454: close enough to pick it up?
  if (m.rw(0xc6d0) >= 2) return;
  const [x, h, y] = ballAfter(m, 0x29);
  if (h >= 0x74) return;
  const [hx, hy] = minusHand(m, a0, HAND_GATHER, x, y);
  if ((dist2(m, a0, hx, hy) >>> 0) < (muls(m.rw(0xc6e0), m.rw(0xc6e0)) >>> 0)) toStoop(m, a0);
}

/** sub_03870C: is the ball in reach of his hands? returns [inReach, dist2, reach2] */
function inReach(m: Ram, a0: number): [boolean, number, number] {
  const [ox, oy] = minusHand(m, a0, HAND_GATHER, 0, 0);
  const dx = w(-ox + m.rw(a0 + 0x3c) - m.rw(0xe5b4)), dy = w(-oy + m.rw(a0 + 0x44) - m.rw(0xe5bc));
  const d0 = l(muls(dx, dx) + muls(dy, dy));
  let r = m.rw(0xc6e0);
  r = w(r + r + m.rw(0xc6e0)) >> 1;
  const d1 = muls(r, r);
  return [(d0 >>> 0) <= (d1 >>> 0), d0, d1];
}

/** sub_038754: missed it (state 14) */
function toMissed(m: Ram, a0: number): void { animStart(m, a0, A_MISS); m.ww(a0 + 0x3a, 0xe); }

/** state 1 (loc_0384B4): stoop and pick the ball up */
function pickUp(m: Ram, a0: number): void {
  const sub = step(m, a0);
  if (sub === 0) {
    const want = angleTo(m.rw(0xe5b4), m.rw(0xe5bc), m.rw(a0 + 0x3c), m.rw(a0 + 0x44));
    const now = turnToward(m, want, m.rw(a0 + 0x56));
    m.ww(a0 + 0x56, now);
    if (w(now) !== w(want)) return;
    animStart(m, a0, A_STOOP);
    setStep(m, a0, 1);
    const [ox, oy] = minusHand(m, a0, HAND_GATHER, 0, 0);
    const dx = w(-ox + m.rw(a0 + 0x3c) - m.rw(0xe5b4)), dy = w(-oy + m.rw(a0 + 0x44) - m.rw(0xe5bc));
    m.wl(a0 + 0x64, l(muls(dx, dx) + muls(dy, dy)));
    return;
  }
  const moving = (m.rl(0xe5a8) | m.rl(0xe5b0)) !== 0;
  if (moving && m.rw(0xc6d0) !== 2 && m.rw(0xe5a2) !== 0) {
    const [ok] = inReach(m, a0);
    if (ok) {
      if (m.rw(0x8606) !== 0 && m.rw(0xe580) === 0 && m.rw(0xe5a2) !== 3 && drops(m)) { fumble(m, a0); return; }
      holdBall(m);
      setPlay(m, 2);
      throwArrows(m);
      animStart(m, a0, A_PICKUP);
      setStep(m, a0, 3);
      return;
    }
  }
  let s = step(m, a0);
  if (s === 1) {
    if (animTick(m, a0, A_STOOP).code !== "end") return;
    setStep(m, a0, 2); s = 2;
  }
  if (s === 2) {
    const [ok, d0, d1] = inReach(m, a0);
    if (!ok) {
      const before = m.rl(a0 + 0x64);
      m.wl(a0 + 0x64, d0);
      if ((d0 >>> 0) > (before >>> 0)) { toMissed(m, a0); return; }
      const vx = m.rl(0xe5a8), vy = m.rl(0xe5b0);
      const sp = l((vx < 0 ? -vx : vx) + (vy < 0 ? -vy : vy));
      if (sp > 0x40000) return;
      if ((d0 >>> 0) > (l(d1 << 2) >>> 0)) { toMissed(m, a0); return; }
    }
    if (m.rw(0x8606) !== 0 && m.rw(0xe580) === 0 && m.rw(0xe5a2) !== 3 && drops(m)) { fumble(m, a0); return; }
    holdBall(m);
    setPlay(m, 2);
    throwArrows(m);
    animStart(m, a0, A_PICKUP);
    setStep(m, a0, 3);
    return;
  }
  // step 3: picking it up
  if (animTick(m, a0, A_PICKUP).code !== "end") return;
  if (m.rw(0x8602) !== 0) toState0(m, a0);
  else if (m.rw(0xbee2) !== 0) toState0(m, a0);
  else toThrow(m, a0);
}
/** loc_03867E: the ball bounces off his hands (velocities halved, height quartered) */
function fumble(m: Ram, a0: number): void {
  m.wl(0xe5a8, asr(m.rl(0xe5a8), 1));
  m.wl(0xe5ac, asr(m.rl(0xe5ac), 2));
  m.wl(0xe5b0, asr(m.rl(0xe5b0), 1));
  toMissed(m, a0);
}

/** state 14 (loc_038766): picked himself up after missing; back to the chase */
function missed(m: Ram, a0: number): void {
  if (animTick(m, a0, A_PICKUP).code !== "end") return;
  toState0(m, a0);
  setPlay(m, 0);
  m.ww(0x86bc, -1); m.ww(0x86ba, 0); m.ww(0x86b8, 0); m.ww(0x86b6, 0);
  restPoint(m);
  m.ww(0xc774, 0);
  intercept(m, a0, 7);
  m.ww(0xc786, m.rw(a0 + 0x2c)); m.ww(0xc788, m.rw(a0 + 0x30)); m.ww(0xc78c, m.rw(a0 + 0x32));
  m.ww(0xc78c, -1);
  planDistance(m);
}

/** state 2 (loc_036CC6): turn to the throw target */
function aimThrow(m: Ram, a0: number): void {
  if (m.rb(a0 + 0x3a) === 0) {
    setStep(m, a0, 1);
    chooseThrow(m, a0);
    if (m.rw(0xc6d0) !== 6) setThrowTarget(m, a0);
  }
  const want = angleTo(m.rw(0xc7ce), m.rw(0xc7d2), m.rw(a0 + 0x3c), m.rw(a0 + 0x44));
  const now = turnToward(m, want, m.rw(a0 + 0x56));
  m.ww(a0 + 0x56, now);
  if (w(now) !== w(want)) return;
  if (m.rw(0xc6d0) === 6) { toState0(m, a0); return; }
  animStart(m, a0, A_THROW); // sub_03880E
  m.ww(a0 + 0x3a, 3);
  m.ww(0x8602, 0);
}

/** state 3 (loc_038820): the throw */
function throwing(m: Ram, a0: number): void {
  const r = animTick(m, a0, A_THROW);
  if (r.code === "run") return;
  if (r.code === "event") {
    if (r.value === 0) { release(m, a0); return; }
    const o = octant(m, a0) * 4;
    m.ww(a0 + 0x3c, m.rw(a0 + 0x3c) + ROM.rw(RELEASE + o));
    m.ww(a0 + 0x44, m.rw(a0 + 0x44) + ROM.rw(RELEASE + o + 2));
  }
  toIdle(m, a0);
}

/** sub_036D66: where to throw (or run) the ball: $C7C8 = 1 run to the far stumps, 2 throw at
 *  them, 3 throw to the man there; 4/5/6 the same at the near end */
function chooseThrow(m: Ram, a0: number): void {
  m.ww(0xc7d8, 0);
  if (m.rw(0xc6d0) === 6) return;
  if (m.rw(0x8602) === 0 && m.rw(0xc6d0) === 2) {
    const y = m.rw(a0 + 0x44), x = m.rw(a0 + 0x3c);
    if (w(m.rw(0xc6fc) + 0x100) > y && w(m.rw(0xc6fe) - 0x100) < y && x >= w(0xfe40) && x <= 0x1c0 && m.rw(C800 + 0x18) !== 0) {
      // already standing at the stumps with the batsmen home: hold it
      setPlay(m, 6);
      endSoon(m, 0x4b);
      return;
    }
  }
  const opts: [number, number][] = [];
  for (const end of [0x400, w(0xfc00)]) {
    const near = end === 0x400;
    const dxh = l(l(m.rw(a0 + 0x3c))) >> 1;
    const dyh = l(l(m.rw(a0 + 0x44)) - l(w(end))) >> 1;
    const d7 = l(muls(dxh, dxh) + muls(dyh, dyh));
    let d6 = w(angleTo(0, end, m.rw(a0 + 0x3c), m.rw(a0 + 0x44)) - 0x200) & 0x7ff;
    // run it in
    opts.push([near ? 1 : 4, runCost(m, d6, d7)]);
    const t = runTimeOrNull(m);
    if (t !== null) {
      let d0 = w(throwTime(m, end) - t);
      let ok = d0 >= 0 || w(d0 - 8) < 0;
      if (ok) {
        let c = throwCost(m, a0, d6, d7);
        const backer = near ? 0xc776 : 0xc77a;
        if (m.rw(a0 + 0x44) >= 0 ? (isSet(m, 0xc776) && m.rw(a0 + 0x44) > 0x400) : (isSet(m, 0xc77a) && m.rw(a0 + 0x44) < w(0xfc00))) {
          c = l(c + l(l(m.rw(0xc720)) << 8));
        }
        void backer;
        opts.push([near ? 2 : 5, c]);
      }
    }
    const backer = near ? 0xc776 : 0xc77a;
    if (isSet(m, backer)) opts.push([near ? 3 : 6, toManCost(m, d7)]);
  }
  // the option list as the original keeps it at $C7A0: [choice.w, cost.l]..., -1
  opts.forEach(([k, c], i) => { m.ww(0xc7a0 + 6 * i, k); m.wl(0xc7a2 + 6 * i, c); });
  m.ww(0xc7a0 + 6 * opts.length, -1);
  let best = -1, bestCost = 0x7fffffff, lo = 1, hi = 6;
  if (m.rw(0xc7c6) !== 0) { hi = 3; if (m.rw(0xc7c6) !== 1) { lo = 4; hi = 6; } }
  for (const [k, c] of opts) {
    if (!(lo <= k && k <= hi)) continue;
    if (!(c < bestCost)) continue;
    best = k; bestCost = c;
  }
  m.ww(0xc7c8, best);
}
function runTimeOrNull(m: Ram): number | null { const t = runTime(m); return t < 0 ? null : t; }
/** sub_036F7E: cost of running the ball to the stumps */
function runCost(m: Ram, d6: number, d7: number): number {
  let d0 = d6;
  if (d0 >= 0x400) d0 = w(-d0 + 0x800);
  d0 = w(d0 - 0x200);
  d0 = muls(d0, d0);
  d0 = l(w(div32(d0, m.rl(0xc710))));
  let d1 = l(w(div32(d7, m.rl(0xc712))));
  d0 = l(d0 + d1);
  const r = w(m.rw(0xc714) >> 1);
  if (d7 > muls(r, r)) d0 = l(d0 + l(l(m.rw(0xc70e)) << 8));
  return d0;
}
/** sub_036FD2: cost of throwing at the stumps */
function throwCost(m: Ram, a0: number, d6: number, d7: number): number {
  let d0 = d6;
  if (d0 >= 0x200) d0 = w(d0 - 0x400);
  d0 = d0 & 0x3ff;
  d0 = l(w(div32(muls(d0, d0), m.rl(0xc716))));
  let d1 = w(m.rw(a0 + 0x56) - 0x200 - d6) & 0x3ff;
  d1 = l(w(div32(muls(d1, d1), m.rl(0xc718))));
  d0 = l(d0 + d1);
  d0 = l(d0 + l(w(div32(d7, m.rl(0xc71a)))));
  const pen = l(l(m.rw(0xc70e)) << 8);
  let r = w(m.rw(0xc71c) >> 1);
  if (d7 < muls(r, r)) d0 = l(d0 + pen);
  r = w(m.rw(0xc71e) >> 1);
  if (d7 > muls(r, r)) d0 = l(d0 + pen);
  return d0;
}
/** sub_037056: cost of throwing to the man at the stumps */
function toManCost(m: Ram, d7: number): number {
  let d0 = muls(isqrt(d7), m.rw(0xc722));
  const r = w(m.rw(0xc724) >> 1);
  if (d7 < muls(r, r)) d0 = l(d0 + l(l(m.rw(0xc70e)) << 8));
  return d0;
}
/** sub_039070: steps for a throw from the chaser to the stumps at y */
function throwTime(m: Ram, y: number): number {
  const a0 = ptr(m, 0xc730);
  const dy = l(l(w(y)) - l(m.rw(a0 + 0x44))) >> 1;
  const dx = w(m.rw(a0 + 0x3c)) >> 1;
  let d0 = isqrt(l(muls(dy, dy) + muls(dx, dx)));
  d0 = l(d0 * 2);
  d0 = divs(d0, 0xa0).q;
  return w(d0 + 8 + 0xc);
}

/** sub_03707A: set the throw target for the choice in $C7C8 */
function setThrowTarget(m: Ram, a0: number): void {
  const c = m.rw(0xc7c8);
  if (c === 1) { standFrame(m, a0); m.ww(a0 + 0x3a, 0xc); m.ww(a0 + 0x38, 0xc); setPlay(m, 5); return; }
  if (c === 4) { standFrame(m, a0); m.ww(a0 + 0x3a, 0xd); m.ww(a0 + 0x38, 0xd); setPlay(m, 5); return; }
  if (c === 2 || c === 5) {
    const far = c === 5;
    m.wb(0xc850, far ? -1 : 0); m.wb(0xc848, far ? -1 : 0);
    m.ww(0xc7ce, 0); m.ww(0xc7d0, 0x3c); m.ww(0xc7d2, far ? w(0xfc00) : 0x400);
    m.ww(0xc7d8, -1);
    return;
  }
  if (c === 3 || c === 6) {
    const far = c === 6;
    m.wb(0xc850, far ? -1 : 0); m.wb(0xc848, far ? -1 : 0);
    const a1 = ptr(m, far ? 0xc77a : 0xc776);
    const o = octant(m, a0) * 4; // the thrower's facing (as in the original)
    const x = w(ROM.rw(HAND_CATCH + o) + m.rw(a1 + 0x3c));
    const y = w(ROM.rw(HAND_CATCH + o + 2) + m.rw(a1 + 0x44));
    m.ww(0xc7ce, x); m.ww(0xc7d0, 0x74); m.ww(0xc7d2, y);
    m.ww(0xc7d4, hypot(w(x - m.rw(a0 + 0x3c)), w(y - m.rw(a0 + 0x44))));
    return;
  }
  toState0(m, a0);
}

/** sub_0371CC: let go of the ball towards ($C7CE, $C7D0, $C7D2) */
function release(m: Ram, a0: number): void {
  const o = octant(m, a0) * 4;
  const x = w(ROM.rw(RELEASE + o) + m.rw(a0 + 0x3c));
  const y = w(ROM.rw(RELEASE + o + 2) + m.rw(a0 + 0x44));
  m.ww(0xe5b4, x); m.ww(0xe5b8, 0x9c); m.ww(0xe5bc, y);
  m.ww(0xc736, x); m.ww(0xc738, y);
  const dist = hypot(w(m.rw(0xc7ce) - x), w(m.rw(0xc7d2) - y));
  const d0 = dist;
  const sp = w(divs(l(w(dist)), 0x100).q + 0x18); // speed grows with distance
  const comp = (d: number, hiA: number, loA: number) => {
    let v = muls(sp, d);
    let neg = false;
    if (v < 0) { v = l(-v); neg = true; }
    let r = divu(v, d0);
    m.ww(hiA, r.q);
    v = l((r.reg & 0xffff0000)); // clr.w d2: remainder in the high word, low cleared
    r = divu(v, d0);
    m.ww(loA, r.q);
    if (neg) m.wl(hiA, l(-m.rl(hiA)));
  };
  comp(w(m.rw(0xc7ce) - m.rw(0xe5b4)), 0xe5a8, 0xe5aa);
  comp(w(m.rw(0xc7d2) - m.rw(0xe5bc)), 0xe5b0, 0xe5b2);
  // vertical speed to arrive at the target's height
  const t = l((w(d0) & 0xffff) << 16);
  let ticks = div32(t, l(w(sp)));
  let d1 = div32(ticks, 0xa);
  let d2 = l(l(w(m.rw(0xc7d0) - m.rw(0xe5b8))) << 16);
  ticks = ticks >>> 8;
  d2 = div32(d2, ticks);
  d2 = l(d2 << 8);
  m.wl(0xe5ac, l(d1 + d2));
  m.wl(0xc7d4, -1);
  ballLive(m, 2);
  setPlay(m, 1);
  m.ww(0xc7ca, -1);
  if (m.rw(0xc7d0) > 0x3c) {
    const a1 = ptr(m, m.rb(0xc848) < 0 ? 0xc77a : 0xc776);
    if (m.rw(a1 + 0x38) === 0) m.ww(a1 + 0x38, 0x30);
    toReceive(m, a1);
    m.ww(0xc7cc, 9);
  }
  m.ww(0xc72a, -1);
}

/** sub_037C38: get ready to take the throw (state 11) */
function toReceive(m: Ram, a0: number): void {
  m.ww(a0 + 0x3a, 0xb);
  const keep = m.rw(a0 + 0x56);
  aimHands(m, a0);
  m.ww(a0 + 0x56, keep);
  m.wb(0xfd0c, -1);
}
/** sub_037D02: target = where the ball will be at catching height, less the hand offset */
function aimHands(m: Ram, a0: number): void {
  if (m.rw(0xbee2) === 0) m.ww(a0 + 0x56, angleTo(m.rw(0xe5b4), m.rw(0xe5bc), m.rw(a0 + 0x3c), m.rw(a0 + 0x44)));
  const [x, , y, t] = catchPoint(m);
  if (t < 0) return;
  const table = m.rw(a0 + 0x5e) === 0x15 ? HAND_ZERO : HAND_CATCH;
  const [tx, ty] = minusHand(m, a0, table, x, y);
  m.ww(a0 + 0x2c, tx); m.ww(a0 + 0x30, ty);
}

/** state 11 (loc_037C50): wait for the ball and catch it */
function receive(m: Ram, a0: number): void {
  if (peakHeight(m) < 0x74) { endReceive(m, a0); return; }
  if (m.rb(a0 + 0x3a) === 0) {
    if (m.rw(0xbee2) === 0) faceTarget(m, a0);
    moveToTarget(m, a0);
    if (dist2Target(m, a0) > 0x40) {
      if (!(step(m, a0) > 1)) return;
    } else {
      setStep(m, a0, 2);
      m.ww(a0 + 0x5e, 0xf);
      if (peakHeight(m) > 0x9c) m.ww(a0 + 0x5e, 0x15);
      m.wl(0xc7e8, 0x7fffffff);
      return;
    }
  }
  if (!(step(m, a0) > 1)) return;
  const d0 = dist2Ball(m, a0);
  if (d0 > m.rl(0xc7e8)) {
    setPlay(m, 0);
    m.ww(0xc774, 0);
    m.ww(0x86ec, 1);
    endReceive(m, a0);
    return;
  }
  m.wl(0xc7e8, d0);
  faceBall(m, a0);
  tryCatch(m, a0, m.rw(0xc6ea));
}
function endReceive(m: Ram, a0: number): void { m.ww(a0 + 0x3a, m.rw(a0 + 0x38)); m.ww(a0 + 0x5e, 0); }

/** state 6 (loc_037E16): the catch (or taking the throw) */
function catching(m: Ram, a0: number): void {
  const r = animTick(m, a0, A_CATCH);
  if (r.code === "run" || r.code === "event") return;
  afterCatch(m, a0);
}
/** sub_03809E: out caught? */
function afterCatch(m: Ram, a0: number): void {
  if (m.rw(a0 + 0x38) !== 0) { m.ww(a0 + 0x3a, m.rw(a0 + 0x38)); return; }
  if (m.rw(0xbee2) !== 4 && m.rw(0x8606) !== 0 && m.rw(0xe580) === 0 && m.rw(0xc72e) === 0) {
    if (droppedAfter(m, a0)) return;
    m.ww(0xbee0, 1); m.ww(0xbee2, 4); m.wl(0xbee4, fullPtr(a0));
    setBallRuns(m, 0);
    clearArrows(m);
    celebrate(m, a0);
    return;
  }
  if (m.rw(0xbee2) !== 0) { toState0(m, a0); endSoon(m, 0x4b); return; }
  toThrow(m, a0);
}
/** sub_0381E4: drops it after all (state 16) */
function droppedAfter(m: Ram, a0: number): boolean {
  if (!drops(m)) return false;
  const [x, y] = plusHand(m, a0, HAND_GATHER, m.rw(a0 + 0x3c), m.rw(a0 + 0x44));
  m.ww(0xe5b4, x); m.ww(0xe5b8, 0x74); m.ww(0xe5bc, y);
  m.wl(0xe5a8, 0); m.wl(0xe5b0, 0); m.ww(0xe5ac, -2);
  ballLive(m, 2);
  setPlay(m, 0);
  clearArrows(m);
  makeChaser(m, a0);
  animStart(m, a0, A_DROP);
  m.ww(a0 + 0x3a, 0x10);
  return true;
}
/** sub_038116: the catch is held (state 8) */
function celebrate(m: Ram, a0: number): void {
  makeChaser(m, a0);
  animStart(m, a0, A_CELEBRATE);
  m.ww(a0 + 0x3a, 8);
}
/** sub_03830E: he becomes the fielder in play */
function makeChaser(m: Ram, a0: number): void {
  if (is(m, 0xc730, a0)) return;
  if (m.rl(0xc730) !== 0) { const a1 = ptr(m, 0xc730); m.ww(a1 + 0x38, 0); m.ww(a1 + 0x3a, 0); }
  m.wl(0xc730, fullPtr(a0));
  if (is(m, 0xc776, a0)) m.ww(0xc776, 0);
  else if (is(m, 0xc77a, a0)) m.ww(0xc77a, 0);
}

/** state 8 (loc_03812C): celebrating the catch, then tosses the ball up */
function celebrating(m: Ram, a0: number): void {
  const r = animTick(m, a0, A_CELEBRATE);
  if (r.code === "run") return;
  if (r.code === "end") {
    if (m.rw(0xe5ac) < 0) tryCatch(m, a0, m.rw(0xc6ea));
    return;
  }
  m.wl(0xe5a8, 0); m.wl(0xe5b0, 0); m.wl(0xe5ac, 0xc0000);
  const [x, y] = minusHand(m, a0, HAND_ZERO, w(-m.rw(a0 + 0x3c)), w(-m.rw(a0 + 0x44)));
  m.ww(0xe5b4, w(-x)); m.ww(0xe5b8, 0xbc); m.ww(0xe5bc, w(-y));
  ballLive(m, 2);
  setPlay(m, 1);
  m.ww(a0 + 0x38, 0);
  setPlay(m, 0);
  toReceive(m, a0);
}

/** state 16 (loc_0382E0): dropped catch */
function dropped(m: Ram, a0: number): void {
  if (animTick(m, a0, A_DROP).code === "run") return;
  toGather(m, a0);
}

/**
 * States 5 (loc_037552, dive) and 7 (loc_037FE4, jump) are dead code in the original: the only routines
 * that set them, the dive trigger at $03737C (-> $0373E0 -> $037536) and the jump trigger at $037F3E
 * (-> $037FA4), are never called. No bsr/jsr/jmp, PC-relative lea/pea or absolute pointer anywhere in
 * the ROM refers to either entry, so no fielder can reach these states. Not ported for that reason.
 */
function diving(_m: Ram, _a0: number): void {
  throw new Error("fielding: state 5 (dive) is unreachable in the original");
}
function jumping(_m: Ram, _a0: number): void {
  throw new Error("fielding: state 7 (jump) is unreachable in the original");
}

/** states 12 / 13 (loc_0377A8 / loc_037940): the men at the stumps (12 near end $C6FC, 13 far end) */
function atStumps(m: Ram, a0: number, near: boolean): void {
  const end = near ? 0x400 : w(0xfc00);
  const own = near ? 3 : 4;
  if (m.rw(0xc6d0) !== 6 && m.rw(0xc7ec) >= 0) return;
  const mine = () => m.rw(0xc6d0) === own || (m.rw(0xc6d0) === 5 && is(m, 0xc730, a0));
  if (!mine()) {
    m.ww(a0 + 0x2c, 0);
    m.ww(a0 + 0x30, near ? m.rw(0xc6fc) : m.rw(0xc6fe));
    let go = dist2(m, a0, 0, end) > muls(m.rw(0xc702), m.rw(0xc702));
    if (go) go = near ? dist2Target(m, a0) > muls(m.rw(0xc700), m.rw(0xc700)) : dist2Target(m, a0) > 0x100;
    if (go) { face(m, a0, 0, end); moveToTarget(m, a0); return; }
    if (!mine()) { standFrame(m, a0); watchBall(m, a0); return; }
    // (only reachable if the play state changed meanwhile)
    if (m.rw(0xc7e4) !== 0) return;
    if (!face(m, a0, 0, 0x400)) return; // both ends face $400 here (as in the original)
    breakOrWait(m, a0, 0x32);
    return;
  }
  const sub = m.rb(a0 + 0x3a);
  if (sub === 0) {
    m.ww(a0 + 0x2c, 0); m.ww(a0 + 0x30, end);
    if (!face(m, a0, 0, end)) return;
    const r = w(m.rw(0xc702) << 2);
    setStep(m, a0, dist2(m, a0, 0, end) > muls(r, r) ? 1 : 2);
    return;
  }
  if (sub === 1) {
    if (!(dist2(m, a0, 0, end) > muls(m.rw(0xc702), m.rw(0xc702)))) { setStep(m, a0, 2); return; }
    moveToTarget(m, a0);
    return;
  }
  if (m.rw(0xc7e4) !== 0) return;
  if (!face(m, a0, 0, end)) return;
  breakOrWait(m, a0, 0x4b);
}
/** at the stumps with the ball: break them if a batsman is out of his ground, else wait */
function breakOrWait(m: Ram, a0: number, wait: number): void {
  m.ww(a0 + 0x5e, 0x15);
  if (runTime(m) >= 0) { m.ww(0xc7e4, -1); ballHome(m); return; }
  m.ww(a0 + 0x5e, 0x15);
  endSoon(m, wait);
}
/** sub_0390A8: watch the ball (or the man with it) */
function watchBall(m: Ram, a0: number): void {
  let x: number, y: number;
  if (m.rw(0xc6d0) < 2) { x = m.rw(0xe5b4); y = m.rw(0xe5bc); }
  else {
    const a1 = ptr(m, 0xc730);
    if (a1 === a0) return;
    x = m.rw(a1 + 0x3c); y = m.rw(a1 + 0x44);
  }
  m.ww(a0 + 0x56, turnToward(m, angleTo(x, y, m.rw(a0 + 0x3c), m.rw(a0 + 0x44)), m.rw(a0 + 0x56)));
}

/** sub_036664: run this fielder's state (the three fielders in play always; the others only when
 *  they are doing something) */
function fielderTick(m: Ram, a0: number, pads: FieldPads): void {
  let check = true;
  if (m.rw(0x86b4) >= 0) {
    if (m.rw(0xc782) >= 0) { standFrame(m, a0); return; }
    if (is(m, 0xc730, a0) || is(m, 0xc776, a0) || is(m, 0xc77a, a0)) check = false;
  }
  for (let guard = 0; ; guard++) {
    if (check) {
      const wd = m.rw(a0 + 0x3a);
      if (wd === 9 || wd === 0) { standFrame(m, a0); return; }
    }
    const st = m.rw(a0 + 0x3a) & 0xff;
    if (st === 0 && m.rw(0xc6d0) === 1) {
      if (guard > 0) throw new Error("fielding: sub_036664 would loop forever");
      check = true; continue;
    }
    STATES[st](m, a0, pads);
    return;
  }
}

const STATES: StateFn[] = [];
STATES[0] = chase; STATES[1] = (m, a0) => pickUp(m, a0); STATES[2] = (m, a0) => aimThrow(m, a0);
STATES[3] = (m, a0) => throwing(m, a0); STATES[4] = chase; STATES[5] = (m, a0) => diving(m, a0);
STATES[6] = (m, a0) => catching(m, a0); STATES[7] = (m, a0) => jumping(m, a0); STATES[8] = (m, a0) => celebrating(m, a0);
STATES[9] = chase; STATES[10] = (m, a0) => gather(m, a0); STATES[11] = (m, a0) => receive(m, a0);
STATES[12] = (m, a0) => atStumps(m, a0, true); STATES[13] = (m, a0) => atStumps(m, a0, false);
STATES[14] = (m, a0) => missed(m, a0); STATES[15] = chase; STATES[16] = (m, a0) => dropped(m, a0);

/** sub_035EBA: all the fielders */
function fieldersTick(m: Ram, pads: FieldPads): void {
  if (m.rw(0x86b4) < 0) return;
  if (m.rw(0xc782) >= 0) m.aw(0xc782, -1);
  throwCheck(m);
  if (m.rw(0xc7ec) >= 0) { if (runTime(m) >= 0) m.ww(0xc7ec, -1); }
  if (m.rw(0x86ba) !== 0) m.aw(0x86e6, 1);
  m.ww(0x86b8, 0);
  m.ww(0x86bc, -1);
  m.aw(0xc772, 1);
  const vx = m.rw(0xe5a8), vy = m.rw(0xe5b0);
  m.wl(0xc77e, l(muls(vx, vx) + muls(vy, vy)));
  const chaser = ptr(m, 0xc730);
  fielderTick(m, chaser, pads);
  for (const a0 of recs(m)) if (!is(m, 0xc730, a0)) fielderTick(m, a0, pads);
}

// ---------------------------------------------------------------- running between the wickets

/** sub_0398DE: where the runner would stop if he started braking now ([y, steps]) */
function stopPoint(m: Ram, a0: number): [number, number] {
  let d0 = 0, d1 = 0;
  let d2 = m.rl(a0 + 0x12);
  let d3 = d2;
  const d4 = w(7 - m.rw(a0 + 0xe));
  d1 = w(d1 + d4 + d4);
  d3 = l(d3 + d3); if (d4 & 1) d0 = l(d0 + d3);
  d3 = l(d3 + d3); if (d4 & 2) d0 = l(d0 + d3);
  d3 = l(d3 + d3); if (d4 & 4) d0 = l(d0 + d3);
  d3 = asr(m.rl(a0 + 0xa), 4);
  for (;;) {
    d2 = l(d2 - d3);
    if (d2 < 0) break;
    d0 = l(d0 + d2);
    d1 = w(d1 + 1);
  }
  if (m.rw(a0 + 8) < 0) d0 = l(-d0);
  d0 = l(d0 + m.rl(a0 + 4));
  return [w(d0 >>> 16), d1];
}

/** sub_0397F8: steps the striker needs to make his ground, or -1 if he is in it */
function runTime(m: Ram): number {
  if (m.rw(C800 + 0x18) !== 0) return -1;
  return runTimeAlways(m);
}
/** sub_039804: steps the striker needs to reach the crease he is running to */
function runTimeAlways(m: Ram): number {
  const a0 = C800;
  const keep = m.rl(a0 + 0x12);
  m.wl(a0 + 0x12, m.rl(a0 + 0xa));
  let [d0, d1] = stopPoint(m, a0);
  m.wl(a0 + 0x12, keep);
  d0 = w(d0 - m.rw(a0 + 4));
  const a1 = l(d0 << 16);
  const a2 = w(d1);
  let d2 = -1;
  let d3 = m.rl(a0 + 4);
  const d5 = m.rl(a0 + 0xa);
  let d6 = m.rl(a0 + 0x12);
  if (m.rw(a0 + 0x16) > 1) return a2;
  for (;;) {
    d2 = w(d2 + 1);
    if (!(d5 >= d6)) d6 = d5; else d6 = l(d6 + asr(d5, 2));
    if (m.rw(a0 + 8) >= 0) { d3 = l(d3 + d6); if (l(d3 + a1) < 0x3700000) continue; }
    else { d3 = l(d3 - d6); if (l(d3 + a1) > l(0xfc900000)) continue; }
    break;
  }
  return w(d2 + a2);
}

/** sub_039938: steps until the fielding side can break the stumps (-1 = can't tell) */
function fieldTime(m: Ram): number {
  if (m.rw(0xc6d0) >= 3) return -1;
  const a0 = ptr(m, 0xc730);
  const st = m.rw(a0 + 0x3a) & 0xff;
  const four = 4; // sub_039B12
  const throwAnim = () => animTicks(m, a0, A_THROW, 0, false); // sub_039B56
  const flight = () => { // sub_039B66
    const [x, y] = m.rw(0xe5a2) === 0 ? [m.rw(a0 + 0x3c), m.rw(a0 + 0x44)] : [m.rw(a0 + 0x2c), m.rw(a0 + 0x30)];
    const d = l(w(hypot(x, y)));
    return divs(d, w((d >> 8) + 0x18)).q;
  };
  const toTarget = () => divs(l(w(hypot(w(m.rw(a0 + 0x2c) - m.rw(a0 + 0x3c)), w(m.rw(a0 + 0x30) - m.rw(a0 + 0x44))))), m.rw(a0 + 0x48)).q; // sub_039B9A
  const pickupAnims = () => w(animTicks(m, a0, A_STOOP, 0x80, false) + animTicks(m, a0, A_PICKUP, 0x80, false)); // sub_039AE6
  const sum = (...v: number[]) => v.reduce((a, b) => w(a + b), 0);
  switch (st) {
    case 0: case 4: case 8: case 14: case 15: {
      if (m.rw(0xc6d0) === 1) return flight();
      let d1 = 0;
      if (m.rw(0xc6d0) !== 2) d1 = sum(toTarget(), pickupAnims());
      return sum(d1, four, throwAnim(), flight());
    }
    case 1: return sum(animTicks(m, a0, A_STOOP, 0x80, true), animTicks(m, a0, A_PICKUP, 0x80, true), four, throwAnim(), flight());
    case 2: return sum(four, throwAnim(), flight());
    case 3: return sum(m.rw(0xe5a2) !== 0 ? 0 : animTicks(m, a0, A_THROW, 0, true), flight());
    case 5: return sum(animTicks(m, a0, A_DIVE_UP, 0x80, true), four, throwAnim(), flight());
    case 6: return sum(animTicks(m, a0, A_CATCH, 0x80, true), four, throwAnim(), flight());
    case 10: return sum(toTarget(), pickupAnims(), four, throwAnim(), flight());
    case 11: return sum(toTarget(), animTicks(m, a0, A_CATCH, 0x80, false), four, throwAnim(), flight());
    case 16: return sum(animTicks(m, a0, A_DROP, 0x80, true), pickupAnims(), four, throwAnim(), flight());
    default: return -1;
  }
}

/** sub_03950A: start a run if one was asked for */
function startRun(m: Ram): void {
  const a0 = C800;
  if (m.rw(a0 + 0x1a) === 0) return;
  m.wb(0xc7f2, 0);
  m.ww(a0 + 0x1a, 0);
  m.ww(a0 + 0x16, 1);
  m.ww(a0 + 8, 0);
  if (m.rw(a0 + 4) > w(0xfc90)) m.ww(a0 + 8, ~m.rw(a0 + 8));
}

/** sub_0397BE: the bat's reach at this stride frame (table $397E0) */
function batReach(m: Ram, a0: number): number {
  let f = m.rw(a0 + 0xe);
  if (f > 0xc) f = w(f - 0xc);
  let d0 = ROM.rw(0x397e0 + 2 * f);
  if (m.rw(a0 + 4) < 0) d0 = w(-d0);
  return w(d0 + m.rw(a0 + 4));
}
/** sub_039792: is the striker in his ground (beyond either popping crease)? */
export function inGround(m: Ram): boolean {
  batReach(m, C800);
  const y = m.rw(C800 + 4);
  return y <= w(0xfc90) || y >= 0x370;
}

/** sub_0395C8: the striker's running (state $16) */
function runner(m: Ram): void {
  const a0 = C800;
  const top = m.rl(a0 + 0xa);
  const dir = () => m.rw(a0 + 8);
  const along = (v: number) => m.wl(a0 + 4, l(m.rl(a0 + 4) + (dir() !== 0 ? l(-v) : v)));
  const s = m.rw(a0 + 0x16);
  let skipGround = false;
  if (s === 1) {
    if (m.rw(C81E) < 0) { m.ww(a0, m.rw(a0) + 2); if (m.rw(a0) > 0x78) m.ww(a0, 0x78); }
    else { m.ww(a0, m.rw(a0) - 2); if (m.rw(a0) < w(0xff88)) m.ww(a0, w(0xff88)); }
    if (!(top >= m.rl(a0 + 0x12))) m.wl(a0 + 0x12, top);
    else m.wl(a0 + 0x12, l(m.rl(a0 + 0x12) + asr(top, 2)));
    const sp = m.rl(a0 + 0x12);
    m.wl(a0 + 0xe, l(m.rl(a0 + 0xe) + (sp >>> 7)));
    m.ww(a0 + 0xe, m.rw(a0 + 0xe) & 3);
    if (m.rw(a0 + 8) >= 0) {
      m.wl(a0 + 4, l(m.rl(a0 + 4) + sp));
      if (stopPoint(m, a0)[0] >= 0x390) m.ww(a0 + 0x16, 2);
    } else {
      m.wl(a0 + 4, l(m.rl(a0 + 4) - sp));
      if (!(stopPoint(m, a0)[0] > w(0xfc70))) m.ww(a0 + 0x16, 2);
    }
  } else if (s === 2) {
    along(m.rl(a0 + 0x12));
    m.wl(a0 + 0xe, l(m.rl(a0 + 0xe) + 0x8000));
    if (m.rw(a0 + 0xe) >= 7) m.ww(a0 + 0x16, 3);
  } else if (s === 3) {
    m.wl(a0 + 0x12, l(m.rl(a0 + 0x12) - asr(top, 4)));
    if (m.rl(a0 + 0x12) < 0) { m.wl(a0 + 0x12, 0); m.ww(a0 + 0x16, 4); }
    else along(m.rl(a0 + 0x12));
  } else if (s === 4) {
    m.aw(a0 + 0xe, 1);
    if (m.rw(a0 + 0xe) === 0xb) {
      m.ww(a0 + 8, ~m.rw(a0 + 8));
      m.ww(a0 + 0x16, 0);
      m.ww(a0 + 0xe, 0);
      const y = m.rw(a0 + 4);
      if (y > w(0xfc90) && y < 0x370) m.ww(a0 + 0x16, 1);
    }
  } else if (s === 5) {
    m.wl(a0 + 0x12, l(m.rl(a0 + 0x12) - asr(top, 2)));
    if (m.rl(a0 + 0x12) < 0) m.wl(a0 + 0x12, 0);
    along(m.rl(a0 + 0x12));
    m.wl(a0 + 0xe, l(m.rl(a0 + 0xe) + 0x8000));
    if (m.rw(a0 + 0xe) === 0xb) {
      m.ww(a0 + 8, ~m.rw(a0 + 8));
      m.ww(a0 + 0x16, 1);
      m.ww(a0 + 0xe, 0);
    }
  } else if (s !== 0) {
    m.wl(a0 + 0x12, l(m.rl(a0 + 0x12) - asr(top, 2)));
    if (m.rl(a0 + 0x12) < 0) { m.wl(a0 + 0x12, 0); m.ww(a0 + 0x18, 0); }
    const sp = m.rl(a0 + 0x12);
    m.wl(a0 + 0xe, l(m.rl(a0 + 0xe) + (sp >>> 3)));
    m.ww(a0 + 0xe, m.rw(a0 + 0xe) & 3);
    along(sp);
    skipGround = true;
  }
  if (skipGround) return;
  if (!inGround(m)) m.ww(a0 + 0x18, 0);
  else if (m.rw(a0 + 0x18) >= 0) m.ww(a0 + 0x18, 1);
}

/** sub_03959E: both batsmen (the non-striker mirrors the striker) */
function runners(m: Ram): void {
  runner(m);
  m.ww(C81E + 4, w(-m.rw(C800 + 4)));
  m.ww(C81E + 0xe, m.rw(C800 + 0xe));
  m.ww(C81E + 8, ~m.rw(C800 + 8));
}

/** sub_03953C: a run completed */
function runMade(m: Ram): void {
  const a0 = C800;
  const g = m.rw(a0 + 0x18);
  if (g <= 0) return;
  const y = m.rw(a0 + 4);
  if (m.rb(0xc7f4) === 0) {
    if (y <= w(0xfc90)) return;
    m.wb(0xc7f4, -1);
  } else {
    if (y >= 0x370) return;
    m.wb(0xc7f4, 0);
  }
  if (m.rw(0xbee2) !== 0) return;
  setBallRuns(m, w(ballRuns(m) + 1));
  m.ww(a0 + 0x18, -1);
}

/** sub_039316: decide whether to run (computer batsman, or the human's button) and move the batsmen */
function running(m: Ram, pads: FieldPads): void {
  const a0 = C800;
  if (m.rw(0xb520) < 0) {
    // the computer batsman
    if (m.rw(a0 + 0x18) !== 0) aiStartRun(m);
    else if (m.rw(0xc7f2) === 0 && aiTurnBack(m)) {
      const y = m.rw(a0 + 4);
      const go = m.rw(a0 + 8) === 0 ? !(y > w(0xfeda)) : !(y < 0x126);
      if (go) { m.wb(0xc7f2, -1); if (m.rw(a0 + 0x16) <= 1) m.ww(a0 + 0x16, 5); }
    }
    runners(m); runMade(m);
    return;
  }
  if (m.rw(0xbee2) === 0) {
    if (inningsOver(m)) return;
    if (m.rw(a0 + 0x18) !== 0) {
      if (m.rw(a0 + 0x16) === 0) {
        if (m.rw(0xbee2) !== 0 || m.rw(0x86ea) !== 0 || m.rw(0xc6d0) >= 3) return;
        const meter = m.rw(0xe8fa + 0x10); // sub_04B952
        if (meter >= 0x3f) { pads.batting(m); m.ww(a0 + 0x1a, -1); }
        else if (pads.batting(m) & m.rw(0xc0c2)) m.ww(a0 + 0x1a, -1);
        startRun(m);
      }
    } else if (pads.batting(m) & m.rw(0xc0c2)) {
      const y = m.rw(a0 + 4);
      let turn = false;
      if (m.rw(a0 + 8) === 0) {
        if (!(y < w(0xfd58))) { if (y < 0) turn = true; else if (!(y < 0x294)) m.ww(a0 + 0x1a, -1); }
      } else {
        if (!(y > 0x2a8)) { if (y >= 0) turn = true; else if (!(y > w(0xfd6c))) m.ww(a0 + 0x1a, -1); }
      }
      if (turn && m.rw(a0 + 0x16) <= 1) m.ww(a0 + 0x16, 5);
    }
  }
  if (m.rw(a0 + 0x16) === 1) m.wl(a0 + 0xa, 0x100000);
  runners(m); runMade(m);
}
/** sub_039378: the computer batsman sets off if he can make it */
function aiStartRun(m: Ram): void {
  if (m.rw(0x86b4) < 0 || m.rw(0xbee2) !== 0 || inningsOver(m)) return;
  if (m.rw(C800 + 0x16) !== 0) return;
  const d1 = w(fieldTime(m) - runTimeAlways(m) + (rngNextAt(m) & 7));
  if (d1 < 0) return;
  m.ww(C800 + 0x1a, 1);
  startRun(m);
}
/** sub_0393C6: the computer batsman turns back if the run is no longer safe */
function aiTurnBack(m: Ram): boolean {
  let y = m.rw(C800 + 4); if (y < 0) y = w(-y);
  if (y > 0x294) return false;
  const d1 = w(fieldTime(m) - runTimeAlways(m) + (rngNextAt(m) & 7));
  return d1 < 0;
}

/** sub_00DFD2: has the batting side reached its target? (never in practice) */
function inningsOver(m: Ram): boolean {
  if (m.rw(0xbe68 + 0x2c) === m.rw(0xbe68 + 0x14)) return false;
  return false; // sub_030E00 (chasing a total): phase 4
}

/** sub_0392BA: running between the wickets, counting the crossings */
function runningTick(m: Ram, pads: FieldPads): void {
  if (m.rw(0x86b4) < 0) return;
  running(m, pads);
  const a0 = C800;
  if (m.rw(a0 + 8) === 0) {
    if (m.rw(0xc7ee) === 1) return;
    if (m.rw(a0 + 4) < 0) return;
    m.aw(0xc7f0, 1); m.ww(0xc7ee, 1);
  } else {
    if (m.rw(0xc7ee) === -1) return;
    if (m.rw(a0 + 4) >= 0) return;
    m.aw(0xc7f0, 1); m.ww(0xc7ee, -1);
  }
}

/** sub_039188: the batsmen take their places for running */
function runnersInit(m: Ram, pads: FieldPads): void {
  m.ww(C800, m.rw(0x8610)); m.ww(C800 + 4, m.rw(0x8614));
  m.ww(C800 + 8, -1); m.ww(C800 + 0x1c, -1);
  runnerInit(m, C800);
  m.ww(C81E, m.rw(0xe574) < 0 ? -0xa0 : 0xa0);
  m.ww(C81E + 4, w(0xfc90));
  m.ww(C81E + 8, 0); m.ww(C81E + 0x1c, 0);
  runnerInit(m, C81E);
  m.wb(0xc7f2, 0); m.wb(0xc7f4, -1);
  m.ww(0xc7ee, 1); m.ww(0xc7f0, 0);
  if (m.rw(0xb520) >= 0) {
    // sub_04B8C2 (the run meter) and sub_04BB3A (drop presses)
    const a0 = 0xe8fa;
    m.ww(a0, 0); m.ww(a0 + 6, 0); m.wl(a0 + 0x10, 0);
    m.wl(a0 + 8, l((mulu(0xc00, 0xc000) >> 8) + 0x2000));
    m.wl(a0 + 0xc, l((mulu(0x500, 0xc000) >> 8) + 0x2000));
    m.ww(a0 + 2, m.rw(0xb520));
    for (let i = 0; i < 8; i++) m.wl(a0 + 0x1a + 4 * i, 0x7fff7fff);
    m.ww(a0, -1);
    pads.batting(m);
  }
}
/** sub_039240 */
function runnerInit(m: Ram, a0: number): void {
  m.ww(a0 + 0xe, 0); m.wl(a0 + 0xa, 0x100000); m.wl(a0 + 0x12, 0);
  m.ww(a0 + 0x16, 0); m.ww(a0 + 0x18, -1); m.ww(a0 + 0x1a, 0);
}

// ---------------------------------------------------------------- set-up and the loop

/** sub_035776 (with sub_036650, sub_0355BA): fielding parameters from $FF6AEA.., fielders reset */
function fieldersInit(m: Ram): void {
  for (let i = 0; i < 14; i++) m.ww(0xc6e0 + 2 * i, m.rw(0x6aea + 2 * i));
  for (let i = 0; i < 23; i++) m.ww(0xc6fc + 2 * i, m.rw(0x6b22 + 2 * i));
  for (let i = 0; i < 3; i++) m.ww(0xc796 + 2 * i, m.rw(0x6b7e + 2 * i));
  for (let i = 0; i < 6; i++) m.ww(0xc6d4 + 2 * i, m.rw(0x6ad2 + 2 * i));
  for (const a0 of recs(m)) {
    m.ww(a0 + 0x56, angleTo(0, 0x400, m.rw(a0 + 0x3c), m.rw(a0 + 0x44)));
    m.ww(a0 + 0x28, hypot(m.rw(a0 + 0x3c), w(m.rw(a0 + 0x44) - 0x400)));
    toState0(m, a0);
    m.ww(a0 + 0x38, 0);
    m.ww(a0 + 0x40, 0);
    m.ww(a0 + 0x5e, 0);
    m.ww(a0 + 0x48, fielderSpeed(m));
  }
  m.ww(0xc734, 0);
  m.ww(0xc730, -1);
  m.wl(0xc776, 0); m.wl(0xc77a, 0);
  m.ww(0xc7cc, 9);
  m.ww(0xc78c, -1);
  m.ww(0xc774, 0);
  clearArrows(m);
  m.ww(0xc7c6, 0);
  m.ww(0xc11a, 0);
  m.ww(0xc79c, 0); m.ww(0xc72e, 0); m.ww(0xc7e6, 0);
}

/** sub_0351BA / sub_0351DE: placings to field positions */
function placings(m: Ram): void {
  for (const a0 of recs(m)) {
    m.ww(a0 + 0x3c, divs(muls(m.rw(a0 + 0x34), 0x13b0), 0x6000).q);
    m.ww(a0 + 0x44, divs(muls(m.rw(a0 + 0x36), 0x1c24), 0x6000).q);
  }
}
/** sub_00BF2A / sub_00BF3A: fielder with role d0 (after a1) */
function byRole(m: Ram, role: number, after = -1): number {
  let a1 = after < 0 ? fielders(m) : after + REC;
  const end = fielders(m) + 11 * REC;
  for (; a1 < end; a1 += REC) if (m.rw(a1 + 6) === role) return a1;
  return -1;
}

export type FieldEnd = "dead" | "boundary" | "wicket" | "home" | "over";

type Phase =
  | { kind: "main" }
  | { kind: "wait"; label: string; left: number; then: () => void; before?: () => void }
  | { kind: "done"; end: FieldEnd };

/** The fielding view. setup() is sub_0343EA; step() is one pass of the loop at $034866. */
export class FieldView {
  phase: Phase = { kind: "main" };
  /** which loop the last pass belonged to (the original's call site of sub_034A82) */
  label = "main";
  constructor(public m: Ram, public pads: FieldPads) { arrowPads = pads; }

  setup(): void {
    const m = this.m;
    m.ww(0xc7ca, 0); m.ww(0x86ea, 0); m.ww(0xc6d2, 0); m.ww(0xc7e4, 0);
    setPlay(m, 0);
    m.ww(0xc782, 0);
    m.ww(0xc6cc, 0); m.ww(0xc6ce, 0); m.ww(0xc6ca, 0);
    m.ww(0xc736, m.rw(0xe5b4)); m.ww(0xc738, m.rw(0xe5bc));
    m.ww(0xc7ec, -1);
    runnersInit(m, this.pads);
    m.ww(0xc7fc, 0);
    placeFielders(m);
    placings(m);
    const bowler = byRole(m, 1);
    if (bowler >= 0) { m.ww(bowler + 0x3c, m.rw(0xd26c)); m.ww(bowler + 0x44, m.rw(0xd270)); }
    const s1 = byRole(m, 3);
    if (s1 >= 0) {
      let a = ptr(m, 0xe1b8); m.ww(s1 + 0x3c, m.rw(a + 0xfc)); m.ww(s1 + 0x44, m.rw(a + 0x104));
      const s2 = byRole(m, 3, s1);
      if (s2 >= 0) { a = ptr(m, 0xe1bc); m.ww(s2 + 0x3c, m.rw(a + 0xfc)); m.ww(s2 + 0x44, m.rw(a + 0x104)); }
    }
    const keeper = byRole(m, 4);
    { const a = ptr(m, 0xe1b4); const k = keeper >= 0 ? keeper : fielders(m) + 11 * REC; m.ww(k + 0x3c, m.rw(a + 0xfc)); m.ww(k + 0x44, m.rw(a + 0x104)); }
    fieldersInit(m);
    m.ww(0xc7fe, -1);
    m.ww(0x8602, 0);
    m.ww(0xc79e, 0);
    m.ww(0xc784, 0);
    m.ww(0xc768, 0); m.ww(0x86ba, 0); m.ww(0x86b8, 0);
    restPoint(m);
    m.ww(0x86ec, 2);
    reassign(m);
    if (m.rw(0xb526) >= 0 && humanFields(m)) {
      const ry = m.rw(0x86c6), rx = m.rw(0x86be);
      if (ry > 0x590 || ry < w(0xfcc8) || rx > 0x258 || rx < w(0xfda8)) m.ww(0x8602, -1);
    }
    m.ww(0xe5a2, 2); m.ww(0xe936, 2);
    m.ww(0xe8f2, 0xa0); m.ww(0xe8f4, 0x82);
    backUp(m);
    let d0: number, d1: number;
    if (m.rw(0x8602) === 0) {
      m.ww(0xc6ca, 1);
      [d0, d1] = camTarget(m, m.rw(0xe5b4), m.rw(0xe5bc));
      m.ww(0xe59a, d0 + m.rw(0xc6cc)); m.ww(0xe59e, d1 + m.rw(0xc6ce));
      const bx = w(l(m.rl(0xe5b4) - l(m.rl(0xe5a8) << 4)) >>> 16);
      const by = w(l(m.rl(0xe5bc) - l(m.rl(0xe5b0) << 4)) >>> 16);
      [d0, d1] = camTarget(m, bx, by);
    } else {
      m.ww(0xc6ca, 2);
      const a0 = ptr(m, 0xc730);
      [d0, d1] = camTarget(m, m.rw(a0 + 0x3c), m.rw(a0 + 0x44));
    }
    d0 = w(d0 + m.rw(0xc6cc) + 0x3c8); d1 = w(d1 + m.rw(0xc6ce) + 0x230);
    m.ww(0x8d08, d0); m.ww(0x8d0c, d0); m.ww(0x8d02, d1); m.ww(0x8d06, d1);
    m.ww(0xc6c8, 0);
    controllers(m);
    this.phase = { kind: "main" };
  }

  /** sub_034A82: one step of the fielding view */
  tick(): void {
    const m = this.m;
    let x: number, y: number, who: number;
    const ball = () => { x = m.rw(0xe5b4); y = m.rw(0xe5bc); who = 1; };
    const on = (a: number, k: number) => { const a0 = ptr(m, a); x = m.rw(a0 + 0x3c); y = m.rw(a0 + 0x44); who = k; };
    const st = m.rw(0xc6d0);
    if (st === 0) { if (m.rw(0x8602) === 0) ball(); else on(0xc730, 2); }
    else if (st === 1 || m.rw(0xe5a2) !== 0) ball();
    else if (st === 3) on(0xc776, 4);
    else if (st === 4) on(0xc77a, 3);
    else on(0xc730, 2);
    camOn(m, x!, y!, who!);
    camScroll(m);
    ballStep(m, () => bounceAssist(m));
    runningTick(m, this.pads);
    fieldersTick(m, this.pads);
    // sub_035F44 (fielder sprites) also runs the human fielder's marker: sub_0364BC
    markerTick(m);
    ballView(m);
    runnerSpritesD6(m); // sub_039260
    if (m.rw(0xe934) !== 0) ballDead(m);
    m.ww(0xe936, m.rw(0xe5a2));
  }

  /** what the original does after the frame of the last pass (checks, scoring); it runs at the
   *  start of the next step(), or from settle() when the caller needs the outcome */
  private pending: (() => void) | null = null;

  /** run the after-the-frame part of the last pass (call once the view is over) */
  settle(): void {
    while (this.pending) { const f = this.pending; this.pending = null; f(); }
  }
  get done(): boolean { this.settle(); return this.phase.kind === "done"; }

  /** one pass of the current loop */
  step(): void {
    const m = this.m;
    this.settle();
    const ph = this.phase;
    if (ph.kind === "done") return;
    if (ph.kind === "wait") {
      this.label = ph.label;
      if (ph.before) ph.before();
      this.tick();
      // the last step of these ends the fielding view before its frame is shown
      if (ph.label === "endX" || ph.label === "wktEnd" || ph.label === "retEnd") m.ww(0x86b2, -1);
      // sub_039F0E: the run-out replay sets up its flying bails (sub_03A85C, sub_03AA28)
      if (ph.label === "retEnd") for (let i = 0; i < 6; i++) rngNextAt(m);
      if (--ph.left <= 0) this.pending = ph.then;
      return;
    }
    this.label = "main";
    if (m.rw(0x86b4) >= 0) {
      throwCheck(m);
      if (m.rw(0x86ec) >= 0) m.aw(0x86ec, -1);
    }
    backUp(m);
    this.tick();
    this.pending = () => this.afterMain();
  }

  private wait(label: string, n: number, then: () => void, before?: () => void): void {
    this.phase = { kind: "wait", label, left: n, then, before };
  }
  private finish(end: FieldEnd): void { this.phase = { kind: "done", end }; }
  /** loc_034A58: the ball is over; without a batting milestone (sub_04C614) one more step */
  private wrapUp(end: FieldEnd): void {
    const m = this.m;
    if (milestone(m)) { this.finish(end); return; }
    this.wait("endX", 1, () => this.finish(end), () => holdBall(m));
  }

  private afterMain(): void {
    const m = this.m;
    if (this.humanHeld()) { this.wait("end", 16, () => this.wrapUp("dead")); return; }
    this.humanAutoOff();
    if (m.rw(0xc6d2) < 0) {
      // loc_03AEFA: the ball reached the rope
      this.wait("four", 1, () => { this.boundary(); }, () => holdBall(m));
      return;
    }
    if (inningsOver(m)) { setPlay(m, 5); this.wait("over", 10, () => this.wrapUp("over")); return; }
    if (m.rw(0xbee2) !== 0) {
      if (m.rw(ptr(m, 0xc730) + 0x3a) !== 0) return;
      this.wait("wkt", 10, () => {
        this.wait("wktEnd", 1, () => this.finish("wicket"), () => holdBall(m));
      });
      return;
    }
    if (m.rw(0xc7e4) !== 0) {
      let y = m.rw(C800 + 4); if (y < 0) y = w(-y);
      if (m.rw(0x86ea) === 0 && y >= 0x380) { this.wait("ret", 26, () => this.wrapUp("dead")); return; }
      this.wait("retEnd", 1, () => {
        runOutCheck(m);
        this.finish(m.rw(0xbee2) !== 0 ? "wicket" : "home");
      }, () => holdBall(m));
      return;
    }
    // sub_03917A: the countdown
    const c = m.rw(0xc7ec);
    if (c < 0) return;
    if (c !== 0 && m.aw(0xc7ec, -1) !== 0) return;
    this.wait("end", 16, () => this.wrapUp("dead"));
  }

  /** after the step at the rope: the runs */
  private boundary(): void {
    const m = this.m;
    m.ww(0xc7f0, 0);
    if (m.rw(0x8606) === 0 || m.rw(0xc7ca) !== 0) setBallRuns(m, w(ballRuns(m) + 4));
    else if (m.rw(0xe580) !== 0) { setBallRuns(m, 4); m.aw(striker(m) + 0x1e, 1); }
    else { setBallRuns(m, 6); m.aw(striker(m) + 0x20, 1); }
    this.finish("boundary");
  }

  /** sub_036B2A: the human fielder has stood still with the ball between the wickets for $95 steps */
  private humanHeld(): boolean {
    const m = this.m;
    if (m.rw(0x8602) === 0) return false;
    const clear = () => { m0(m, 0xc11a); return false; };
    if (m.rw(0xc6d0) !== 2) return clear();
    const a0 = ptr(m, 0xc730), y = m.rw(a0 + 0x44), x = m.rw(a0 + 0x3c);
    if (!(w(m.rw(0xc6fc) + 0x100) > y)) return clear();
    if (w(m.rw(0xc6fe) - 0x100) >= y) return clear();
    if (x < -0x1c0 || x > 0x1c0) return clear();
    if (padHeld(m, m.rw(0xb526)) !== 0) return clear();
    return m.aw(0xc11a, 1) >= 0x95;
  }
  /** sub_036B94: the computer takes over the human's fielding after 6000 steps without input, or once
   *  12 runs have been run on the ball */
  private humanAutoOff(): void {
    const m = this.m;
    if (m.rw(0x8602) === 0) return;
    if (padHeld(m, m.rw(0xb526)) !== 0) { m0(m, 0xc79e); return; }
    if (m.aw(0xc79e, 1) < 0x1770 && ballRuns(m) < 0xc) return;
    m.ww(0x8602, 0);
    clearArrows(m);
    m.ww(0x86bc, -1); m.ww(0x86ba, 0); m.ww(0x86b8, 0); m.ww(0x86b6, 0);
    restPoint(m); // sub_038F2A
    chooseChaser(m);
    pickChaser(m);
    m.ww(0xc6ca, 0);
  }
}
const m0 = (m: Ram, a: number) => m.ww(a, 0);

/** sub_0364BC: the human fielder's target marker (only its state words) */
function markerTick(m: Ram): void {
  if (m.rw(0xc784) === 0) return;
  if (m.rw(0x8602) === 0 || m.rw(0xc6d0) !== 0) { m.ww(0xc784, 0); return; }
  const a0 = ptr(m, 0xc730);
  if (m.rw(0xc78c) < 0) { m.ww(0xc786, m.rw(a0 + 0x2c)); m.ww(0xc788, m.rw(a0 + 0x30)); m.ww(0xc78c, m.rw(a0 + 0x32)); }
  const sh = m.rw(0xc798) & 63;
  for (const [cur, tgt] of [[0xc792, 0xc786], [0xc794, 0xc788]]) {
    const d1 = w(m.rw(tgt) - m.rw(cur));
    if (d1 === 0) continue;
    let d0 = sh >= 16 ? (d1 < 0 ? -1 : 0) : w(d1 >> sh);
    if (d0 === 0) d0 = d1 < 0 ? -1 : 1;
    m.ww(cur, m.rw(cur) + d0);
  }
}

/** sub_039260 -> sub_039BC2 (display): the running batsmen's sprite offsets; the second runner's
 *  y offset is left in d6 */
function runnerSpritesD6(m: Ram): void {
  const a0 = C81E;
  let d2: number;
  if (m.rw(a0 + 0xe) >= 4) d2 = w(m.rw(a0 + 0xe) + 4);
  else d2 = ((l(m.rl(a0 + 0xe) << 1) >>> 16) & 7);
  if (m.rw(a0 + 8) === 0) d2 = w(d2 + 0x10);
  m.fd6 = l((m.fd6 & ~0xffff) | (ROM.rb(0x39c23 + 2 * d2) & 0xffff));
}

/** sub_03474C -> sub_00420C / sub_0041CA: the controllers' modes for this ball; drops all presses */
function controllers(m: Ram): void {
  let d2 = 0;
  const side = (ctl: number, d1: number) => {
    if (ctl < 0) return;
    if (ctl === 2) { m.ww(0xfc18 + 4, d1); m.ww(0xfc1e + 4, d1); }
    else m.ww((ctl === 0 ? 0xfc18 : 0xfc1e) + 4, d1);
    let d3 = 1 << (d1 & 7);
    if (ctl !== 0) d3 <<= 2;
    d2 |= d3;
  };
  side(m.rw(0xb526), m.rw(0xbe68 + 0x2e) & 1);
  side(m.rw(0xb520), m.rw(0xbf08) & 1);
  m.ww(0xfc24, d2); m.ww(0xfc26, d2); m.ww(0xfc2a, 0x33);
  for (const a of [0xfbf8, 0xfc00, 0xfc08, 0xfc10]) m.ww(a + 2, 0);
}

/** sub_04C614 / sub_04C638: did the striker reach 50, 100, ... with this ball? (the original then
 *  shows a celebration instead of one last step) */
function milestone(m: Ram): boolean {
  if (m.rw(0x8606) === 0) return false;
  const runs = ballRuns(m);
  const a1 = striker(m);
  const before = m.rw(a1 + 0x1c);
  const after = w(runs + before);
  for (let a0 = 0x4c68c; ; a0 += 0xc) {
    const t = ROM.rw(a0);
    if (t < 0) { m.wl(0xe966, 0); return false; }
    if (before >= t || !(after >= t)) continue;
    if (ROM.rl(a0 + 2) !== 0) {
      // sub_04C712: a special case for one match situation
      const ok = m.rw(0xa6c6) === 1 && m.rw(0xbe78) !== 0 && m.rw(0xbe76) === 4 && m.rw(0xbe7c) === 3;
      if (!ok) { m.wl(0xe966, 0); return false; }
    }
    m.wl(0xe966, a0);
    return true;
  }
}

/** sub_03A4A0 (in the run-out replay): run out if the striker is short of his ground */
function runOutCheck(m: Ram): void {
  if (inGround(m)) return;
  const end = m.rb(0xc850) === 0 ? 0x370 : w(0xfc90);
  let d1 = w(m.rw(C800 + 4) - end); if (d1 < 0) d1 = w(-d1);
  let d2 = w(m.rw(C81E + 4) - end); if (d2 < 0) d2 = w(-d2);
  m.ww(0xbee2, 5);
  m.ww(0xbee0, d1 > d2 ? 2 : 1);
}

export { swap, lsl, mulu };
