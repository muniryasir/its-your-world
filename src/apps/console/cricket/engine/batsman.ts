// The batsman: stance, footwork, shot selection and planning, the swing, and bat-ball contact.
// Ported from the batting code at $0446B2-$0462FE. The batsman struct is at $8610:
//   +0 x, +4 y (crease, also the perspective scale), +6 state, +8 state to return to, +A/+C stance
//   counters, +E animation frame, +$10 timer, +$12 shot definition (ROM pointer), +$16 frame, +$18 step,
//   +$1A swing phase.
// A shot plan ($D2DE / $D2FE, pointer $D2DA): +0..+4 predicted ball x,z,y at the crease, +6/+8 its
// screen position, +$12 batsman x to line the sweet spot up, +$14 bat height, +$16 swing frames,
// +$18 contact frame, +$1A ball y when the swing must start, +$1C planned, +$1E misjudge offset.

import { Ram, ROM, SIN, COS } from "./mem";
import { w, l, muls, mulu, asr, lsl, divs, div32, hiAfterShift } from "./m68k";
import { Context } from "./context";
import { project } from "./project";
import { predictAtY, predictAfter } from "./ball";
import { rngNextAt } from "./rngAt";
import { registerObject, deadBall } from "./collide";
import { edgeLift } from "./fielders";

const BAT = 0x8610;
const SHOT_DEFS = 0x44d8e; // 16 bytes per shot: handler.l, -1, -1, firstFrame, lastStep, holdOff, 0
const DIR_TO_SHOT = 0x44d6e;
const PLAN0 = 0xd2de, PLAN1 = 0xd2fe;
const BATPOLY = 0xd370; // RAM copy of the bat outlines ($306), mirrored for left-handers

const plan = (m: Ram) => m.rl(0xd2da) & 0xffff;

// ---------------------------------------------------------------- input (pad 1 via the $FBF8 block)

/** sub_00464C: which pad block the batting player reads. $FC18 = [pad, second pad, mode]; mode 1
 *  reads the second pad slot (with player bit 2 in $FC26). */
export function batPad(m: Ram): number {
  const mode = m.rw(0xfc1c);
  const slot = mode === 1 ? m.rw(0xfc1a) : m.rw(0xfc18);
  const bit = mode === 1 ? 2 : 1;
  if ((m.rw(0xfc26) & bit) === 0 || slot < 0) return -1;
  return 0xfbf8 + 8 * slot;
}
const padBlock = (m: Ram) => batPad(m);
const padActive = (m: Ram) => batPad(m) >= 0;

/** sub_04BAB2 (human): buttons held now */
function held(m: Ram): number {
  if (!padActive(m)) return 0;
  return m.rw(padBlock(m) + 6);
}
/** sub_04BCA4 (human): buttons pressed since the last read (the latch is consumed) plus the
 *  directions held now */
function takePressed(m: Ram): number {
  let v = 0;
  if (padActive(m)) {
    const a = padBlock(m) + 2;
    v = m.rw(a);
    m.ww(a, 0);
  }
  return (v & 0xf0) | (held(m) & 0x0f);
}
/** sub_04BB3A (human): buttons (not directions) pressed since the last read, consumed */
function takeButtons(m: Ram): number {
  if (!padActive(m)) return 0;
  const a = padBlock(m) + 2;
  const v = m.rw(a) & 0xf0;
  m.ww(a, m.rw(a) - v);
  return v;
}

// ---------------------------------------------------------------- helpers

/** sub_044ED2 / sub_044E9E: screen position of the batsman sprite's origin for animation frame `f` */
export function bodyScreen(m: Ram, x: number, y: number, f: number): [number, number] {
  const [sx, sy] = project(x, 0, y);
  const t = (m.rw(0xd2c6) !== 0 ? 0x45176 : 0x44f06) + 8 * f;
  return [w(sx + ROM.rw(t) - 0x30), w(sy + ROM.rw(t + 2) - 0x4b)];
}

/** sub_0461F6: world height whose projection at depth y lands on screen row `sy` (binary search) */
export function heightForScreenY(sy: number, y: number): number {
  let lo = -0x8000, hi = 0x7fff, mid = 0;
  for (let i = 0; i < 16; i++) {
    mid = (lo + hi) >> 1;
    if (project(0, mid, y)[1] > sy) hi = mid; else lo = mid;
  }
  return mid;
}
/** sub_0461BA: world x whose projection (height h, depth y) lands on screen column `sx` */
export function xForScreenX(sx: number, h: number, y: number): number {
  let lo = -0x8000, hi = 0x7fff, mid = 0;
  for (let i = 0; i < 16; i++) {
    mid = (lo + hi) >> 1;
    if (project(mid, h, y)[0] > sx) hi = mid; else lo = mid;
  }
  return mid;
}

/** sub_00BF1E: the striker's record and attributes */
function striker(ctx: Context) {
  return ctx.batsman;
}

// ---------------------------------------------------------------- setup

