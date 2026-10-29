// Pads as the game sees them. The VBlank handler keeps four pad blocks at $FBF8 + 8 * slot
// (+2 buttons pressed since they were last read, +4 previous, +6 held). A side (batting or
// fielding) is played by a controller record: $FC18 (controller 0) or $FC1E (controller 1), each
// [slot, second slot, mode]. sub_004268 reads the presses of a controller and consumes them.

import { Ram } from "./mem";
import { batPad } from "./batsman";

/** the VBlank input handler for the pad the human plays with (as the batting engine does) */
export function applyPad(m: Ram, held: number, pressed: number): void {
  const pad = batPad(m) >= 0 ? batPad(m) : 0xfbf8;
  m.ww(pad + 4, held);
  m.ww(pad + 6, held);
  m.ww(pad + 2, m.rw(pad + 2) | pressed);
}

/** sub_004800 as the VBlank input handler runs it for the human's pad: buttons that went down since
 *  the handler last ran (its "previous" word) are latched */
export function padFrame(m: Ram, held: number): void {
  const pad = batPad(m) >= 0 ? batPad(m) : 0xfbf8;
  const newly = held & ~m.rw(pad + 4) & 0xff;
  m.ww(pad + 4, held);
  m.ww(pad + 6, held);
  m.ww(pad + 2, m.rw(pad + 2) | newly);
}

/** sub_0043D2: the buttons (not directions) pressed in a slot since the last read; consumed */
function take(m: Ram, slot: number): number {
  const a = 0xfbf8 + 8 * slot + 2;
  const v = m.rw(a) & 0xf0;
  m.ww(a, m.rw(a) - v);
  return v;
}

/** sub_0042E4: presses for one controller record (a0) with the player bit $FBEE */
function readRecord(m: Ram, a0: number): number {
  const mode = m.rw(a0 + 4);
  const active = () => (m.rw(0xfbee) & m.rw(0xfc26)) !== 0;
  const hit = (d0: number, takeOver: boolean) => {
    if (d0 !== 0) {
      m.ww(0xfc28, m.rw(0xfbee));
      if (takeOver) { m.ww(0xfc26, m.rw(0xfbee)); m.ww(0xfc2a, 0); }
    }
    return d0;
  };
  if (mode === 0) {
    if (!active()) return 0;
    const s = m.rw(a0); if (s < 0) return 0;
    return hit(take(m, s), false);
  }
  if (mode === 1) {
    m.ww(0xfbee, m.rw(0xfbee) * 2);
    if (!active()) return 0;
    const s = m.rw(a0 + 2); if (s < 0) return 0;
    return hit(take(m, s), false);
  }
  if (active()) {
    const s = m.rw(a0); if (s < 0) return 0;
    const d0 = take(m, s);
    if (d0 !== 0) return hit(d0, true);
  }
  m.ww(0xfbee, m.rw(0xfbee) * 2);
  if (!active()) return 0;
  const s2 = m.rw(a0 + 2);
  if (s2 < 0 || s2 === m.rw(a0)) return 0;
  return hit(take(m, s2), true);
}

/** sub_004268: presses for controller `ctl` (0, 1, or anything else = either) */
export function padPresses(m: Ram, ctl: number): number {
  const c0 = () => { m.ww(0xfbee, 1); return readRecord(m, 0xfc18); };
  const c1 = () => { m.ww(0xfbee, 4); return readRecord(m, 0xfc1e); };
  if (ctl === 0) return c0();
  if (ctl === 1) return c1();
  let d0 = c0();
  if (d0 !== 0) { m.ww(0xfc28, m.rw(0xfbee)); m.ww(0xfc26, m.rw(0xfbee)); m.ww(0xfc2a, 0); return d0; }
  d0 = c1();
  if (d0 !== 0) { m.ww(0xfc28, m.rw(0xfbee)); m.ww(0xfc26, m.rw(0xfbee)); m.ww(0xfc2a, 0); }
  return d0;
}
