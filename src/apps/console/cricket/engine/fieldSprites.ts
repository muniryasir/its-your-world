// The fielding view's display objects: what the original puts on the screen each step and where.
// Ported from the routines that fill its sprite object records (sub_00A062 and direct writes):
//   sub_034DA4  both sets of stumps and the umpire        ($91CE, $91EA, $9206)
//   loc_034E60  the ball on the ground and in the air     ($9062, $907E)   (from sub_048910)
//   sub_035F44  the fielders, your fielder's ring, the arrow towards the ball or the stumps
//                                                         ($909A + $1C * i, $92CA, $92E6)
//   sub_0364BC  your target marker                        ($9302)
//   sub_039260 / sub_039BC2  the running batsmen          ($9222, $923E)
//   sub_039E68 / sub_039EDA  their icons on the pitch overlay at the right ($925A, $9276)
//
// Object record (stride $1C): +$0A screen x, +$0C screen y (the frame's top left), +$0E sprite frame
// (index into the ROM's sprite table $66A34), +$10 palette line (+4 = high priority), +$12 depth
// (larger = further back), +$14 on screen (byte, $FF), +$15 mirrored (byte, $FF).
// The engine writes them into RAM like the original, so the fidelity traces check them; the page
// draws from them (practice.ts fieldObjects()).

import { Ram, ROM, SIN, COS } from "./mem";
import { w, l, muls, divs } from "./m68k";
import { angleTo } from "./trig";
import { fielders, ptr, REC, fieldScreen, octant } from "./fieldlib";
import { FIELD_FRAME_W } from "./fieldData";

export const OBJ = {
  shadow: 0x9062, ball: 0x907e, fielder0: 0x909a, stumps1: 0x91ce, stumps2: 0x91ea, umpire: 0x9206,
  runner1: 0x9222, runner2: 0x923e, icon1: 0x925a, icon2: 0x9276, you: 0x92ca, arrow: 0x92e6, marker: 0x9302,
} as const;
export const OBJ_STRIDE = 0x1c;

/** sub_00A062: place an object (no collision list here) */
function place(m: Ram, a: number, x: number, y: number, frame: number, depth: number, pal: number, flip = 0): void {
  m.ww(a + 0xa, x); m.ww(a + 0xc, y);
  if (m.rw(a) !== 6) m.ww(a + 0xe, frame);
  m.ww(a + 0x12, depth); m.ww(a + 0x10, pal); m.wb(a + 0x15, flip);
}
const show = (m: Ram, a: number) => m.wb(a + 0x14, -1);
const hide = (m: Ram, a: number) => m.wb(a + 0x14, 0);
/** sub_00C8BC: a limited-overs match (coloured clothing, white ball) */
const coloured = (m: Ram) => m.rw(0xbe68 + 0x1a) !== 0;

/** sub_034DA4: the stumps at both ends and the umpire at the bowler's end */
export function stumpsAndUmpire(m: Ram): void {
  for (const [y, a] of [[0x400, OBJ.stumps1], [w(0xfc00), OBJ.stumps2]] as const) {
    const [x0, y0] = fieldScreen(m, 0, 0, y);
    place(m, a, w(x0 - 4), w(y0 - 0x10), 0x31e, y, 3);
    show(m, a);
  }
  const uy = w(ROM.rw(0x547b0) - 0x60);
  const [x0, y0] = fieldScreen(m, m.rw(0xe574), 0, uy);
  place(m, OBJ.umpire, w(x0 - 9), w(y0 - 0x27), 0x1bd, uy, 3);
  show(m, OBJ.umpire);
}

/** loc_034E60 (after the rope test, which ballView does): the ball's shadow on the ground and the
 *  ball itself. sub_034F86 works out a size from the height, then always uses size 1. */
export function ballSprites(m: Ram, sx: number, sy: number): void {
  const x = m.rw(0xe5b4), y = m.rw(0xe5bc);
  const [gx, gy] = fieldScreen(m, x, 0, y);
  m.ww(OBJ.shadow + 0xa, w(gx - 3)); m.ww(OBJ.shadow + 0xc, gy); m.ww(OBJ.shadow + 0xe, 0x193);
  m.ww(OBJ.shadow + 0x10, 3); m.ww(OBJ.shadow + 0x12, 0x7fff); m.ww(OBJ.shadow + 4, -1);
  show(m, OBJ.shadow);
  const frame = coloured(m) ? 0x183 - 0x10 : 0x183;
  m.ww(OBJ.ball + 0xa, w(sx - 3)); m.ww(OBJ.ball + 0xc, w(sy - 3)); m.ww(OBJ.ball + 0xe, frame);
  m.ww(OBJ.ball + 0x10, 3); m.ww(OBJ.ball + 0x12, y); m.ww(OBJ.ball + 4, -1);
  show(m, OBJ.ball);
}

/** sub_0486A4 / sub_048910: the ball is dead or held: off the screen (unless $E982) */
export function hideBall(m: Ram): void {
  if (m.rw(0xe982) !== 0) return;
  hide(m, OBJ.shadow); hide(m, OBJ.ball);
}