/** sub_046234 + sub_0446B2: copy the bat outlines to RAM, mirrored for a left-hander */
export function loadBatOutlines(m: Ram): void {
  for (let i = 0; i < 0x270 * 4; i += 2) m.ww(BATPOLY + i, ROM.rw(0x306 + i));
  m.ww(0xd2c6, 0);
}
export function setHandedness(m: Ram, leftHanded: boolean): void {
  if ((m.rw(0xd2c6) !== 0) === leftHanded) return;
  m.ww(0xd2c6, ~m.rw(0xd2c6)); // not.w
  for (let f = 0; f < 78; f++) {
    const wdt = spriteWidth(0x8d + f);
    const a2 = BATPOLY + 32 * f;
    for (const o of [2, 6, 0xa, 0xe, 0x12]) m.ww(a2 + o, w(-m.rw(a2 + o) + wdt));
  }
}
/** width word of a sprite frame (sprite table $66A34) */
import { MASKS } from "./maskData";
function spriteWidth(frame: number): number {
  return MASKS[frame][0];
}

/** sub_04491E: the batsman's timing skill $D320 for this delivery */
export function batsmanSkill(m: Ram, ctx: Context): void {
  let d0: number;
  const b520 = m.rw(0xb520), b526 = m.rw(0xb526);
  if ((b520 & b526) < 0) d0 = 0;
  else if (b520 < 0 && b526 >= 0) d0 = 2 - m.rw(0x8604);
  else d0 = m.rw(0x8604);
  d0 = w(muls(d0, m.rw(0xd2a4))) >> 1;
  const b = striker(ctx);
  let d1 = divs(l(w(b.s1c) << 8), b.a0e === 0 ? 1 : b.a0e).reg;
  d1 = asr(muls(d1, m.rw(0xd2a6)), 8);
  if (b520 >= 0) d1 = asr(d1, 2);
  d0 = w(d0 + d1);
  if (d0 > 0xf0) d0 = 0xf0;
  m.ww(0xd320, d0);
}

/** sub_0445CC (batting part): the batsman takes guard */
export function batsmanReset(m: Ram, ctx: Context): void {
  m.ww(0xd31e, 0); m.ww(0xd2c0, 0); m.ww(0xd2c2, 0); m.ww(0xd2ca, 0);
  m.ww(0x8606, 0); m.ww(0x8608, 0); m.ww(0xd2c8, 0); m.ww(0x860c, -1);
  m.ww(BAT, m.rw(0xd2c6) !== 0 ? -0x14 : 0x14);
  m.ww(BAT + 4, 0x370);
  m.ww(0xd2cc, 0);
  m.wl(0xd2d2, 0x48d00);
  for (let i = 0; i < 14; i++) m.ww(0xd2a4 + 2 * i, ROM.rw(0x54794 + 2 * i));
  idleInit(m);
  m.ww(BAT + 0xe, 1);
  m.ww(0x860e, 0);
  batsmanSkill(m, ctx);
  registerBatsman(m);
}

// ---------------------------------------------------------------- per tick

/** sub_04471E -> sub_044E3E: register the batsman's sprite for collisions */
export function registerBatsman(m: Ram): void {
  const f = m.rw(BAT + 0xe);
  const [x, y] = bodyScreen(m, m.rw(BAT), m.rw(BAT + 4), f);
  let frame = w(f + 0x8d);
  if ((m.rb(0xd2c6) & 0xff) !== 0) frame = w(-frame);
  registerObject(m, x, y, frame, m.rw(BAT + 4), 0xd2cc);
}

/** sub_04472A: the batsman's state machine (every second tick, or every tick while swinging) */
export function batsmanTick(m: Ram, ctx: Context): void {
  if (m.aw(0xd2c8, -1) >= 0) return;
  m.ww(0xd2c8, 1);
  if (m.rw(0xe58c) !== 0) return;
  if (m.rw(0x860e) === 0) return;
  const st = m.rw(BAT + 6);
  STATES[st](m, ctx);
}

function idleInit(m: Ram): void { // sub_0447CC
  m.ww(BAT + 6, 0); m.ww(BAT + 0x10, 5); m.ww(BAT + 0xc, 2); m.ww(BAT + 0xa, 0);
}
function readyInit(m: Ram): void { // sub_044848
  m.ww(BAT + 6, 1); m.ww(BAT + 0xc, 0);
  takePressed(m); // sub_04BC96 (human)
}

