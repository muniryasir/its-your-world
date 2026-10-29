// The fielding side's field: which placing table the captain uses, which player stands where, and
// the close fielders (keeper and slips) at their marks. The original redoes this at the start of
// every delivery (sub_046FA2 from sub_00E13E) and when the fielding view starts (sub_03515C).
// Ported from $00B116-$00C27E, $0355DA, $046FA2-$0471D6.
//
// Fielder records (stride $68 from $B522): +0 player id, +2 pointer to the player's entry in the
// team table (32 bytes: +$E, +$12, +$14 bowling type, +$18 keeper flag, +$19 picked mark),
// +6 role (1 bowler, 4 keeper, 3 slip, 0 fielder, -1 not placed).
// Placing table (10 entries of 8 bytes): +0 x, +2 y, +4 kind (0 fielder, 1 slip, 2 keeper), +6 player id.

import { Ram, ROM } from "./mem";
import { w, l, muls, divs, div32 } from "./m68k";

const REC = 0x68;
const base = (m: Ram) => m.rl(0xb522) & 0xffff;
const recs = (m: Ram) => Array.from({ length: 11 }, (_, i) => base(m) + REC * i);
/** a fielder record as the original stores pointers to it (the high word of $B522) */
const P = (m: Ram, a: number) => l((m.rl(0xb522) & 0xffff0000) | (a & 0xffff));

// ---------------------------------------------------------------- match struct accessors

/** sub_00BEEC: which team is fielding (parity) */
function fieldingParity(m: Ram): number {
  let d1 = m.rw(0xbe68 + 8); // sub_00C838
  const d0 = m.rw(0xbe68 + 0x2c); // sub_00C61A
  if (d0 >= 2) d1 ^= m.rw(0xbe68 + 0xa); // sub_00C5D6
  if (d0 & 1) d1 = ~d1;
  return w(d1);
}
/** sub_00B59A: the fielding team's index */
const fieldingTeam = (m: Ram) => (fieldingParity(m) & 1 ? m.rw(0xbe68) : m.rw(0xbe68 + 4));
/** sub_00B582: the fielding team's player table */
export const teamTable = (m: Ram) => l(m.rl(0x72ea + 4 * fieldingTeam(m)) + 0x10);

/** sub_00B468(1) / sub_00B3F4: the bowler's record (role 1); $BE18 = its index */
export function bowlerRec(m: Ram): number {
  let a1 = base(m);
  m.ww(0xbe18, 0);
  for (;;) {
    if (m.rw(a1 + 6) === 1) return a1;
    a1 += REC;
    if (m.aw(0xbe18, 1) === 0xb) return a1;
  }
}
/** sub_00BFFE: this bowler's placing table */
export const placingTable = (m: Ram) => (teamTable(m) + 0x280 + w(muls(m.rw(bowlerRec(m)), 0x50))) & 0xffff;

/** sub_00C066 / sub_00C03E / sub_00C052: the placing entry whose kind (+4) or id (+6) is v */
function findEntry(m: Ram, off: number, v: number): number {
  let a0 = placingTable(m);
  for (let i = 0; i < 10; i++, a0 += 8) if (m.rw(a0 + off) === w(v)) return a0;
  return -1;
}
const entryOfKind = (m: Ram, k: number) => findEntry(m, 4, k);
const entryOfId = (m: Ram, id: number) => findEntry(m, 6, id);

/** sub_00C248: the fielder record of player `id` (-1 if he isn't in the side) */
export function recOfPlayer(m: Ram, id: number): number {
  const a0 = l(teamTable(m) + w(id << 5));
  for (const a1 of recs(m)) if (m.rl(a1 + 2) === a0) return a1;
  return -1;
}
/** player entry word / byte (team tables are in RAM) */
const pw = (m: Ram, a1: number, o: number) => m.rw((m.rl(a1 + 2) & 0xffff) + o);

/** sub_00B1B8: how well a player suits the job (weights table) */
function suitability(m: Ram, a1: number, wt: number): number {
  let d0 = 0;
  d0 = w(d0 + w(muls(pw(m, a1, 0xe), ROM.rw(wt))));
  let t = pw(m, a1, 0x14); if (t < 0) t = w(-t);
  d0 = w(d0 + ROM.rw(wt + 2 * t));
  d0 = w(d0 + w(muls(pw(m, a1, 0x12), ROM.rw(wt + 0xa))));
  if (pw(m, a1, 0x18) !== 0) d0 = w(d0 + ROM.rw(wt + 0xc));
  return d0;
}

