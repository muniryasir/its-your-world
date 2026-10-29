// The close fielders: wicket-keeper and slips (structs pointed to by $E1B4/$E1B8/$E1BC, $BE1A = how
// many slips). They watch the ball, dive for it and catch it; the keeper gathers balls the batsman
// leaves. Ported from $0471D8-$048392.
// Fielder struct: +0 long dive step, +$E reach table (8 entries of [distance.l, action.l]),
// +$3E / +$9A sprite and hand offsets per pose, +$FA base sprite frame, +$FC/+$100/+$104 position
// (16.16), +$108 state, +$10A/+$10C pose, +$10E timer, +$110 dive direction, +$112/+$114 dive
// steps, +$118 recovery, +$11A holding the ball ($100 = caught), +$11C gave up,
// +$11E collision struct (flags, ball screen x/y, handler, entry), +$12C/+$12E/+$130 screen x, y, frame.

import { Ram, ROM, SIN, COS } from "./mem";
import { w, l, muls, asr, hiAfterShift, divs, div32, swap } from "./m68k";
import { projectCam } from "./project";
import { heightForScreenY } from "./batsman";
import { GRAVITY } from "./ball";
import { registerObject, deflect, fielderHasBall } from "./collide";

const ptr = (m: Ram, a: number) => m.rl(a) & 0xffff;

export function fielderPtrs(m: Ram): number[] {
  const out = [ptr(m, 0xe1b4)];
  const n = m.rw(0xbe1a);
  if (n !== 0) out.push(ptr(m, 0xe1b8));
  if (n !== 0 && n !== 1) out.push(ptr(m, 0xe1bc));
  return out;
}

/** sub_047A4C: follow the ball until its y reaches `target` (at most `maxTicks`); null if it never does */
function ballReaches(m: Ram, target: number, maxTicks: number): { x: number; z: number; y: number; ticks: number } | null {
  const a0 = l(w(target) << 16);
  const ax = m.rl(0xe5a4);
  let x = m.rl(0xe5b4), z = m.rl(0xe5b8), y = m.rl(0xe5bc);
  let vx = m.rl(0xe5a8), vz = m.rl(0xe5ac), vy = m.rl(0xe5b0);
  let n = 0;
  const a4 = w(maxTicks);
  if (vy < 0 || y >= a0) return null;
  const done = () => ({ x: w(x >>> 16), z: w(z >>> 16), y: w(y >>> 16), ticks: n });
  const st = m.rw(0xe5a2);
  m.ww(0xe1b2, 1);
  let phase = 1;
  if (st !== 1) { phase = st === 2 ? 2 : 3; m.ww(0xe1b2, phase); }
  if (phase === 1) {
    for (;;) {
      if (y >= a0) return done();
      if (n >= a4) return null;
      n++;
      vx = l(vx + ax); x = l(x + vx); y = l(y + vy); vz = l(vz - GRAVITY); z = l(z + vz);
      if (z >= 0) continue;
      z = 0;
      vx = muls(hiAfterShift(vx, 8), m.rw(0xc5ba));
      vy = muls(hiAfterShift(vy, 8), m.rw(0xc5ba));
      vz = l(-muls(hiAfterShift(vz, 8), m.rw(0xc5bc)));
      const ang = w(-(m.rw(0xd282) + m.rw(0xc5cc))) & 0x7ff;
      const s = SIN(ang), c = COS(ang);
      const d3 = hiAfterShift(vx, 6), d5 = hiAfterShift(vy, 6);
      vy = asr(l(muls(c, d5) + muls(s, d3)), 5);
      vx = asr(l(muls(c, d3) - muls(s, d5)), 5);
      n--;
      m.ww(0xe1b2, 2);
      phase = 2;
      break;
    }
  }
  if (phase === 2) {
    for (;;) {
      if (y >= a0) return done();
      if (l(vx + vy) <= 0x80000) return null;
      if (n >= a4) return null;
      n++;
      x = l(x + vx); y = l(y + vy); vz = l(vz - GRAVITY); z = l(z + vz);
      if (z >= 0) continue;
      z = 0;
      vx = muls(hiAfterShift(vx, 8), m.rw(0xc5be));
      vy = muls(hiAfterShift(vy, 8), m.rw(0xc5be));
      vz = l(-muls(hiAfterShift(vz, 8), m.rw(0xc5c0)));
      if (vz > 0x8000) continue;
      n--;
      m.ww(0xe1b2, 3);
      break;
    }
  }
  for (;;) {
    if (y >= a0) return done();
    if (l(vx + vy) <= 0x80000) return null;
    if (n >= a4) return null;
    n++;
    x = l(x + vx); y = l(y + vy);
    vx = muls(hiAfterShift(vx, 8), m.rw(0xc5c2));
    vy = muls(hiAfterShift(vy, 8), m.rw(0xc5c2));
  }
}