const STATES: ((m: Ram, ctx: Context) => void)[] = [
  // 0: idle stance, footwork; gets ready once the bowler is in his delivery stride
  (m) => {
    if (m.aw(BAT + 0x10, -1) < 0) {
      m.ww(BAT + 0x10, 5);
      m.ww(BAT + 0xc, (m.rw(BAT + 0xc) + 1) & 3);
    }
    m.ww(BAT + 0xe, ROM.rw(0x44840 + 2 * m.rw(BAT + 0xc)));
    if (m.rw(0x860a) === 0) return;
    footwork(m);
    if (m.rw(0xd1d4) >= 0) return;
    if (takeButtons(m) !== 0 || (m.rw(0xb520) >= 0 && m.rw(0xd278) >= 0x14)) readyInit(m);
  },
  // 1: ready; a direction (+ A or B) picks a shot
  (m, ctx) => {
    if (m.rw(BAT + 0xa) !== 3) m.aw(BAT + 0xa, 1);
    m.ww(BAT + 0xe, m.rw(BAT + 0xa) + 2);
    if (m.rw(0x860a) === 0) { takePressed(m); return; }
    const d0 = takePressed(m);
    if (d0 & 0x40) {
      m.ww(0xd2ca, 0);
      if (d0 & 0xf) startShot(m, ctx, d0);
    } else if (d0 & 0x10) {
      m.wb(0xd2ca, 0xff);
      if (d0 & 0xf) startShot(m, ctx, d0);
    } else if (d0 & 0xf) {
      const keep = m.rw(BAT + 6);
      startShot(m, ctx, d0);
      m.ww(BAT + 6, keep);
    }
  },
  // 2: the swing
  (m, ctx) => swing(m, ctx),
  // 3/4: step to the off side (towards x < 0)
  (m) => { if (m.aw(BAT + 0x10, -1) < 0) { stepFrame(m); if (m.rw(0xd2c6) === 0) stepX(m, -6); m.ww(BAT + 6, 4); m.ww(BAT + 0x10, 3); } },
  (m, ctx) => { if (m.aw(BAT + 0x10, -1) < 0) { if (m.rw(0xd2c6) !== 0) stepX(m, -6); stepDone(m, ctx); } },
  // 5/6: shuffle towards x < 0 (lining up a planned shot)
  (m) => { if (m.aw(BAT + 0x10, -1) < 0) { if (m.rw(0xd2c6) === 0) { stepFrame(m); stepX(m, -6); } m.ww(BAT + 6, 6); m.ww(BAT + 0x10, 1); } },
  (m, ctx) => { if (m.aw(BAT + 0x10, -1) < 0) { if (m.rw(0xd2c6) !== 0) stepX(m, -6); stepDone(m, ctx); } },
  // 7/8: step towards x > 0
  (m) => { if (m.aw(BAT + 0x10, -1) < 0) { stepFrame(m); if (m.rw(0xd2c6) !== 0) stepX(m, 6); m.ww(BAT + 0x10, 3); m.ww(BAT + 6, 8); } },
  (m, ctx) => { if (m.aw(BAT + 0x10, -1) < 0) { if (m.rw(0xd2c6) === 0) stepX(m, 6); stepDone(m, ctx); } },
  // 9/10: shuffle towards x > 0
  (m) => { if (m.aw(BAT + 0x10, -1) < 0) { stepFrame(m); if (m.rw(0xd2c6) !== 0) stepX(m, 6); m.ww(BAT + 0x10, 1); m.ww(BAT + 6, 0xa); } },
  (m, ctx) => { if (m.aw(BAT + 0x10, -1) < 0) { if (m.rw(0xd2c6) === 0) stepX(m, 6); stepDone(m, ctx); } },
  // 11: running (computer batsman)
  (m) => runDecision(m),
];

function stepFrame(m: Ram): void { m.ww(BAT + 0xe, 4 + m.rw(BAT + 0xa) + 2); } // sub_044BAE
function stepX(m: Ram, d: number): void { m.ww(BAT, m.rw(BAT) + asr(muls(d, m.rw(BAT + 4)), 8)); } // sub_044BBC
/** loc_044BC6 + sub_04475A: footwork finished, return to the state it started from */
function stepDone(m: Ram, ctx: Context): void {
  m.ww(BAT + 0xe, m.rw(BAT + 0xa) + 2);
  switch (m.rw(BAT + 8)) {
    case 0: idleInit(m); break;
    case 1: readyInit(m); break;
    case 2: m.ww(BAT + 6, 2); break;
    case 3: case 4: stepOff(m); break;
    case 5: case 6: shuffleOff(m); break;
    case 7: case 8: stepOn(m); break;
    case 9: case 10: shuffleOn(m); break;
    default: m.ww(BAT + 6, 0xb); runDecision(m);
  }
  void ctx;
}
function stepOff(m: Ram): void { // sub_044A56
  if (m.rw(BAT) <= -0x70) return;
  m.ww(BAT + 0x10, 3); m.ww(BAT + 8, m.rw(BAT + 6)); m.ww(BAT + 6, 3);
}
function stepOn(m: Ram): void { // sub_044B02
  if (m.rw(BAT) >= 0x70) return;
  m.ww(BAT + 0x10, 3); m.ww(BAT + 8, m.rw(BAT + 6)); m.ww(BAT + 6, 7);
}
function shuffleOff(m: Ram): void { m.ww(BAT + 0x10, 1); m.ww(BAT + 8, m.rw(BAT + 6)); m.ww(BAT + 6, 5); } // sub_044AB0
function shuffleOn(m: Ram): void { m.ww(BAT + 0x10, 1); m.ww(BAT + 8, m.rw(BAT + 6)); m.ww(BAT + 6, 9); } // sub_044B5C
function runDecision(m: Ram): void { // $0449FA
  let d0 = w(m.rw(0xdfd4) - m.rw(BAT));
  if (d0 < 0) { d0 = w(-d0); if (d0 < 0x4b) shuffleOn(m); } else if (d0 < 0x4b) shuffleOff(m);
}

