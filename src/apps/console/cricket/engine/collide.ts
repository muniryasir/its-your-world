// Ball-vs-object collisions (stumps, batsman's pads, close fielders).
// Each tick the ball records its y before/after the step ($E594/$E596) and its screen position and
// sprite frame (sub_048910). Objects register a box (screen x, screen y, sprite frame, world y) in a
// list; sub_048C26 tests the ball against every object whose y it crossed, using 1-bit sprite masks
// (sub_04912A), and calls the object's handler on a hit.

import { Ram, ROM, SIN, COS } from "./mem";
import { w, l, muls, asr } from "./m68k";
import { projectCam } from "./project";
import { MASKS } from "./maskData";
import { predictAtY } from "./ball";
import { rngNextAt } from "./rngAt";

/** sub_0476D6: is a close fielder holding the ball (fielder struct +$11A bit 0)? */
export function fielderHasBall(m: Ram): boolean {
  let d0 = m.rw((m.rl(0xe1b4) & 0xffff) + 0x11a);
  const extra = m.rw(0xbe1a);
  if (extra !== 0) {
    d0 |= m.rw((m.rl(0xe1b8) & 0xffff) + 0x11a);
    if (extra !== 1) d0 |= m.rw((m.rl(0xe1bc) & 0xffff) + 0x11a);
  }
  return (d0 & 1) !== 0;
}

/** sub_048A44: ball sprite frame and centring offset from its projected size */
function ballSprite(m: Ram): [number, number, number] {
  const z = w(m.rw(0xe5bc) - 0x900);
  const a = projectCam(m, 0, 0, z)[0];
  const b = projectCam(m, 8, 0, z)[0];
  let d2 = w(b - a);
  if (d2 > 0xf) d2 = 0xf;
  const t = 0x48a9c + 4 * d2;
  const frame = ROM.rw(t), half = ROM.rw(t + 2) >> 1;
  return [w(-half), w(-half), w(frame + 0x182)];
}

/** sub_048910 (batting view part): ball crossing range and screen box for this tick */
export function ballTrack(m: Ram): void {
  if (m.rw(0xe936) === 0) return;
  if (m.rw(0x86b2) >= 0) return; // fielding view (later phases)
  if (fielderHasBall(m)) return;
  m.ww(0xe594, m.rw(0xe5bc));
  m.ww(0xe596, (m.rl(0xe5bc) + m.rl(0xe5b0)) >> 16);
  const [ox, oy, frame] = ballSprite(m);
  const [sx, sy] = projectCam(m, m.rw(0xe5b4), w(-m.rw(0xe5b8)), m.rw(0xe5bc));
  m.ww(0xe582, sx);
  m.ww(0xe584, sy);
  for (const a of [0xe586, 0xe58e]) {
    m.ww(a, sx + ox);
    m.ww(a + 2, sy + oy);
    m.ww(a + 4, frame);
  }
}

/** sub_048B98: empty both object lists ($E5CC, $E74E); $E5C8 = list being filled, $E5C4 = list to test */
export function resetObjects(m: Ram): void {
  m.wl(0xe5c8, 0xffffe5cc);
  m.ww(0xe5cc, -1);
  m.wl(0xe5c4, 0xffffe74e);
  m.ww(0xe74e, -1);
}

// ---------------------------------------------------------------- sprite masks

export interface Mask { w: number; h: number; stride: number; bits: Uint8Array }
const maskCache = new Map<number, Mask>();

/** collision mask of a sprite frame; a negative frame is the mirrored sprite (sub_04976A) */
export function getMask(frame: number): Mask {
  const hit = maskCache.get(frame);
  if (hit) return hit;
  const src = MASKS[Math.abs(frame)];
  if (!src) throw new Error(`no collision mask for sprite frame ${frame}`);
  const [mw, mh, stride, b64] = src;
  const raw = decode(b64);
  let bits = raw;
  if (frame < 0) {
    bits = new Uint8Array(raw.length);
    for (let y = 0; y < mh; y++)
      for (let x = 0; x < stride * 8; x++) {
        const sx = mw - 1 - x;
        if (sx >= 0 && raw[y * stride + (sx >> 3)] & (0x80 >> (sx & 7))) bits[y * stride + (x >> 3)] |= 0x80 >> (x & 7);
      }
  }
  const mk = { w: mw, h: mh, stride, bits };
  maskCache.set(frame, mk);
  return mk;
}
function decode(b64: string): Uint8Array {
  if (typeof atob === "function") return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new Uint8Array((globalThis as any).Buffer.from(b64, "base64"));
}
const bit = (mk: Mask, x: number, y: number): boolean =>
  x >= 0 && y >= 0 && x < mk.stride * 8 && y < mk.h && (mk.bits[y * mk.stride + (x >> 3)] & (0x80 >> (x & 7))) !== 0;