/** sub_047A1A: ball position (16.16) relative to the fielder when it reaches his y, and the ticks */
function ballRelative(m: Ram, f: number): { dx: number; dz: number; dy: number; ticks: number } {
  const r = ballReaches(m, w(m.rl(f + 0x104) >>> 16), 0xd3);
  if (!r) return { dx: 0, dz: 0, dy: 0, ticks: -1 };
  return {
    dx: l((r.x << 16) - m.rl(f + 0xfc)),
    dz: l((r.z << 16) - m.rl(f + 0x100)),
    dy: l((r.y << 16) - m.rl(f + 0x104)),
    ticks: r.ticks,
  };
}

/** walk the fielder's reach table: the entry for this distance */
function reachEntry(m: Ram, f: number, dx: number): number {
  let d7 = dx < 0 ? l(-dx) : dx;
  let a1 = f + 0xe;
  while (d7 < m.rl(a1)) a1 += 8;
  void d7;
  return a1;
}

/** sub_047590: how well placed is this fielder for the ball? [priority, ticks, hand frame] */
function fielderChance(m: Ram, f: number): [number, number, number] {
  if (m.rw(f + 0x11c) !== 0) return [-0x8000, -1, 0];
  const r = ballRelative(m, f);
  if (r.ticks < 0) return [w(0xc000), r.ticks, 0];
  let d7 = r.dx < 0 ? l(-r.dx) : r.dx;
  let a1 = f + 0xe, a2 = 0x475dc;
  while (d7 < m.rl(a1)) { a1 += 8; a2 += 4; }
  void d7;
  return [w(ROM.rw(a2) - 2 * r.ticks), r.ticks, ROM.rw(a2 + 2)];
}

/** sub_0474E0: pick the fielder the ball is going to ($E1A8; $E1AC priority, $E1AE ticks, $E1B0 frame) */
function chooseFielder(m: Ram): void {
  if (m.rw(0xe936) === 0) return;
  if (m.rw(0xe1a8) !== 0 && m.rw(ptr(m, 0xe1a8) + 0x11c) === 0) return;
  if (m.rw(0xbe1a) === 0) { m.wl(0xe1a8, m.rl(0xe1b4)); return; }
  fielderPtrs(m).forEach((f, i) => {
    const [p, t, fr] = fielderChance(m, f);
    if (i === 0 || p > m.rw(0xe1ac)) {
      m.wl(0xe1a8, 0xffff0000 | f);
      m.ww(0xe1ac, p); m.ww(0xe1ae, t); m.ww(0xe1b0, fr);
    }
  });
}

/** sprite pose index into the +$3E/+$9A tables (+9 for the mirrored dive poses) */
function poseIndex(m: Ram, f: number, d2: number): number {
  const st = m.rw(f + 0x108);
  if (st !== 5 && st !== 8 && st > 2 && m.rw(f + 0x110) < 0) d2 += 9;
  return 4 * w(d2);
}

/** where (world x, height) are this fielder's hands for pose `frame` */
function handsAt(m: Ram, f: number, frame: number): [number, number] {
  let [sx, sy] = projectCam(m, m.rw(f + 0xfc), m.rw(f + 0x100), m.rw(f + 0x104));
  const d2 = poseIndex(m, f, frame);
  sx = w(sx - m.rw(f + 0x3e + d2) + m.rw(f + 0x9a + d2));
  sy = w(sy - m.rw(f + 0x3e + d2 + 2) + m.rw(f + 0x9a + d2 + 2));
  return [sx, heightForScreenY(sy, m.rw(f + 0x104))]; // sub_0461B0 (its x is not used by callers)
}