/** sub_044A1E: footwork from the held pad while waiting */
function footwork(m: Ram): void {
  const d0 = held(m);
  if (d0 & 4) stepOff(m);
  else if (d0 & 8) stepOn(m);
}

/** sub_0448C0: a direction was pressed: choose and plan the shot */
function startShot(m: Ram, ctx: Context, d0: number): void {
  if (m.rw(0xbee2) !== 0 || m.rw(0x8608) !== 0) return;
  d0 &= 0xf;
  m.ww(0xd31e, d0);
  if (m.rw(0xb520) >= 0 && m.rw(0xd2c6) !== 0) d0 = (d0 & 3) | ((d0 & 8) >> 1) | ((d0 & 4) << 1);
  const shot = ROM.rw(DIR_TO_SHOT + 2 * d0);
  if (shot < 0) return; // impossible pad combinations (up+down)
  const handler = ROM.rl(SHOT_DEFS + 16 * shot);
  const long = m.rw(0xd1da) >= 0x1e0; // pitch marker: a full or a short ball
  switch (handler) {
    case 0x44bd6: planAndSwing(m, ctx, long ? 0 : 1); break;
    case 0x44bf0: planAndSwing(m, ctx, long ? 2 : 3); break;
    case 0x44be8: { // two versions of the shot: take the one that meets the ball nearer the planned height
      makePlan(m, ctx, 8, PLAN0);
      makePlan(m, ctx, 7, PLAN1);
      const e1 = Math.pow(m.rw(PLAN1 + 2) - m.rw(PLAN1 + 0x14), 2);
      const e0 = Math.pow(m.rw(PLAN0 + 2) - m.rw(PLAN0 + 0x14), 2);
      const [s, p] = e0 > e1 ? [7, PLAN1] : [8, PLAN0];
      m.wl(0xd2da, 0xffff0000 | p);
      beginSwing(m, ctx, s);
      break;
    }
    default: planAndSwing(m, ctx, shot);
  }
}

function planAndSwing(m: Ram, ctx: Context, shot: number): void { // loc_044C4E
  makePlan(m, ctx, shot, PLAN0);
  m.wl(0xd2da, 0xffff0000 | PLAN0);
  beginSwing(m, ctx, shot);
}

/** sub_044C5E */
function beginSwing(m: Ram, ctx: Context, shot: number): void {
  const def = SHOT_DEFS + 16 * shot;
  m.wl(BAT + 0x12, def);
  m.ww(BAT + 0x16, ROM.rw(def + 8));
  m.ww(BAT + 0x18, 0);
  m.ww(BAT + 6, 2);
  m.ww(BAT + 0x1a, 0);
  timingWindow(m);
  // sub_04686A: shot history
  const h = m.rw(0xdfde) !== 0 ? 0xdff0 : 0xdfe0;
  m.wl(h + 0xc, m.rl(h + 0xa)); m.wl(h + 8, m.rl(h + 6)); m.wl(h + 4, m.rl(h + 2));
  m.ww(h + 2, m.rw(h)); m.ww(h, m.rw(0xd31e));
  void ctx; // sub_04498C only acts for a computer batsman
}

/** sub_0453E6: plan a shot: where will the ball be, where must the batsman stand, when to swing */
function makePlan(m: Ram, ctx: Context, shot: number, p: number): void {
  const savedPhase = m.rw(0xe936);
  m.ww(0xe936, m.rw(0xe5a2));
  const def = SHOT_DEFS + 16 * shot;
  const simple = m.rw(0xbee2) !== 0 || m.rw(0x8608) !== 0 || m.rw(0x8606) !== 0 || m.rw(0xe936) === 0 || m.rl(0xe5b0) < 0;
  if (simple) {
    m.ww(p + 0x18, ROM.rw(def + 8));
    const d0 = ROM.rw(def + 0xc);
    m.ww(p + 0x18, m.rw(p + 0x18) + d0);
    m.ww(p + 0x16, d0);
    m.ww(p + 0x1c, 0);
  } else {
    m.ww(p + 0x1c, -1);
    const at = predictAtY(m, m.rw(BAT + 4));
    m.ww(p, at.x); m.ww(p + 2, at.z); m.ww(p + 4, at.y);
    const [sx, sy] = project(at.x, w(-at.z), at.y);
    m.ww(p + 6, sx); m.ww(p + 8, sy);
    m.ww(p + 0x18, ROM.rw(def + 8));
    const d0 = ROM.rw(def + 0xc);
    m.ww(p + 0x18, m.rw(p + 0x18) + d0);
    m.ww(p + 0x16, d0);
    const ahead = predictAfter(m, w(m.rw(0xd356) - 2 * d0));
    m.ww(p + 0x1a, ahead.y);
    const f = m.rw(p + 0x18);
    let [bx, by] = bodyScreen(m, m.rw(BAT), m.rw(BAT + 4), f);
    bx = w(bx + m.rw(BATPOLY + 32 * f + 2));
    by = w(by + m.rw(BATPOLY + 32 * f + 4));
    void bx;
    m.ww(p + 0x14, w(-heightForScreenY(by, m.rw(BAT + 4))));
    m.ww(p + 0x12, lineUpX(m, p));
    m.ww(p + 0x1e, 0);
    if (misjudged(m, ctx)) {
      let d = ROM.rw(0x4551e + 2 * m.rw(0xd31e));
      if (m.rw(0xd2c6) !== 0) d = w(-d);
      m.ww(p + 0x1e, d);
      m.ww(p + 0x12, m.rw(p + 0x12) - 4 * d);
      m.ww(p + 0x1e, 0);
      m.aw(p + 0x16, -1);
    }
  }
  m.ww(0xe936, savedPhase);
}