/** sub_04912A: do two sprites (top-left x, y, frame) overlap on a set pixel? */
export function spritesOverlap(ax: number, ay: number, af: number, bx: number, by: number, bf: number): boolean {
  if (bx > ax) [ax, ay, af, bx, by, bf] = [bx, by, bf, ax, ay, af];
  const dx = w(ax - bx), dy = w(ay - by); // A is right of (or level with) B
  const A = getMask(af), B = getMask(bf);
  if (dx >= B.w) return false;
  if (dy < 0) { if (-dy >= A.h) return false; } else if (dy >= B.h) return false;
  for (let y = 0; y < B.h; y++)
    for (let x = dx; x < B.stride * 8; x++)
      if (bit(B, x, y) && bit(A, x - dx, y - dy)) return true;
  return false;
}

/** sub_04909E: is screen point (px, py) on a set pixel of the sprite at (sx, sy)? */
function pointOnSprite(px: number, py: number, sx: number, sy: number, frame: number): boolean {
  const x = w(px - sx), y = w(py - sy);
  if (x < 0 || y < 0) return false;
  const mk = getMask(frame);
  if (x >= mk.w || y >= mk.h) return false;
  return bit(mk, x, y);
}

// ---------------------------------------------------------------- object lists

/** sub_048BBA: register an object for this tick's collision test. a1 = the object's struct in RAM:
 *  +0 flags (bit 0 crossed, bit 1 hit), +2/+4 ball screen position at the test, +6 handler, +$A entry. */
export function registerObject(m: Ram, x: number, y: number, frame: number, worldY: number, a1: number): void {
  if ((m.rl(0xe5c8) >>> 24) === 0) return;
  if (m.rw(0xe5a2) === 0) return;
  const list = m.rl(0xe5c8) & 0xffff;
  const n = m.aw(list, 1);
  const e = list + 2 + 12 * n;
  m.ww(e, x); m.ww(e + 2, y); m.ww(e + 4, frame); m.ww(e + 6, worldY);
  m.wl(e + 8, 0xffff0000 | a1);
  m.wl(a1 + 0xa, 0xffff0000 | e);
}

/** sub_048BF8: the list filled this tick becomes the one tested */
export function swapObjectLists(m: Ram): void {
  if ((m.rl(0xe5c8) >>> 24) === 0 || (m.rl(0xe5c4) >>> 24) === 0) return;
  const a0 = m.rl(0xe5c8), a1 = m.rl(0xe5c4);
  m.wl(0xe5c4, a0);
  m.wl(0xe5c8, a1);
  m.ww(a1 & 0xffff, -1);
}

export type Handler = (m: Ram, entry: number, obj: number) => void;

/** sub_048C26: test the ball against every object whose y it crossed this tick */
export function testObjects(m: Ram, handlers: Record<number, Handler>): void {
  if ((m.rl(0xe5c4) >>> 24) === 0) return;
  let a0 = m.rl(0xe5c4) & 0xffff;
  const n = m.rw(a0); a0 += 2;
  if (n < 0) return;
  const y0 = m.rw(0xe594), y1 = m.rw(0xe596);
  const forward = !(y0 > y1);
  for (let i = 0; i <= n; i++, a0 += 12) {
    const oy = m.rw(a0 + 6);
    if (forward ? (oy < y0 || oy >= y1) : (oy < y1 || oy >= y0)) continue;
    const obj = m.rl(a0 + 8) & 0xffff;
    m.ww(obj, m.rw(obj) | 1);
    m.ww(obj + 2, m.rw(0xe582));
    m.ww(obj + 4, m.rw(0xe584));
    if (!spritesOverlap(m.rw(0xe58e), m.rw(0xe590), m.rw(0xe592), m.rw(a0), m.rw(a0 + 2), m.rw(a0 + 4))) continue;
    m.ww(obj, m.rw(obj) | 2);
    if (!forward) m.ww(0x860a, 0);
    const h = handlers[m.rl(obj + 6) & 0xffffff];
    if (!h) throw new Error(`no collision handler $${(m.rl(obj + 6) & 0xffffff).toString(16)}`);
    h(m, a0, obj);
  }
}

// ---------------------------------------------------------------- handlers

