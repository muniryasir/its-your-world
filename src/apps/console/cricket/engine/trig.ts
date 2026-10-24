// sub_049C78 (integer square root), sub_049C3E (normalise), sub_049BA4 / sub_049B72 (arctangent).
// Angles use the game's 2048 steps per circle; 0 points along +y (down the pitch).

import { ROM } from "./mem";
import { w, l, muls, mulu, divs } from "./m68k";

const absW = (v: number): number => { v = w(v); if (v < 0) { v = -v; if (v > 0x7fff) v = 0x7fff; } return v; };

/** sub_049C78: sqrt(x^2 + y^2) of two words */
export function hypot(x: number, y: number): number {
  let d0 = absW(x), d1 = absW(y);
  const sum = (l(muls(w(x), w(x)) + muls(w(y), w(y)))) >>> 0;
  if (!(d0 >= d1)) [d0, d1] = [d1, d0];
  let lo = d0, hi = d0 + d1, mid = 0;
  for (;;) {
    mid = (lo + hi) >>> 1;
    let sq = mulu(mid, mid) >>> 0;
    if (sq === sum) break;
    if (sq > sum) { hi = mid; continue; }
    sq = (sq + mid + mid + 2) >>> 0;
    if (sq >= sum) break;
    lo = mid;
  }
  return mid;
}

/** sub_049BA4: angle of the vector (x, y) */
export function atan(x: number, y: number): number {
  // sub_049C3E: scale to a unit vector (0x4000 = 1.0 in 1.15 / 2)
  let r = w(hypot(x, y));
  if (r === 0) r = 1;
  let d0 = w(x), d1 = w(y);
  if (r < 0) { d0 >>= 1; d1 >>= 1; r = (r & 0xffff) >>> 1; }
  let q = divs(l(d0 << 16) >> 1, r);
  d0 = q.overflow ? 0x7fff : q.q;
  q = divs(l(d1 << 16) >> 1, r);
  d1 = q.overflow ? 0x7fff : q.q;
  // search the sine table's first quarter
  let flip = false;
  let d2 = absW(d1);
  if (d2 >= 0x5a82) { d2 = absW(d0); flip = true; }
  if (d2 > 0x7f7f) d2 = 0x7f7f;
  let lo = 0, hi = 0x1ff, off = 0;
  for (;;) {
    off = (lo + hi) & 0xfffe;
    const s0 = ROM.rw(0x4a12a + off);
    if (d2 === s0) break;
    if (d2 < s0) { hi = off >> 1; continue; }
    if (d2 <= ROM.rw(0x4a12a + off + 2)) break;
    lo = off >> 1;
  }
  let a = off >> 1;
  if (flip) a = w(0x200 - a);
  if (d0 < 0) a = d1 < 0 ? w(a + 0x400) : w(0x400 - a);
  else if (d1 < 0) a = w(0x800 - a);
  return a & 0x7ff;
}

/** sub_049B72: angle from (x1, y1) to (x0, y0) */
export function angleTo(x0: number, y0: number, x1: number, y1: number): number {
  let dx = l(w(x0) - w(x1)), dy = l(w(y0) - w(y1));
  if ((Math.abs(dx) & 0x8000) !== 0 || (Math.abs(dy) & 0x8000) !== 0) { dx >>= 1; dy >>= 1; }
  return atan(dx, dy);
}