/** sub_04553E: batsman x that puts the bat's sweet spot under the ball on screen */
function lineUpX(m: Ram, p: number): number {
  const f = m.rw(p + 0x18);
  const t = m.rw(0xd2c6) !== 0 ? 0x45176 : 0x44f06;
  const target = w(m.rw(p + 6) - ROM.rw(t + 8 * f) + 0x30 - m.rw(BATPOLY + 32 * f + 2));
  let hi = 0x1ff, lo = -0x200, mid = 0;
  for (let i = 0; i < 10; i++) {
    mid = (lo + hi) >> 1;
    if (project(mid, 0, m.rw(BAT + 4))[0] > target) hi = mid; else lo = mid;
  }
  return mid;
}

/** sub_0455AA: does the batsman misjudge the line? (more likely early in his innings, harder levels) */
function misjudged(m: Ram, ctx: Context): boolean {
  const b = striker(ctx);
  const r = divs(l(w(b.s1c) << 8), b.a0e === 0 ? 1 : b.a0e);
  if (r.overflow) return true;
  let d0 = r.q;
  if (m.rw(0xb520) >= 0) d0 = w(d0 << 2);
  d0 = asr(muls(d0, 0x60), 8);
  let d1 = w((m.rw(0x8604) << 5) + d0);
  d1 = asr(muls(d1, ctx.dfda18), 7);
  const rnd = rngNextAt(m) & 0xff;
  return !(w(d1) < rnd);
}

/** sub_0456CE: when, in ball y, the swing has to start to meet the ball ($D324-$D328) */
function timingWindow(m: Ram): void {
  const invalid = () => { m.ww(0xd322, -1); m.ww(0xd328, m.rw(0xe5bc)); };
  if (m.rw(0xbee2) !== 0 || m.rw(0x8608) !== 0 || m.rw(0x8606) !== 0 || m.rw(0xe936) === 0 || m.rl(0xe5b0) < 0) return invalid();
  m.ww(0xd322, 0);
  m.ww(0xd324, m.rw(plan(m) + 0x1a));
  if (m.rw(0xb520) < 0) return;
  predictAtY(m, m.rw(0x8614));
  let d0 = w(m.rw(0xd356) - (2 * m.rw(plan(m) + 0x16) + 1));
  if (d0 < 0) return invalid();
  let d1 = w(m.rw(0xd2a8) - m.rw(0xd320));
  if (d1 < 0) d1 = 0;
  d1 = w((d1 & 0xffff) >>> 5) + 2;
  if (m.rw(0x8604) === 0) d1 += d1;
  d0 = w(d0 - d1);
  if (d0 >= 0) {
    const y = predictAfter(m, d0).y;
    m.ww(0xd326, y);
    if (y > m.rw(0xe5bc)) return invalid();
    m.ww(0xd328, m.rw(0xe5bc));
    return;
  }
  d0 = w(-d0);
  let v = muls(hiAfterShift(m.rl(0xe5b0), 6), d0);
  v = w(-asr(v, 6));
  m.ww(0xd326, w(v + m.rw(0xe5bc)));
  m.ww(0xd328, m.rw(0xe5bc));
}

/** sub_0457BA: before the swing: change shot, shuffle into line, or start the swing (returns true) */
function swingNow(m: Ram, ctx: Context): boolean {
  if (m.rw(0xd322) !== 0) return true;
  const d0 = takePressed(m);
  if (d0 & 0x40) m.ww(0xd2ca, 0);
  else if (d0 & 0x10) m.wb(0xd2ca, 0xff);
  const dir = d0 & 0xf;
  if (dir !== 0 && dir !== m.rw(0xd31e)) { startShot(m, ctx, dir); return false; }
  m.ww(0xd2c8, 0);
  const p = plan(m);
  const ahead = predictAfter(m, w(2 * m.rw(p + 0x16)));
  if (ahead.y < m.rw(BAT + 4)) {
    const tol = asr(muls(9, m.rw(BAT + 4)), 8);
    const d = w(m.rw(p + 0x12) - m.rw(BAT));
    if (tol > Math.abs(d)) return false;
    if (d >= 0) shuffleOn(m); else shuffleOff(m);
    return false;
  }
  m.ww(0xd2c8, 1);
  m.ww(0xd322, -1);
  m.ww(0xd2c0, -1);
  if (m.rw(0xb520) < 0) m.ww(0xd328, m.rw(0xe5bc));
  // sub_0458AE: snap into line if close enough
  const near = w(asr(muls(w(0x100 - m.rw(0xd320)), 0x30), 8) + 8);
  if (Math.abs(w(m.rw(p + 0x12) - m.rw(BAT))) <= near) m.ww(BAT, m.rw(p + 0x12));
  return true;
}