/** sub_047436: an edge: set the ball's climb so it arrives at the chosen fielder's hands */
export function edgeLift(m: Ram): void {
  chooseFielder(m);
  if (m.rw(0xe1ae) < 0) return;
  const f = ptr(m, 0xe1a8);
  const [, h] = handsAt(m, f, m.rw(0xe1b0));
  const t = m.rw(0xe1ae);
  if (t === 0) return; // the 68000 would trap on a zero divide; not seen in play
  let d1 = w(w(-h) - m.rw(0xe5b8));
  d1 = divs(l(d1 << 8), t).q;
  d1 = w(d1 + divs(l(t << 8), 10).q);
  m.wl(0xe5ac, l(d1 << 8));
}

/** sub_048202: steer the ball's height towards the fielder's hands (or the ground) as it nears him.
 *  `handFrame` is the word the caller's a6 points at. */
function steer(m: Ram, handFrame: number): void {
  if (m.rw(0xe5bc) <= 0x400 || m.rw(0xe566) !== 0 || m.rw(0xe5b0) < 0) return;
  if (m.rw(0xe5a2) === 0 || m.rw(0xe5a2) === 3) return;
  if ((m.rw(0x8606) | m.rw(0x8608) | m.rw(0xbee2)) !== 0) return;
  const toGround = () => {
    let d0 = asr(m.rl(0xe5ac), 8);
    d0 = muls(d0, d0);
    d0 = l(d0 * 5);
    d0 = l(d0 + m.rl(0xe5b8));
    d0 = asr(d0, 6);
    d0 = l(asr(d0, 1) + d0);
    d0 = asr(d0, 3);
    startSteer(m, d0);
  };
  if (closeFieldersBusy(m)) return toGround();
  chooseFielder(m);
  if (m.rw(0xe1ae) < 0) return toGround();
  const f = ptr(m, 0xe1a8);
  const [, h] = handsAt(m, f, handFrame);
  const hz = w(-h), hy = m.rw(f + 0x104);
  const r = ballReaches(m, hy, 0xd3);
  if (!r) return;
  const d6 = r.ticks;
  let d4 = w(r.z - hz);
  let d5 = d4;
  if (d5 < 0) {
    d5 = (w(-d5) & 0xffff) >>> 1;
    if (d5 > d6) d4 = w(-2 * d6);
  } else if (d5 > d6) d4 = w(d6);
  if (m.rw(0xe1b2) === 3) return;
  // subq.w #4,d6 / moveq #4,d6: the divisor's upper half is what the tick left in d6 (see Ram.d6hi)
  const n = w(d6 - 4);
  const divisor = n < 0 ? 4 : l((m.d6hi << 16) | (n & 0xffff));
  startSteer(m, asr(div32(l(d4 << 16), divisor), 3));
}
function startSteer(m: Ram, step: number): void {
  m.wl(0xe56c, step);
  m.wl(0xe568, 0);
  m.ww(0xe570, 7);
  m.ww(0xe566, -1);
  m.ww(0xe564, 0);
}

/** sub_048392: apply the steering while the ball is short of the fielder */
function applySteer(m: Ram): void {
  if (m.rw(0xe566) >= 0) return;
  if (m.rw(0xe564) !== 0) { m.ww(0xe566, 1); return; }
  if (m.rw(0xe1a8) === 0) return;
  const f = ptr(m, 0xe1a8);
  if (w(m.rw(f + 0x104) + m.rw(0xe5b0)) < m.rw(0xe5bc)) {
    m.wl(0xe5ac, l(m.rl(0xe5ac) - m.rl(0xe568)));
    m.ww(0xe566, 1);
    return;
  }
  const d0 = l(m.rl(0xe56c) + m.rl(0xe568));
  m.wl(0xe568, d0);
  m.wl(0xe5b8, l(m.rl(0xe5b8) - d0));
  if (m.rw(0xe570) < 0) return;
  if (m.aw(0xe570, -1) < 0) m.wl(0xe56c, 0);
}

/** sub_0475F4: are all the close fielders committed (+$11C)? */
export function closeFieldersBusy(m: Ram): boolean {
  let d0 = 0xffff;
  for (const f of fielderPtrs(m)) d0 &= m.rw(f + 0x11c);
  return (d0 & 0xffff) !== 0;
}