/** sub_00B116: rank the unplaced players by suitability into the list at $A678 */
function rankPlayers(m: Ram, wt: number): void {
  m.wl(0xa6a0, wt); m.ww(0xa676, -1);
  for (const a1 of recs(m)) m.wb((m.rl(a1 + 2) & 0xffff) + 0x19, 0);
  let out = 0xa678;
  for (let k = 0; k < 11; k++) {
    let best = w(0x8000), pick = 0;
    for (let d6 = 10; d6 >= 0; d6--) {
      const a0 = base(m) + REC * (10 - d6);
      const role = m.rw(a0 + 6);
      if (!(role < 0 || role === 0)) continue;
      if (m.rb((m.rl(a0 + 2) & 0xffff) + 0x19) !== 0) continue;
      let d0 = suitability(m, a0, wt);
      if (wt === 0x536ae) d0 = w(d0 - d6);
      if (!(best >= d0)) { best = d0; pick = 10 - d6; }
    }
    if (best === w(0x8000)) return;
    m.ww(out, pick); out += 2;
    m.aw(0xa676, 1);
    m.wb((m.rl(base(m) + REC * pick + 2) & 0xffff) + 0x19, -1);
  }
}

/** sub_00C218: the next player from the ranked list who isn't placed yet */
function nextRanked(m: Ram): number {
  for (;;) {
    const p = m.rl(0xbe64) & 0xffff;
    const i = m.rw(p);
    m.wl(0xbe64, l(0xffff0000 | (p + 2)));
    const a1 = base(m) + w(muls(i, REC));
    if (entryOfId(m, m.rw(a1)) >= 0) continue;
    if (m.rw(a1 + 6) < 0) return a1;
    if (m.rl(0xa6c2) === P(m, a1)) return a1; // sub_00B460
  }
}

/** sub_00C118: put players on the keeper's and slips' marks, then the rest of the field */
export function assignFielders(m: Ram): void {
  for (const a1 of recs(m)) if (m.rw(a1 + 6) !== 1) m.ww(a1 + 6, -1);
  rankPlayers(m, 0x536ae);
  m.wl(0xbe64, 0xffffa678);
  const place = (e: number, role: number) => {
    const id = m.rw(e + 6);
    const r = id >= 0 ? recOfPlayer(m, id) : -1;
    if (r >= 0) { m.ww(r + 6, role); return; }
    const a0 = nextRanked(m);
    m.ww(a0 + 6, role);
    m.ww(e + 6, m.rw(a0));
  };
  place(entryOfKind(m, 2), 4);
  for (;;) {
    const e = entryOfKind(m, 1);
    if (e < 0) break;
    m.ww(e + 4, 3);
    place(e, 3);
  }
  for (;;) { const e = entryOfKind(m, 3); if (e < 0) break; m.ww(e + 4, 1); }
  let a1 = placingTable(m);
  for (let i = 0; i < 10; i++, a1 += 8) {
    if (m.rw(a1 + 4) !== 0) continue;
    const id = m.rw(a1 + 6);
    if (id < 0) continue;
    const r = recOfPlayer(m, id);
    if (r >= 0) m.ww(r + 6, 0); else m.ww(a1 + 6, -1);
  }
  for (;;) {
    const e = entryOfId(m, -1);
    if (e < 0) return;
    // sub_00BF2A(-1): the first unplaced player ($BE18 = his index)
    let r = recs(m).findIndex((a) => m.rw(a + 6) === -1);
    m.ww(0xbe18, r < 0 ? 0xb : r);
    if (r >= 0) r = base(m) + REC * r;
    else {
      // sub_00B420: the player at $A6C2 (or none)
      if (m.rl(0xa6c2) === 0) return;
      r = m.rl(0xa6c2) & 0xffff;
      m.ww(0xbe18, divs(l(m.rl(0xa6c2) - m.rl(0xb522)), REC).q);
    }
    m.ww(e + 6, m.rw(r));
    m.ww(e + 4, 0);
    m.ww(r + 6, 0);
  }
}

/** sub_0355DA: the computer captain sets the field for this bowler (and over), from the ROM templates */
export function setField(m: Ram): void {
  const a1 = bowlerRec(m);
  const a2 = m.rl(a1 + 2) & 0xffff;
  if (m.rw(0xb526) < 0) {
    let d1 = m.rw(0xbe7a);
    if (d1 < 0) d1 = 0x77;
    let d0 = divs(l(l(m.rw(0xbe68 + 0x2e)) << 2), w(d1 + 1)).q & 3;
    m.ww(a1 + 0xc, ROM.rw(0x35654 + 2 * d0));
  }
  let t = m.rw(a2 + 0x14); if (t < 0) t = w(-t);
  const k = w(w(w(t - 1) << 3) + m.rw(a1 + 0xc)) << 2;
  let src = ROM.rl(0x3ba6 + w(k)) & 0xffffff;
  let dst = placingTable(m);
  for (let i = 0; i < 10; i++, src += 8, dst += 8) {
    m.wl(dst, ROM.rl(src));
    m.ww(dst + 4, ROM.rw(src + 4));
    m.ww(dst + 6, -1);
  }
}