/** state 2 ($044C96): wind-up, hold, follow-through */
function swing(m: Ram, ctx: Context): void {
  const ph = m.rw(BAT + 0x1a);
  const def = m.rl(BAT + 0x12) & 0xffffff;
  if (ph === 1) {
    if (m.aw(BAT + 0x10, -1) < 0) m.aw(BAT + 0x1a, 1);
    return;
  }
  if (ph === 2) {
    m.aw(BAT + 0x18, -1);
    const f = w(m.rw(BAT + 0x18) + ROM.rw(def + 8));
    m.ww(BAT + 0x16, f); m.ww(BAT + 0xe, f);
    if (m.rw(BAT + 0x18) !== 2) return;
    if (m.rw(0xb520) < 0) m.ww(0x860a, 0);
    if (m.rw(0x860a) === 0) readyInit(m); else idleInit(m);
    return;
  }
  if (ph !== 0) return;
  if (!swingNow(m, ctx)) return;
  const step = m.rw(BAT + 0x18);
  if (step === ROM.rw(def + 0xa)) {
    if (m.rw(0xbee2) !== 0 || m.rw(0x8608) !== 0) m.ww(0x860a, 0);
    else if (m.rw(0xe936) !== 0 && m.rw(0x8606) !== 0 && m.rw(0xe5bc) >= 0x400) m.ww(0x860a, 0);
    m.aw(BAT + 0x1a, 1);
    m.ww(BAT + 0x10, 2);
    if (m.rw(0x860a) === 0 || m.rw(0x8606) !== 0) m.ww(BAT + 0x10, 0x27);
    return;
  }
  const s = w(step + 1);
  m.ww(BAT + 0x18, s);
  const f = w(s + ROM.rw(def + 8));
  m.ww(BAT + 0x16, f); m.ww(BAT + 0xe, f);
}

/** sub_045614: at the bounce, nudge the ball's rebound so it arrives at the planned bat height */
export function bounceAssist(m: Ram): void {
  if (m.rw(0xd31e) === 0) return;
  const p = plan(m);
  const dist = w(m.rw(BAT + 4) - m.rw(0xe5bc));
  if (dist < 0) return;
  let d1 = asr(m.rl(0xe5b0), 8);
  const d2w = w(m.rw(p + 0x14) << 8);
  d1 = mulu(d2w, d1);
  d1 = div32(d1, dist);
  let d2 = muls(dist, 0x3333);
  d2 = div32(d2, asr(m.rl(0xe5b0), 7));
  d2 = lsl(d2, 8);
  d1 = l(d1 + d2);
  let d0 = lsl(d1, 4);
  d0 = div32(d0, m.rl(0xe5ac));
  if (d0 < 0) d0 = l(-d0);
  if (w(d0) >= m.rw(0xd2ae) || w(d0) < m.rw(0xd2b0)) return;
  m.wl(0xe5ac, d1);
}

// ---------------------------------------------------------------- contact

/** sub_045D4E: bat outline (4 corners + the first again) on screen, scaled about its centre by skill */
function batOutline(m: Ram, ox: number, oy: number, f: number): [number, number][] {
  const a2 = BATPOLY + 32 * f + 6;
  let cx = 0, cy = 0;
  for (let i = 0; i < 4; i++) { cx = w(cx + m.rw(a2 + 4 * i)); cy = w(cy + m.rw(a2 + 4 * i + 2)); }
  cx = cx >> 2; cy = cy >> 2;
  const k = w(0x200 - m.rw(0xd320));
  const pts: [number, number][] = [];
  for (let i = 0; i < 4; i++) {
    const x = w(asr(muls(w(m.rw(a2 + 4 * i) - cx), k), 8) + cx + ox);
    const y = w(asr(muls(w(m.rw(a2 + 4 * i + 2) - cy), k), 8) + cy + oy);
    pts.push([x, y]);
  }
  pts.push(pts[0]);
  pts.forEach(([x, y], i) => { m.ww(0xd340 + 4 * i, x); m.ww(0xd342 + 4 * i, y); });
  return pts;
}

/** sub_045E6C: clip an edge to the band of rows y0..y1 around the ball; returns the x's at the band */
function clipEdge(a: [number, number], b: [number, number], y0: number, y1: number): [number, number] | null {
  let [x0, ya] = a, [x1, yb] = b;
  if (ya === yb) return null;
  if (ya > yb) [x0, ya, x1, yb] = [x1, yb, x0, ya];
  const dx = w(x1 - x0), dy = w(yb - ya);
  if (ya < y0) {
    if (yb < y0) return null;
    x0 = w(x0 + divs(muls(w(y0 - ya), dx), dy).q);
    ya = y0;
  }
  if (yb > y1) {
    if (ya > y1) return null;
    x1 = w(divs(muls(w(y1 - ya), dx), dy).q + x0);
  }
  return [x0, x1];
}