/** sub_047760: stop going for the ball */
function standDown(m: Ram, f: number): void {
  if (m.rw(f + 0x108) !== 5) return;
  m.ww(f + 0x11c, -1);
  m.ww(f + 0x10a, 0);
  if (m.rw(f + 0x11a) === 0) { m.ww(f + 0x108, 1); m.ww(f + 0x10e, 3); }
  else { m.ww(f + 0x108, 2); m.ww(f + 0x10c, 2); m.ww(f + 0x10e, 2); }
}
/** sub_047416 */
function giveUp(m: Ram, f: number): void {
  if (m.rw(f + 0x11c) < 0) return;
  m.ww(f + 0x11c, -1);
  standDown(m, f);
  if (ptr(m, 0xe1a8) === f && m.rw(0xe1a8) !== 0) m.wl(0xe1a8, 0);
}

/** sub_0479E2: dive steps: cover (d3 -/+ reach) over n ticks */
function diveSteps(m: Ram, f: number, dx: number, reach: number, n: number): void {
  let d7 = dx >= 0 ? l(-reach) : reach;
  d7 = l(d7 + dx);
  d7 = l((d7 & ~0xff) | (d7 < 0 ? 0xff : 0)); // smi.b d7
  d7 = l((d7 << 8) | (d7 >>> 24)); // rol.l #8
  d7 = swap(d7);
  const q = divs(d7, n);
  d7 = q.reg;
  d7 = swap(d7);
  d7 = l(d7 & ~0xffff);
  d7 = asr(d7, 8);
  m.wl(f + 0x114, d7);
  m.ww(f + 0x112, n - 1);
}
/** sub_047A06 */
function diveMove(m: Ram, f: number): void {
  if (m.rw(f + 0x112) < 0) return;
  m.wl(f + 0xfc, m.rl(f + 0xfc) + m.rl(f + 0x114));
  m.aw(f + 0x112, -1);
}
const diveSide = (m: Ram, f: number, dx: number) => m.wb(f + 0x110, dx < 0 ? 0xff : 0); // smi.b

type Rel = { dx: number; ticks: number };
/** reach-table actions (called with the table entry) */
const ACTIONS: Record<number, (m: Ram, f: number, e: number, r: Rel) => void> = {
  0x47760: (m, f) => standDown(m, f),
  0x4779a: (m, f, _e, r) => { // set to take it
    if (m.rw(f + 0x108) !== 5) return;
    steer(m, ROM.rw(0x477ca));
    if (r.ticks > 4) return;
    m.ww(f + 0x108, 2); m.ww(f + 0x10c, 2); m.ww(f + 0x10a, 0); m.ww(f + 0x10e, 2);
  },
  0x477ce: (m, f, e, r) => { // short dive
    if (r.ticks > 0xc) return;
    steer(m, ROM.rw(0x4780a));
    if (m.rw(f + 0x118) >= 0) return;
    m.d6hi = 0; // moveq #6,d6
    diveSteps(m, f, r.dx, m.rl(e), 6);
    diveSide(m, f, r.dx);
    m.ww(f + 0x108, 3); m.ww(f + 0x10c, 0); m.ww(f + 0x10a, 5); m.ww(f + 0x10e, 3);
  },
  0x4780e: (m, f, e, r) => { // dive
    steer(m, ROM.rw(0x47842));
    if (r.ticks > 0xe) return;
    m.d6hi = 0; // moveq #6,d6
    diveSteps(m, f, r.dx, m.rl(e), 6);
    diveSide(m, f, r.dx);
    m.ww(f + 0x108, 6); m.ww(f + 0x10c, 0); m.ww(f + 0x10a, 7); m.ww(f + 0x10e, 0);
  },
  0x47846: (m, f, e, r) => { // long dive
    steer(m, ROM.rw(0x4787a));
    if (r.ticks > 0x12) return;
    m.d6hi = 0; // moveq #$a,d6
    diveSteps(m, f, r.dx, m.rl(e), 0xa);
    diveSide(m, f, r.dx);
    m.ww(f + 0x108, 7); m.ww(f + 0x10c, 0); m.ww(f + 0x10a, 5); m.ww(f + 0x10e, 0);
  },
  0x4787e: (m, f, e, r) => { // full-length dive
    steer(m, ROM.rw(0x4787a));
    if (r.ticks > 8) return;
    diveSteps(m, f, r.dx, m.rl(e), r.ticks);
    diveSide(m, f, r.dx);
    m.ww(f + 0x108, 4); m.ww(f + 0x10c, 0); m.ww(f + 0x10a, 0xa); m.ww(f + 0x10e, 2);
    steer(m, ROM.rw(0x478ba));
  },
};