/** sub_035F44 (display part; sub_0364BC runs in the middle of it): every fielder's frame from his
 *  facing (8 directions, 5 drawn and 3 mirrored) and animation frame, then your fielder's ring and
 *  the arrow */
export function fielderSprites(m: Ram, marker: () => void): void {
  const base = fielders(m);
  for (let i = 0; i < 11; i++) {
    const a0 = base + i * REC, a1 = OBJ.fielder0 + i * OBJ_STRIDE;
    let [x, y] = fieldScreen(m, m.rw(a0 + 0x3c), w(-m.rw(a0 + 0x40)), m.rw(a0 + 0x44));
    let dir = octant(m, a0), flip = 0;
    if (dir > 4) { dir = 8 - dir; flip = -1; }
    const k = w(dir * 37 + m.rw(a0 + 0x5e));
    const frame = w(k + 0x1be);
    const dx = ROM.rb(0x361c8 + 2 * k), dy = ROM.rb(0x361c9 + 2 * k);
    x = w(x - (flip ? w(frameWidth(frame) - dx) : dx));
    y = w(y - dy);
    m.wb(a1 + 0x14, -1);
    m.ww(a1 + 0xa, x); m.ww(a1 + 0xc, y); m.ww(a1 + 0xe, frame);
    m.ww(a1 + 0x12, m.rw(a0 + 0x44)); m.wb(a1 + 0x15, flip); m.ww(a1 + 0x10, 2);
  }
  // your fielder's ring
  if (m.rw(0x8602) !== 0) {
    const a0 = ptr(m, 0xc730);
    const [x, y] = fieldScreen(m, m.rw(a0 + 0x3c), w(-m.rw(a0 + 0x40)), m.rw(a0 + 0x44));
    m.ww(OBJ.you + 0xa, w(x - 0x14)); m.ww(OBJ.you + 0xc, w(y - 8)); m.ww(OBJ.you + 0xe, 0x321);
    m.ww(OBJ.you + 0x10, 3); m.ww(OBJ.you + 0x12, 0x7fff);
    show(m, OBJ.you);
  } else hide(m, OBJ.you);
  marker();
  arrow(m);
}

/** the end of sub_035F44: an arrow next to your fielder pointing at the ball (or at your target
 *  marker), or, once he has it, at the stumps he is nearer to (hidden when that is close by) */
function arrow(m: Ram): void {
  if (m.rw(0x8602) === 0) { hide(m, OBJ.arrow); return; }
  let tx: number, ty: number;
  const st = m.rw(0xc6d0);
  if (st === 0) {
    if (m.rw(0xc730) === 0) return; // tst.w on the pointer's upper word
    tx = m.rw(0xe5b4); ty = m.rw(0xe5bc);
    if (m.rw(0xc784) !== 0) { tx = m.rw(0xc786); ty = m.rw(0xc788); }
  } else if (st === 2) {
    const y = m.rw(ptr(m, 0xc730) + 0x44);
    let d0 = w(0x400 - y); if (d0 < 0) d0 = w(-d0);
    let d1 = w(0xfc00 - y); if (d1 < 0) d1 = w(-d1);
    tx = 0; ty = d1 < d0 ? w(0xfc00) : 0x400;
  } else { hide(m, OBJ.arrow); return; }
  const a0 = ptr(m, 0xc730);
  const fx = m.rw(a0 + 0x3c), fy = m.rw(a0 + 0x44);
  const [sx, sy] = fieldScreen(m, tx, 0, ty);
  if (sx >= 0x10 && sx <= 0x130 && sy >= 0x10 && sy <= 0xd0) {
    const dx = w((tx >> 1) - (fx >> 1)), dy = w((ty >> 1) - (fy >> 1));
    if (l(muls(dx, dx) + muls(dy, dy)) <= 0x31000) { hide(m, OBJ.arrow); return; }
  }
  const ang = angleTo(tx, ty, fx, fy);
  const dir = ((w(0x240 - ang) & 0xffff) >>> 7) & 15;
  const ax = w(w(l(l(muls(COS(ang), 0xa0) * 2) >>> 16)) + fx);
  const ay = w(w(l(l(muls(SIN(ang), 0xc0) * 2) >>> 16)) + fy);
  const [x, y] = fieldScreen(m, ax, 0, ay);
  place(m, OBJ.arrow, w(x - 9), w(y - 5), w(dir + 0x30e), 0x7fff, 0, 0);
  show(m, OBJ.arrow);
}

/** sub_0364BC's display part: your target marker at its eased position */
export function markerSprite(m: Ram): void {
  const [x, y] = fieldScreen(m, m.rw(0xc792), 0, m.rw(0xc794));
  place(m, OBJ.marker, w(x - 0x26), w(y - 0xf), 0x31f, 0x7fff, 0, 0);
  show(m, OBJ.marker);
}
export const hideMarker = (m: Ram): void => hide(m, OBJ.marker);