/** sub_045DB2: where does the ball (screen x, y) meet the bat? -1 miss, 0/1 outside/inside edge, 2 middle */
function batZone(m: Ram, bx: number, by: number, pts: [number, number][]): number {
  const xs: number[] = [];
  m.ww(0xd32e, -1);
  m.ww(0xd32a, by - 3);
  m.ww(0xd32c, by + 3);
  for (let i = 0; i < 4; i++) {
    const c = clipEdge(pts[i], pts[i + 1], w(by - 3), w(by + 3));
    if (c) {
      m.ww(0xd330 + 2 * xs.length, c[0]); m.ww(0xd332 + 2 * xs.length, c[1]);
      xs.push(c[0], c[1]);
      m.aw(0xd32e, 2);
    }
  }
  if (xs.length === 0) return -1;
  const lo = Math.min(...xs), hi = Math.max(...xs);
  const edge = m.rw(0xd2b2), reach = m.rw(0xd2b4);
  let d = w(bx - lo);
  if (d < 0) {
    d = w(-d);
    if (d <= edge) return 2;
    if (d >= reach) return -1;
    return 0;
  }
  d = w(bx - hi);
  if (d < 0 || d <= edge) return 2;
  if (d > reach) return -1;
  return 1;
}

/** sub_045CE8: a cut shot can be top-edged into the air (skill roll) */
function cutGoesUp(m: Ram, ctx: Context): boolean {
  if (m.rw(0xd31e) !== 9) return false;
  const b = striker(ctx);
  const r = divs(l(w(b.s1c) << 8), b.a0e === 0 ? 1 : b.a0e);
  if (r.overflow) return false;
  const d1 = asr(muls(r.q, 0x60), 8);
  if (w(d1) >= (rngNextAt(m) & 0xff)) return false;
  m.ww(0xd2c2, -1);
  return true;
}

/** sub_046EBC: pick a shot direction between two angles, aimed at the gaps in the field ($E080) */
function throughTheGap(m: Ram, a: number, b: number): number {
  let d0 = a & 0x7ff, d1 = b & 0x7ff;
  if (!(d1 > d0)) [d0, d1] = [d1, d0];
  d1 = (d1 - d0) & 0x7ff;
  d0 >>= 4;
  d1 = (d1 + 7) >> 4;
  d0 = 2 * d0;
  const F = 0xe080;
  const hiByte = (i: number) => m.rb(F + i) & 0xff;
  d1 -= 1;
  if (d1 >= 0) {
    // selection sort the sectors in the window by fielder coverage (high byte), least covered first
    let d2 = d0;
    for (let d7 = d1; d7 !== 0; d7--) {
      let d3 = d2, d4 = d3;
      let best = hiByte(d4);
      d3 = (d3 + 2) & 0xff;
      for (let k = 0; k < d7; k++) {
        if ((best << 24 >> 24) > (hiByte(d3) << 24 >> 24)) { d4 = d3; best = hiByte(d4); }
        d3 = (d3 + 2) & 0xff;
      }
      const t = m.rw(F + d2);
      m.ww(F + d2, m.rw(F + d4));
      m.ww(F + d4, t);
      d2 = (d2 + 2) & 0xff;
    }
  }
  m.wl(0xe1a0, 0xffff0000 | F);
  m.ww(0xe1a4, d0);
  m.ww(0xe1a6, d1);
  const d2 = d0;
  let pick = hiAfterShift(muls(rngNextAt(m) & 0xff, d1), 7);
  pick = ((2 * pick + d2) & 0xff);
  let ang = w(m.rw(F + pick) << 4);
  ang = (ang + (rngNextAt(m) & 0xf) - 8) & 0x7ff;
  return ang;
}

/** sub_04624C: launch the ball off the bat: power, direction angle, elevation angle */
function launch(m: Ram, power: number, dir: number, elev: number): void {
  const e = elev & 0x7ff;
  m.wl(0xe5ac, asr(muls(power, SIN(e)), 3));
  const h = w(l(2 * muls(COS(e), power)) >>> 16);
  const d = dir & 0x7ff;
  m.wl(0xe5a8, asr(muls(SIN(d), h), 2));
  m.wl(0xe5b0, asr(muls(COS(d), h), 2));
}