/** sub_048DA0: bounce the ball off a sprite, using the mask around the contact point as the surface */
export function deflect(m: Ram, entry: number, obj: number): void {
  if (m.rw(0xe8d2) !== 0) return;
  m.aw(0xe8d2, -1);
  let d5 = 0, d6 = 0, d7 = 0;
  const px = m.rw(obj + 2), py = m.rw(obj + 4);
  const sx = m.rw(entry), sy = m.rw(entry + 2), f = m.rw(entry + 4);
  const on = (x: number, y: number) => pointOnSprite(x, y, sx, sy, f);
  if (on(px, py - 1)) { d5 |= 1; d7 += 2; } else if (on(px, py - 2)) { d5 |= 1; d7 += 1; }
  if (on(px, py + 1)) { d5 |= 1; d7 -= 2; } else if (on(px, py + 2)) { d5 |= 1; d7 -= 1; }
  if (on(px - 1, py)) { d5 |= 2; d6 -= 1; } else if (on(px - 2, py)) { d5 |= 2; d6 -= 2; }
  if (on(px + 1, py)) { d5 |= 2; d6 += 1; } else if (on(px + 2, py)) { d5 |= 2; d6 += 2; }
  if ((d6 | d7) === 0) {
    // loc_04907A: no surface found: drop the ball dead
    if (m.rw(0xe5a2) < 2) m.ww(0xe5a2, 2);
    deadBall(m);
    return;
  }
  m.ww(0xe8d0, -1);
  const atMax = (v: number) => { if (v > m.rw(0xe8d0)) m.ww(0xe8d0, v); }; // sub_049034
  if (on(px, py)) atMax(2);
  // sub_048F24: vertical part of the surface
  const vy = m.rl(0xe5b0);
  switch (d7 & 7) {
    case 1: m.wl(0xe5ac, m.rl(0xe5ac) - asr(vy, 4)); atMax(0); break;
    case 2: m.wl(0xe5ac, m.rl(0xe5ac) - asr(vy, 3)); atMax(1); break;
    case 6: m.wl(0xe5ac, m.rl(0xe5ac) + asr(vy, 4)); atMax(0); break;
    case 7: m.wl(0xe5ac, m.rl(0xe5ac) + asr(vy, 3)); atMax(1); break;
    default: m.wl(0xe5ac, asr(m.rl(0xe5ac), 3)); atMax(2);
  }
  // sub_048FAC: horizontal part
  switch (d6 & 7) {
    case 1: m.wl(0xe5a8, m.rl(0xe5a8) - asr(vy, 4)); atMax(0); break;
    case 2: m.wl(0xe5a8, m.rl(0xe5a8) - asr(vy, 3)); atMax(1); break;
    case 6: m.wl(0xe5a8, m.rl(0xe5a8) + asr(vy, 4)); atMax(0); break;
    case 7: m.wl(0xe5a8, m.rl(0xe5a8) + asr(vy, 3)); atMax(1); break;
    default: m.wl(0xe5a8, asr(m.rl(0xe5a8), 3)); atMax(2);
  }
  // sub_049044: along the pitch
  const k = m.rw(0xe8d0);
  if (k === 0) m.wl(0xe5b0, asr(m.rl(0xe5b0), 1));
  else if (k === 1) m.wl(0xe5b0, asr(m.rl(0xe5b0), 2));
  else if (k > 1) m.wl(0xe5b0, l(-asr(m.rl(0xe5b0), 3)));
  if (m.rw(0xe5a2) < 2) m.ww(0xe5a2, 2);
}

/** loc_04907A tail and the same code in sub_0458E0: kill the ball's pace (deflected straight down) */
export function deadBall(m: Ram): void {
  m.wl(0xe5a8, asr(m.rl(0xe5a8), 3));
  m.wl(0xe5ac, asr(m.rl(0xe5ac), 4));
  m.wl(0xe5b0, l(-asr(m.rl(0xe5b0), 4)));
}

/** sub_04844E: a wicket is given (umpire animation, bowler stops) */
function wicketGiven(m: Ram): void {
  m.ww(0xe578, 1); m.ww(0xe57e, 0); m.ww(0xe57c, 3); m.ww(0xe57a, 2);
  if (m.rw(0xcce0) === 0) m.ww(0xd28a, 2); // sub_044226
}