/** sub_047122: a close fielder at his mark (from placing entry e), with his reach table */
function closeFielderAt(m: Ram, e: number, a1: number): void {
  m.ww(a1 + 0x104, m.rw(e + 2)); m.ww(a1 + 0x106, 0);
  let x = m.rw(e); if (m.rw(0xd2c6) !== 0) x = w(-x);
  m.ww(a1 + 0xfc, x); m.ww(a1 + 0xfe, 0); m.wl(a1 + 0x100, 0);
  m.ww(a1 + 0xfc, divs(l(m.rw(a1 + 0xfc)), 5).q);
  m.ww(a1 + 0x104, divs(muls(m.rw(a1 + 0x104), 0x380), 0x7f0).q);
  m.ww(a1 + 0x108, 8); m.ww(a1 + 0x10c, 0); m.ww(a1 + 0x10a, 0);
  m.ww(a1 + 0x118, -1); m.ww(a1 + 0x11a, 0); m.ww(a1 + 0x11c, 0);
  let d1 = muls(m.rw(a1 + 0x104), ROM.rw(0x4a572));
  d1 = w(w(l(d1 * 2) >>> 16) + 0x1240);
  m.wl(a1, div32(l(muls(5, d1) << 8), 7));
  for (let i = 0; i < 5; i++) {
    m.wl(a1 + 0xe + 8 * i, div32(l(muls(m.rw(a1 + 4 + 2 * i), d1) << 8), 7));
  }
}

/** sub_046FA2: the field for this delivery: placings, players, and the keeper and slips at their marks */
export function setUpField(m: Ram): void {
  setField(m);
  assignFielders(m);
  // sub_00C01C: how many slips
  let slips = 0;
  { let e = placingTable(m); for (let i = 0; i < 10; i++, e += 8) if (m.rw(e + 4) === 1) slips++; }
  m.ww(0xbe1a, slips);
  m.ww(0xe566, 0);
  m.wl(0xe1a8, 0);
  let e = placingTable(m), nSlip = 0;
  for (let i = 0; i < 10; i++, e += 8) {
    const kind = m.rw(e + 4);
    if (kind === 2) {
      m.wl(0xe2b6, P(m, recOfPlayer(m, m.rw(e + 6))));
      const a1 = 0xe1c0;
      m.wl(0xe1b4, l(0xffff0000 | a1)); m.ww(a1 + 0x11e, 0); m.wl(a1 + 0x124, 0x47bd4);
      closeFielderAt(m, e, a1);
    } else if (kind === 1) {
      const first = nSlip === 0;
      m.wl(first ? 0xe3ec : 0xe522, P(m, recOfPlayer(m, m.rw(e + 6))));
      const a1 = first ? 0xe2f6 : 0xe42c;
      m.wl(first ? 0xe1b8 : 0xe1bc, l(0xffff0000 | a1)); m.ww(a1 + 0x11e, 0); m.wl(a1 + 0x124, first ? 0x47bde : 0x47be8);
      closeFielderAt(m, e, a1);
      nSlip++;
    }
  }
  m.wl(0xe1a8, 0);
  // sub_047D3E for each (their sprites) is done by the batting view's renderer
}

/** sub_00BF5A: also lists the fielders in placing order at $BE1E (outfield, keeper, slips) */
export function fieldOrder(m: Ram): void {
  assignFielders(m);
  setUpField(m);
  let slips = 0;
  { let e = placingTable(m); for (let i = 0; i < 10; i++, e += 8) if (m.rw(e + 4) === 1) slips++; }
  m.ww(0xbe1a, slips); m.ww(0xbe1c, w(8 - slips));
  let out = 0xbe1e;
  const mark = (kind: number) => {
    for (;;) {
      const e = entryOfKind(m, kind);
      if (e < 0) break;
      m.ww(e + 4, 3);
      m.wl(out, P(m, recOfPlayer(m, m.rw(e + 6)))); out += 4;
    }
    for (;;) { const e = entryOfKind(m, 3); if (e < 0) break; m.ww(e + 4, kind); } // sub_00BFE2
  };
  mark(0);
  { const e = entryOfKind(m, 2); m.wl(out, P(m, recOfPlayer(m, m.rw(e + 6)))); out += 4; }
  mark(1);
}

/** sub_03515C: the fielding view's field: as above, then each fielder at his placing */
export function placeFielders(m: Ram): void {
  fieldOrder(m);
  assignFielders(m);
  setUpField(m);
  let a1 = placingTable(m);
  for (let i = 0; i < 10; i++, a1 += 8) {
    if (m.rw(a1 + 4) !== 0) continue;
    const a0 = recOfPlayer(m, m.rw(a1 + 6));
    if (a0 < 0) continue;
    let x = m.rw(a1); if (m.rw(0xd2c6) !== 0) x = w(-x);
    m.ww(a0 + 0x34, x);
    m.ww(a0 + 0x36, m.rw(a1 + 2));
    m.ww(a0 + 0x3a, 1);
  }
}