/** sub_047710: pose animation by state */
function animate(m: Ram, f: number): void {
  const tick = (reset: number) => { if (m.aw(f + 0x10e, -1) >= 0) return false; m.ww(f + 0x10e, reset); return true; };
  const stepFwd = () => { let d0 = m.rl(f); if (m.rw(f + 0x110) < 0) d0 = l(-d0); m.wl(f + 0xfc, m.rl(f + 0xfc) + d0); };
  switch (m.rw(f + 0x108)) {
    case 0: if (tick(3) && m.aw(f + 0x10c, 1) === 2) m.ww(f + 0x108, 5); break;
    case 1: if (tick(3) && m.aw(f + 0x10c, -1) < 0) m.ww(f + 0x10c, 0); break;
    case 2: if (tick(2) && m.aw(f + 0x10c, 1) > 4) m.ww(f + 0x10c, 4); break;
    case 3:
      diveMove(m, f);
      if (m.rw(f + 0x10c) === 2) break;
      if (!tick(3)) break;
      if (m.aw(f + 0x10c, 1) === 1) stepFwd();
      else if (m.rw(f + 0x10c) === 2) { m.ww(f + 0x108, 5); m.ww(f + 0x10c, 0); m.ww(f + 0x10a, 2); m.ww(f + 0x118, 0xf); }
      break;
    case 4: diveMove(m, f); if (m.rw(f + 0x10c) !== 3 && tick(2)) m.aw(f + 0x10c, 1); break;
    case 6: diveMove(m, f); if (m.rw(f + 0x10c) !== 2 && tick(2)) m.aw(f + 0x10c, 1); break;
    case 7:
      diveMove(m, f);
      if (m.rw(f + 0x10c) === 4 || !tick(2)) break;
      if (m.aw(f + 0x10c, 1) === 2) { m.ww(f + 0x10e, 3); stepFwd(); }
      break;
    default: break; // 5 (ready), 8
  }
}

/** sub_047270: one close fielder's tick */
function fielderTick(m: Ram, f: number): void {
  out: if (m.rw(0xe5a2) !== 0 && m.rw(f + 0x11c) === 0 && m.rw(0xbf22) === 0) {
    let caught = m.rw(f + 0x11a) === 0x100;
    if (!caught) {
      if ((m.rb(f + 0x11f) & 1) === 0) break out;
      if (!handsReach(m, f)) break out;
      caught = true;
    }
    if (m.rw(0x8606) !== 0 && m.rw(0x8608) === 0 && m.rw(0xe580) === 0 && m.rw(0xbee2) === 0) {
      m.ww(0xbee0, 1);
      m.ww(0xbee2, 4); // caught
      m.wl(0xbee4, 0xffff0000 | f);
      m.ww(0xe578, 1); m.ww(0xe57e, 0); m.ww(0xe57c, 3); m.ww(0xe57a, 2); // sub_04844E
      if (m.rw(0xcce0) === 0) m.ww(0xd28a, 2);
    }
    m.ww(f + 0x11a, -1);
    m.ww(0xe58c, -1); // sub_04BA84
    m.ww(0xe934, -1);
  }
  if (m.rw(0xe5a2) !== 0 && m.rw(f + 0x11c) === 0 && m.rw(f + 0x104) < m.rw(0xe5bc)) giveUp(m, f);
  if (m.rw(f + 0x118) >= 0) m.aw(f + 0x118, -1);
  if (m.rw(f + 0x108) !== 5) { animate(m, f); return; }
  if (m.rw(0xe5a2) === 0) return;
  if (m.rw(0xd28e) >= 2 && m.rw(0xe936) <= 1) return;
  if ((m.rw(0x8606) | m.rw(0x8608)) === 0 && m.rw(0xe5b0) >= 0) {
    const by = m.rw(0x8614);
    if (!(m.rw(0xe5bc) > by) && w(m.rw(0xe5bc) + m.rw(0xe5b0)) < by) return;
  }
  if (ptr(m, 0xe1a8) === f && m.rw(0xe1a8) !== 0) {
    const r = ballRelative(m, f);
    if (r.ticks < 0) { giveUp(m, f); return; }
    const e = reachEntry(m, f, r.dx);
    const act = ACTIONS[m.rl(e + 4) & 0xffffff];
    if (!act) throw new Error(`fielder action $${(m.rl(e + 4) & 0xffffff).toString(16)}`);
    act(m, f, e, { dx: r.dx, ticks: r.ticks });
  }
  animate(m, f);
}

