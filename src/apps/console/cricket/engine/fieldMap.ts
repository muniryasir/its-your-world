// The batting view's fielders map (the small panel that slides in at the bottom right before the aim).
// Only its state machine and what it writes back into the fielding side's records matter to the game:
// while it is up, every tick copies the bowler's, the slips' and the keeper's batting-view positions
// into their records (+$3C / +$44), which is where a ball that ends in the batting view leaves them.

import { Ram } from "./mem";
import { w } from "./m68k";

const REC = 0x68;

/** sub_00BF2A (from = -1) / sub_00BF3A: the next fielding-side record with role d0, or -1 */
function roleFrom(m: Ram, role: number, from: number): number {
  let a1: number;
  if (from < 0) {
    a1 = m.rl(0xb522) & 0xffff;
    m.ww(0xbe18, 0);
    if (m.rw(a1 + 6) === w(role)) return a1;
  } else a1 = from;
  for (;;) {
    a1 += REC;
    if (m.aw(0xbe18, 1) === 0xb) return -1;
    if (m.rw(a1 + 6) === w(role)) return a1;
  }
}

/** sub_03AD3A (before the last pass ahead of the aim): the map slides in, unless it is up already */
export function fieldMapShow(m: Ram): void {
  const s = m.rw(0xc8a2);
  if (s === 0 || s === 1) return;
  m.ww(0xc8a4, 0x208); m.ww(0xc8a6, 0x1c8); // (-$10 with a long name on the scoreboard: display only)
  m.ww(0xc8a2, 0);
}

/** sub_03AD7C: the map slides out */
export function fieldMapHide(m: Ram): void {
  const s = m.rw(0xc8a2);
  if (s >= 0 && s !== 2) m.ww(0xc8a2, 2);
}

/** sub_03AD98, at the end of every batting-view tick */
export function fieldMapTick(m: Ram): void {
  const s = m.rw(0xc8a2);
  if (s < 0) return;
  if (s === 0) {
    m.aw(0xc8a4, -8); m.aw(0xc8a6, -8);
    if (m.rw(0xc8a4) <= 0x110) m.ww(0xc8a2, 1);
  } else if (s !== 1) {
    m.aw(0xc8a4, 8); m.aw(0xc8a6, 8);
    if (m.rw(0xc8a4) >= 0x168) m.ww(0xc8a2, -1);
  }
  if (m.rw(0x86b2) >= 0) return;
  const put = (a1: number, x: number, y: number) => { m.ww(a1 + 0x3c, x); m.ww(a1 + 0x44, y); };
  const close = (a1: number, p: number) => { const a0 = m.rl(p) & 0xffff; put(a1, m.rw(a0 + 0xfc), m.rw(a0 + 0x104)); };
  put(roleFrom(m, 1, -1), m.rw(0xd26c), m.rw(0xd270)); // sub_00B3F4: the bowler
  const slip1 = roleFrom(m, 3, -1);
  if (slip1 >= 0) {
    close(slip1, 0xe1b8);
    const slip2 = roleFrom(m, 3, slip1);
    if (slip2 >= 0) close(slip2, 0xe1bc);
  }
  close(roleFrom(m, 4, -1), 0xe1b4); // the keeper
}