/** sub_039BC2: a running batsman's frame and screen position. Returns d6 as it leaves it. */
function runner(m: Ram, a0: number): { x: number; y: number; frame: number; depth: number; d6: number } {
  let [x, y] = fieldScreen(m, m.rw(a0), 0, w(l(muls(m.rw(a0 + 4), 0x22)) >> 5));
  const depth = w(l(muls(m.rw(a0 + 4), 0x22)) >> 5);
  let d2: number;
  if (m.rw(a0 + 0xe) >= 4) d2 = w(m.rw(a0 + 0xe) + 4);
  else d2 = ((l(m.rl(a0 + 0xe) << 1) >>> 16) & 7);
  if (m.rw(a0 + 8) === 0) d2 = w(d2 + 0x10);
  const dx = ROM.rb(0x39c22 + 2 * d2), dy = ROM.rb(0x39c23 + 2 * d2);
  x = w(x - dx); y = w(y - dy);
  let frame = w(d2 + 0x277);
  if (!coloured(m)) frame = w(frame + 0x20);
  return { x, y, frame, depth, d6: dy };
}

/** sub_039260 (display): both running batsmen, then their icons on the overlay. Returns the d6 the
 *  second runner leaves (see FieldView: sub_037BB6 divides by it). */
export function runnerSprites(m: Ram): number {
  let d6 = 0;
  for (const [src, a] of [[0xc800, OBJ.runner1], [0xc81e, OBJ.runner2]] as const) {
    const r = runner(m, src);
    place(m, a, r.x, r.y, r.frame, r.depth, 1, 0);
    show(m, a);
    d6 = r.d6;
  }
  overlayIcons(m);
  return d6;
}

/** sub_039E68 / sub_039EDA: the runners' icons on the pitch overlay (while it is shown, $C7F6) */
function overlayIcons(m: Ram): void {
  if (m.rw(0xc7f6) === 0) { hide(m, OBJ.icon1); hide(m, OBJ.icon2); return; }
  for (const [src, a] of [[0xc800, OBJ.icon1], [0xc81e, OBJ.icon2]] as const) {
    let x = w(m.rw(src) >> 3);
    let y = divs(muls(m.rw(src + 4), 0x36), w(0xfc90)).q;
    let frame = m.rw(src + 0xe);
    if (m.rw(src + 8) === 0) { frame = w(frame + 0xc); y = w(y - 3); }
    x = w(x - 8 + 0x108); y = w(y - 9 + 0x78); frame = w(frame + 0x2b7);
    place(m, a, x, y, frame, w(0x8001), 7, 0);
    show(m, a);
  }
}

/** the set-up allocates the view's 40 objects ($009B62..: type 1, nothing on screen yet) */
export function allocObjects(m: Ram): void {
  for (let i = 0; i < 40; i++) {
    const a = OBJ.shadow + i * OBJ_STRIDE;
    m.ww(a, 1); m.wb(a + 0x14, 0); m.wb(a + 0x15, 0);
    m.ww(a + 4, -1); m.ww(a + 0xe, -1); m.ww(a + 0x16, -1);
  }
}

/** sub_039C62 (the overlay goes up at the set-up) / sub_039CA6 (it comes down) */
export function overlay(m: Ram, on: boolean): void {
  if (on) { m.ww(0xc7f6, -1); return; }
  if (m.rw(0xc7f6) !== 0) { hide(m, OBJ.icon1); hide(m, OBJ.icon2); }
  m.ww(0xc7f6, 0);
}

function frameWidth(frame: number): number {
  const v = FIELD_FRAME_W[frame];
  if (v === undefined) throw new Error(`no width for sprite frame ${frame}`);
  return v;
}

/** one object to draw (for the page) */
export interface FieldObject { frame: number; x: number; y: number; flip: boolean; pal: number; depth: number; front: boolean }

/** the objects on screen, back to front (the original's sprite order: by depth, high-priority last) */
export function fieldObjects(m: Ram): FieldObject[] {
  const out: FieldObject[] = [];
  const add = (a: number) => {
    if (m.rb(a + 0x14) === 0) return;
    const frame = m.rw(a + 0xe);
    if (frame < 0) return;
    const pal = m.rw(a + 0x10);
    out.push({ frame, x: m.rw(a + 0xa), y: m.rw(a + 0xc), flip: m.rb(a + 0x15) !== 0, pal: pal & 3, depth: m.rw(a + 0x12), front: (pal & 4) !== 0 });
  };
  add(OBJ.shadow); add(OBJ.ball);
  for (let i = 0; i < 11; i++) add(OBJ.fielder0 + i * OBJ_STRIDE);
  for (const a of [OBJ.stumps1, OBJ.stumps2, OBJ.umpire, OBJ.runner1, OBJ.runner2, OBJ.icon1, OBJ.icon2, OBJ.you, OBJ.arrow, OBJ.marker]) add(a);
  return out.sort((a, b) => Number(a.front) - Number(b.front) || b.depth - a.depth);
}