/** sub_0458E0: does the bat meet the ball this tick, and what happens to it. Returns true on contact. */
export function contact(m: Ram, ctx: Context): boolean {
  if (m.rw(0xe936) === 0 || m.rw(0x86b2) >= 0 || m.rw(0x860a) === 0 || m.rw(0x8606) !== 0) return false;
  if (m.rw(BAT + 6) !== 2) return false;
  const by = m.rw(BAT + 4);
  if (by < m.rw(0xe5bc)) return false;
  if (by >= w((m.rl(0xe5bc) + m.rl(0xe5b0)) >> 16)) return false; // the ball crosses the crease this tick
  const f = m.rw(BAT + 0xe);
  const [ox, oy] = bodyScreen(m, m.rw(BAT), by, f);
  const pts = batOutline(m, ox, oy, f);
  const [bx, bys] = project(m.rw(0xe5b4), w(-m.rw(0xe5b8)), m.rw(0xe5bc));
  let zone = batZone(m, bx, bys, pts);
  if (zone < 0) return false;
  m.ww(0x8606, zone + 1);
  m.ww(0xe580, 0);
  if (zone === 2) {
    const mis = m.rw(plan(m) + 0x1e);
    if (mis !== 0) {
      let d1 = mis;
      if (m.rw(0xd2c6) < 0) d1 = w(-d1);
      zone = d1 === -1 ? 0 : 1;
      m.ww(0x8606, zone + 1);
    }
  }
  if (zone !== 2 && !cutGoesUp(m, ctx)) {
    // an edge
    const left = m.rw(0xd2c6) !== 0;
    if (zone === 1) {
      if (!left) m.wl(0xe5a8, l((w(rngNextAt(m)) << 2) + 0x10000));
      else {
        let r = l(w(rngNextAt(m)) << 4);
        if (r < -0x40000) r = l(r + 0x40000);
        m.wl(0xe5a8, l(r + 0x20000));
      }
    } else {
      if (left) m.wl(0xe5a8, l(-((w(rngNextAt(m)) << 2) + 0x10000)));
      else {
        let r = l(w(rngNextAt(m)) << 4);
        if (r > 0x40000) r = l(r - 0x40000);
        m.wl(0xe5a8, l(-(r + 0x20000)));
      }
    }
    m.wl(0xe5b0, asr(m.rl(0xe5b0), 1));
    const d1 = asr(m.rl(0xe5b0), 3);
    m.wl(0xe5ac, d1);
    m.aw(0xe5ac, 4);
    if (m.rw(0xe5ac) > 0xe) m.ww(0xe5ac, 0xe);
    edgeLift(m);
    m.wl(0xe5b0, l(m.rl(0xe5b0) - d1));
    m.ww(0xe58c, 1);
    return afterContact(m);
  }
  // middled (or a cut that goes up): the shot table for this frame of the swing
  let t: number;
  if (m.rw(0xd2c4) !== 0) t = 0x1686;
  else {
    t = m.rw(0x8604) === 2 ? 0x2046 : 0xcc6;
    if (m.rw(0xd2ca) !== 0) t = 0x1686;
  }
  let a0 = t + 32 * m.rw(BAT + 0xe);
  if ((ROM.rw(a0) | ROM.rw(a0 + 2)) === 0) return false;
  if (m.rw(0xd38a) === 2) {
    if (m.rw(0xe5a2) < 2) m.ww(0xe5a2, 2);
    m.wl(0xe5a8, asr(m.rl(0xe5a8), 3));
    m.wl(0xe5ac, asr(m.rl(0xe5ac), 4));
    m.wl(0xe5b0, l(-asr(m.rl(0xe5b0), 2)));
    return afterContact(m);
  }
  // timing: early or late against the window interpolates towards the next/previous frame's elevation
  let elev = ROM.rw(a0 + 8);
  if (m.rw(0xb520) >= 0) {
    const d0 = w(m.rw(0xd328) - m.rw(0xd326));
    const d1 = w(m.rw(0xd324) - m.rw(0xd326));
    if (d0 >= 0 && d0 < d1) {
      const third = divs(w(d1), 3).q;
      let d3 = w(d0 - third);
      const k = m.rw(0xd2aa);
      if (d3 < 0) {
        d3 = w(-d3);
        if (k !== 0) elev = w(divs(muls(d3, k), third).q + ROM.rw(a0 + 8));
        else {
          const d4 = w(ROM.rw(a0 + 8) - ROM.rw(a0 + 0x20 + 8));
          elev = w(divs(muls(d3, d4), third).q + ROM.rw(a0 + 8));
          a0 += 0x20;
        }
      } else {
        d3 = w(d3 - third);
        if (d3 >= 0) {
          if (k !== 0) elev = w(-divs(muls(d3, k), third).q + ROM.rw(a0 + 8));
          else {
            const d4 = w(ROM.rw(a0 + 8) - ROM.rw(a0 - 0x20 + 8));
            elev = w(divs(muls(d3, d4), third).q + ROM.rw(a0 + 8));
            a0 -= 0x20;
          }
        }
      }
    }
  }
  let a = ROM.rw(a0), b = ROM.rw(a0 + 2);
  if (m.rw(0xd2c6) !== 0) { a = w(-a); b = w(-b); }
  const dir = throughTheGap(m, a, b);
  let pw = rngNextAt(m) & 0x7f;
  let vy = m.rw(0xe5b0);
  if (vy < 0) vy = w(-vy);
  pw = w(pw + vy);
  const lo = ROM.rw(a0 + 0xa), hi = ROM.rw(a0 + 0xc);
  pw = w(asr(muls(pw, w(hi - lo)), 8) + lo);
  launch(m, pw, dir, elev);
  m.ww(0x860c, 4);
  m.ww(0xe58c, m.rw(0xd2b8));
  return afterContact(m);
}

function afterContact(m: Ram): true {
  if (m.rw(0xe5a2) < 2) m.ww(0xe5a2, 2);
  m.ww(0xc736, m.rw(0xe5b4));
  m.ww(0xc738, m.rw(0xe5bc));
  m.ww(0x860a, 0);
  return true;
}

export { deadBall };
