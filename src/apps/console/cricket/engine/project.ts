// Perspective projection of a world point (x across, y up, z = distance along the pitch) to the
// screen, as used by the batting view. sub_049FA0 uses a fixed centre (160,130); sub_049F2C adds the
// camera pan ($BF7A + $BF7E) and its centre ($E8F2, $E8F4). The camera is fixed while batting.
// Camera pitch: sine table entry 36 ($4A172).

import { Ram, SIN, COS } from "./mem";
import { w, l, muls, divs } from "./m68k";

const S36 = SIN(36), C36 = COS(36);

function core(x: number, y: number, z: number): { sx: number; sy: number; d: number } {
  let d2 = l(muls(C36, z) + muls(S36, y));
  d2 = w(l(d2 + d2) >>> 16);
  let d1 = l(muls(C36, y) - muls(S36, z));
  d1 = w(l(d1 + d1) >>> 16);
  d2 = w(d2 + 0x1240);
  if (d2 === 0) d2 = 1;
  if (d2 < 0) d2 = w(-d2);
  return { sx: w(x), sy: d1, d: d2 };
}

/** divs.w of 7*v*256 by the depth; keeps the 68000's overflow behaviour (register unchanged) */
function persp(v: number, d: number): number {
  const n = l(w(v) * 7 * 256);
  return divs(n, d).q;
}

/** sub_049FA0: fixed batting camera */
export function project(x: number, y: number, z: number): [number, number] {
  const c = core(x, y, z);
  return [w(persp(c.sx, c.d) + 0xa0), w(persp(c.sy, c.d) + 0x82)];
}

/** sub_049F2C: camera projection (pan $BF7E + $BF7A, centre $E8F2/$E8F4) */
export function projectCam(m: Ram, x: number, y: number, z: number): [number, number] {
  const c = core(x, y, z);
  const sx = w(c.sx + m.rw(0xbf7e) + m.rw(0xbf7a));
  return [w(persp(sx, c.d) + m.rw(0xe8f2)), w(persp(c.sy, c.d) + m.rw(0xe8f4))];
}