/** $048D00: the ball hit the batsman (body or pads). LBW check, then deflection. */
export function hitBatsman(m: Ram, entry: number, obj: number): void {
  if (m.rw(0xe5a2) < 2) m.ww(0xe5a2, 2);
  if (m.rw(0x8606) !== 0 || m.rw(0x8608) !== 0) return;
  m.ww(0x8608, -1);
  let lbw = false;
  if (m.rw(0xcce0) === 0 && m.rw(0xbe7e) !== 0) {
    let inLine: boolean;
    if (m.rw(0xd2c6) !== 0) inLine = m.rw(0xe580) === 0 || m.rw(0xe598) <= 0x10;
    else inLine = m.rw(0xe598) >= -0x12;
    if (inLine) {
      const p = predictAtY(m, 0x400); // where would it have reached the stumps?
      lbw = p.x >= -0x12 && p.x <= 0x10 && p.z <= 0x52;
    }
  }
  if (lbw) {
    m.ww(0xbee0, 1);
    m.ww(0xbee2, 6);
    wicketGiven(m);
    deflect(m, entry, obj);
    return;
  }
  deflect(m, entry, obj);
  if (m.rw(0x860c) < 0) m.ww(0x860c, 8);
}

/** $00F256: the ball hit the stumps. Which stump (from the screen x) and the deflection. */
export function hitStumps(m: Ram): void {
  if (m.rw(0x86b2) >= 0) return;
  m.ww(0xe5a2, 2);
  const d1 = w(m.rw(0xbf2a) - 0x99);
  const d0 = d1 < 3 ? 0 : d1 < 6 ? 1 : d1 < 8 ? 2 : d1 < 0xb ? 3 : 4;
  m.ww(0xbf26, d0);
  const ang = ROM.rw(0xf322 + 8 * d0 + 6);
  const s = SIN(ang), c = COS(ang);
  let ax = m.rw(0xe5a8); if (ax < 0) ax = w(-ax);
  const vyw = m.rw(0xe5b0);
  let d4 = l(muls(c, vyw) + muls(s, ax));
  let d3 = l(muls(c, ax) - muls(s, vyw));
  d3 = asr(l(-d3), 1);
  d3 = asr(l(d3 + m.rl(0xe5a8)), 1);
  m.wl(0xe5a8, d3);
  d4 = l(-(d4 + d4));
  d4 = asr(l(d4 + m.rl(0xe5b0)), 1);
  m.wl(0xe5b0, d4);
  m.aw(0xe5ac, m.rw(0xe5ac) < 0 ? -1 : 1);
}

/** sub_00EFD0: after a stumps hit, give the wicket (bowled) and knock the stumps/bails */
export function stumpsAftermath(m: Ram): void {
  if (m.rw(0xe5a2) === 0 || m.rw(0xbf24) !== 0 || (m.rb(0xbf29) & 0xff) !== 3) return;
  if (m.rw(0xcce0) === 0 && (m.rw(0xbee2) === 0 || m.rw(0xbee2) === 6)) {
    m.ww(0xbee0, 1);
    m.ww(0xbee2, 3);
    m.ww(0xbf28, 0);
    wicketGiven(m);
  }
  m.ww(0x8606, 0);
  const row = 0xf322 + 8 * m.rw(0xbf26);
  m.ww(0xbf24, ROM.rw(row));
  if (ROM.rw(row + 2) !== 0) bail(m, 0xbf36, -0xe, 0, -1, -1);
  if (ROM.rw(row + 4) !== 0) bail(m, 0xbf56, 0xe, 0, 1, 1);
}

/** sub_00F082 / sub_00F0EA: launch a bail (display only, but it draws random numbers) */
function bail(m: Ram, a0: number, x: number, _: number, vx: number, sign: number): void {
  m.ww(a0, -1);
  m.ww(a0 + 2, x);
  m.ww(a0 + 6, 0x50);
  m.ww(a0 + 0xa, 0x400);
  m.wl(a0 + 0x10, vx << 16);
  const r1 = rngNextAt(m) & 1;
  m.ww(a0 + 0x10, m.rw(a0 + 0x10) + sign * r1);
  m.wl(a0 + 0x14, 0x40000);
  m.ww(a0 + 0x14, m.rw(a0 + 0x14) + (rngNextAt(m) & 1));
  m.wl(a0 + 0x18, 0xa0000);
  m.ww(a0 + 0x18, m.rw(a0 + 0x18) + (rngNextAt(m) & 3) - 4);
  m.ww(a0 + 0xe, 0);
}

/** stumps object registration (part of sub_00EED6) */
export function registerStumps(m: Ram): void {
  const [x, y] = projectCam(m, 0, 0, 0x400);
  const st = m.rw(0xbf24);
  registerObject(m, w(x - ROM.rw(0x537d4 + 4 * st)), w(y - ROM.rw(0x537d6 + 4 * st)), w(st + 0x1a5), 0x400, 0xbf28);
}