/** are the fielder's hands within 10 pixels of where the ball crossed him? */
function handsReach(m: Ram, f: number): boolean {
  let d0 = m.rw(f + 0x12c), d1 = m.rw(f + 0x12e);
  const d3 = w(m.rw(f + 0x130) - m.rw(f + 0xfa));
  if (d3 < 1) return false;
  d0 = w(d0 + m.rw(f + 0x9a + 4 * d3) - m.rw(f + 0x120));
  d1 = w(d1 + m.rw(f + 0x9a + 4 * d3 + 2) - m.rw(f + 0x122));
  return l(muls(d0, d0) + muls(d1 >> 1, d1 >> 1)) < 0x64;
}

/** sub_047D3E + registration: screen box and sprite frame for collisions.
 *  The keeper is registered twice (through the sprite routine, flipped if mirrored, then directly). */
function registerFielder(m: Ram, f: number, twice = false): void {
  let [sx, sy] = projectCam(m, m.rw(f + 0xfc), m.rw(f + 0x100), m.rw(f + 0x104));
  const pose = w(m.rw(f + 0x10c) + m.rw(f + 0x10a));
  const frame = w(pose + m.rw(f + 0xfa));
  const d4 = poseIndex(m, f, pose);
  const flip = d4 !== 4 * pose;
  sx = w(sx - m.rw(f + 0x3e + d4));
  sy = w(sy - m.rw(f + 0x3e + d4 + 2));
  m.ww(f + 0x12c, sx); m.ww(f + 0x12e, sy); m.ww(f + 0x130, frame);
  registerObject(m, sx, sy, flip ? w(-frame) : frame, m.rw(f + 0x104), f + 0x11e);
  if (twice) registerObject(m, sx, sy, frame, m.rw(f + 0x104), f + 0x11e);
}

/** where registerFielder last drew this fielder: screen top-left and frame (negative = mirrored) */
export function fielderSprite(m: Ram, f: number): { x: number; y: number; frame: number } {
  const pose = w(m.rw(f + 0x10c) + m.rw(f + 0x10a));
  const frame = m.rw(f + 0x130);
  const flip = poseIndex(m, f, pose) !== 4 * pose;
  return { x: m.rw(f + 0x12c), y: m.rw(f + 0x12e), frame: flip ? w(-frame) : frame };
}

/** sub_0471D8 + sub_047C76 + sub_047246 + sub_047CB2 */
export function closeFieldersTick(m: Ram): void {
  const fs = fielderPtrs(m);
  const on = m.rw(0x860e) !== 0;
  if (on) {
    // sub_0471D8 calls sub_048202 without setting a6, so the "hand frame" it reads is the word at the
    // main task's frame pointer ($FFFF8D96). That word is $160 throughout the delivery loops.
    steer(m, 0x160);
    applySteer(m);
    chooseFielder(m);
    fielderTick(m, fs[0]);
  }
  registerFielder(m, fs[0], true);
  if (on) for (const f of fs.slice(1)) fielderTick(m, f);
  for (const f of fs.slice(1)) registerFielder(m, f);
}

/** $047BD4/$047BDE/$047BE8: the ball hit a close fielder: catch it if his hands are there, else deflect */
export function hitFielder(m: Ram, entry: number, obj: number): void {
  const f = obj - 0x11e;
  m.ww(0xe566, 1);
  if (m.rw(0xbf22) !== 0) return;
  if (fielderHasBall(m)) return;
  if (handsReach(m, f)) {
    m.ww(f + 0x11a, 0x100);
    m.ww(f + 0x11c, 0);
    m.ww(0xe58c, -1);
    for (const g of fielderPtrs(m)) standDown(m, g); // sub_047672
    return;
  }
  deflect(m, entry, obj);
}
