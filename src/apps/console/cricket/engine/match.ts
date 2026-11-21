// Full match rules (phase 4): the original's match loop around one delivery.
//
//   sub_00D960 (match) -> sub_00DA70 (innings) -> sub_00DC2C (overs) -> sub_00DDE2 (balls of an over)
//   -> sub_00E13E (one delivery: the engine in engine.ts, then the fielding view in fielding.ts)
//
// Everything lives in the original's RAM: the match struct at $BE68 (accessors $C2A0-$C910), the two
// teams' player records ($B51C batting, $B522 fielding; stride $68, +6 = position / role), the scorecard
// counters in those records. The screens between balls (wicket, end of the over, lunch ...) are the
// page's; the original's logic around them is ported here and checked against emulator recordings of
// whole matches (tools/checkMatch.ts).

import { Ram, ROM } from "./mem";
import { Engine, Input, EndReason } from "./engine";
import { Context } from "./context";
import { FieldView, placings } from "./fielding";
import { padFrame, padPresses } from "./pads";
import { setUpField, placeFielders, fieldOrder, assignFielders, rankPlayers } from "./teams";
import { aiTablesForBowler } from "./aiBatsman";
import { meterReset } from "./delivery";
import { setHandedness } from "./batsman";
import { muls, divs } from "./m68k";
import { w, l } from "./m68k";
import { rngNextAt } from "./rngAt";

export const MATCH = 0xbe68;
const REC = 0x68;

// ---------------------------------------------------------------- match struct accessors ($C2A0-$C910)

const mw = (m: Ram, o: number) => m.rw(MATCH + o);
const setMw = (m: Ram, o: number, v: number) => m.ww(MATCH + o, v);
/** sub_00C61A / sub_00C60C: innings number (+$2C) */
export const inningsNo = (m: Ram) => mw(m, 0x2c);
/** the per-innings slot (sub_00C3E0 & co.): +$2C, flipped for the second innings when +$0A (follow-on) is set */
export function slot(m: Ram, inn = inningsNo(m)): number {
  return inn >= 2 && mw(m, 0xa) !== 0 ? inn ^ 1 : inn;
}
/** sub_00C3E0: this innings' total */
export const total = (m: Ram, inn = inningsNo(m)) => mw(m, 0x3e + 2 * slot(m, inn));
/** sub_00C6A4: wickets down in this innings minus one (-1 = none down, 9 = all out) */
export const wicketsIdx = (m: Ram, inn = inningsNo(m)) => mw(m, 0x54 + 2 * slot(m, inn));
/** sub_00C80E: balls in this over */
export const ballsInOver = (m: Ram) => mw(m, 0x30);
/** sub_00C75E: overs bowled in this innings */
export const oversDone = (m: Ram) => mw(m, 0x2e);

// ---------------------------------------------------------------- players

/** sub_00BF1E(d0): the batting side's record whose position (+6) is d0 (1 striker, 2 non-striker);
 *  $BE18 = its index. Returns the record address (or the one after the last when not found). */
export function batsmanAt(m: Ram, pos: number): number {
  let a1 = m.rl(0xb51c) & 0xffff;
  m.ww(0xbe18, 0);
  for (;;) {
    if (m.rw(a1 + 6) === w(pos)) return a1;
    a1 += REC;
    if (m.aw(0xbe18, 1) === 0xb) return a1;
  }
}
/** sub_00B468(d0) / sub_00B3F4: the fielding side's record with role d0 (1 = the bowler) */
export function fielderAt(m: Ram, role: number): number {
  let a1 = m.rl(0xb522) & 0xffff;
  m.ww(0xbe18, 0);
  for (;;) {
    if (m.rw(a1 + 6) === w(role)) return a1;
    a1 += REC;
    if (m.aw(0xbe18, 1) === 0xb) return a1;
  }
}

/** The values the delivery engine reads through player-record pointers (export.py context()) */
export function contextFromRam(m: Ram): Context {
  const striker = batsmanAt(m, 1);
  const battr = m.rl(striker + 2) & 0xffff;
  const bowler = fielderAt(m, 1);
  const wattr = m.rl(bowler + 2) & 0xffff;
  const dfda = m.rl(0xdfda) & 0xffffff;
  return {
    bowler: { a12: m.rw(wattr + 0x12), a14: m.rw(wattr + 0x14) },
    batsman: {
      s1c: m.rw(striker + 0x1c), s18: m.rw(striker + 0x18), a0e: m.rw(battr + 0xe), a10: m.rw(battr + 0x10),
      a12: m.rw(battr + 0x12), a1a: m.rw(battr + 0x1a),
    },
    dfda12: dfda ? ROM.rw(dfda + 0x12) : 0,
    dfda18: dfda ? ROM.rw(dfda + 0x18) : 0,
  };
}

// ---------------------------------------------------------------- one delivery (sub_00E13E)

/** sub_02D83C (from sub_043E4C): this delivery's turn off the pitch, $C5CC = random * $C5C4 */
function pitchTurn(m: Ram): void {
  const r = (rngNextAt(m) & 0x7f) - 0x40;
  m.ww(0xc5cc, w(muls(r, m.rw(0xc5c4)) >> 8));
}

/** sub_00EA96 -> sub_00420C / sub_0041CA: the controllers' modes for this ball; drops all presses */
function controllerModes(m: Ram): void {
  let d2 = 0;
  const side = (ctl: number, d1: number) => {
    if (ctl < 0) return;
    if (ctl === 2) { m.ww(0xfc18 + 4, d1); m.ww(0xfc1e + 4, d1); }
    else m.ww((ctl === 0 ? 0xfc18 : 0xfc1e) + 4, d1);
    let d3 = 1 << (d1 & 7);
    if (ctl !== 0) d3 <<= 2;
    d2 |= d3;
  };
  side(m.rw(0xb526), oversDone(m) & 1);
  side(m.rw(0xb520), m.rw(0xbf08) & 1);
  m.ww(0xfc24, d2); m.ww(0xfc26, d2); m.ww(0xfc2a, 0x33);
  for (const a of [0xfbf8, 0xfc00, 0xfc08, 0xfc10]) m.ww(a + 2, 0);
}

/** The parts of sub_00E13E's set-up the nets never needed (they start after it): the pads, the
 *  pitch's turn (drawn twice: sub_043E4C runs again when the batting view is built, sub_03EA3A), the
 *  runs-off-this-ball word, the field at its placings, the batting-view flags. The rest is
 *  Engine.newDelivery(). */
export function deliveryPrelude(m: Ram): void {
  m.ww(0xcce0, 0);
  m.ww(0xbf10, 0);
  controllerModes(m);
  pitchTurn(m); // sub_043E4C
  meterReset(m); // sub_043FAC
  m.ww(MATCH + 0x32 + 2 * ballsInOver(m), 0); // sub_00C7BE
  setHandedness(m, m.rw(batsmanAt(m, 1) + 0x18) !== 0); // sub_03EA3A: sub_0445CC (sub_04469A)
  placeFielders(m); // sub_03515C, sub_0351BA
  placings(m);
  pitchTurn(m); // sub_043E4C again
  m.ww(0xc8a2, -1); // sub_03AC2E
  m.ww(0x86b2, -1);
  m.ww(0xbf12, 0); m.ww(0xbf14, 0); m.ww(0xbf16, -1); m.ww(0xbf18, 0xf0); m.wl(0xbf1a, 0); // sub_00E6A2
}

export type DeliveryEnd = { reason: EndReason | "field" };

/** Plays one delivery: the batting view, the hand-over and the fielding view, as the practice layer
 *  does, with the pad given per pass (batting view) or per frame (fielding view). */
export class Delivery {
  engine: Engine;
  field: FieldView | null = null;
  done: DeliveryEnd | null = null;
  private handedOver = false;
  fieldSteps = 0;
  /** `hooks`: for checks against the original, whose frames between the views also read the pad */
  constructor(public m: Ram, private hooks: { beforeField?: () => void; afterField?: () => void } = {}) {
    deliveryPrelude(m);
    this.engine = new Engine(m, contextFromRam(m), { kind: "done", reason: "dead" });
    this.engine.newDelivery();
    setUpField(m); // sub_046FA2 (from sub_00E13E): the field for this delivery
  }
  /** one pass (batting view) or one frame (fielding view) */
  step(input: Input): void {
    if (this.done) return;
    if (this.field) {
      // The frame's pad first: the last step's after-the-frame checks (a human fielder holding the
      // ball, his idle count) read it; if they end the view, no step runs.
      padFrame(this.m, input.held);
      this.field.step();
      if (this.field.phase.kind === "done" || this.fieldSteps > 100000) { this.finish({ reason: "field" }); return; }
      this.fieldSteps++;
      return;
    }
    this.engine.step(input);
    const ph = this.engine.phase;
    if (ph.kind === "done") this.ended(ph.reason, input);
  }
  private tailed = false;
  /** the end of the ball-live loop ($E554-$E5A2, $ED2E) */
  private ended(reason: EndReason, input: Input): void {
    const m = this.m;
    if (this.tailed) { this.finish({ reason }); return; }
    if (reason === "dead" || reason === "fielder" || reason === "wicket") {
      // the batting view runs on for a while (sub_00ED82), then sub_04BA84
      this.tailed = true;
      this.engine.tail(reason === "dead" ? (m.rw(0xbeda) !== 0 ? 0x31 : 0x63) : -0x31);
      this.engine.step({ held: input.held, pressed: 0 }); // its first pass (presses so far are dropped)
      return;
    }
    if (!this.handedOver) {
      this.handedOver = true;
      this.engine.handOver();
      this.engine.step({ held: input.held, pressed: 0 });
      return;
    }
    const fv = new FieldView(m, {
      fielding: (r) => padPresses(r, r.rw(0xb526)),
      batting: (r) => padPresses(r, r.rw(0xb520)),
    });
    this.hooks.beforeField?.();
    fv.setup();
    this.hooks.afterField?.();
    this.field = fv;
  }
  private finish(end: DeliveryEnd): void {
    // sub_04BA84: the ball is held (dead)
    this.m.ww(0xe58c, -1); this.m.ww(0xe934, -1);
    this.done = end;
  }
}

// ---------------------------------------------------------------- between balls (sub_00DDE2)

/** sub_00DFFA: the runs off this ball to the batsman and bowler (off the bat), or to the extras */
function creditRuns(m: Ram, runs: number): void {
  const striker = batsmanAt(m, 1);
  const bowler = fielderAt(m, 1);
  if (m.rw(0x8606) !== 0) {
    m.ww(bowler + 0x14, m.rw(bowler + 0x14) + runs);
    m.ww(striker + 0x1c, m.rw(striker + 0x1c) + runs);
  } else if (m.rw(0x8608) !== 0) {
    setMw(m, 0x50, mw(m, 0x50) + runs); // sub_00C4F2
  } else {
    setMw(m, 0x52, mw(m, 0x52) + runs); // sub_00C4BA
  }
}

/** sub_00C3C4: add to this innings' total */
function addTotal(m: Ram, runs: number): void {
  const a = MATCH + 0x3e + 2 * slot(m);
  m.ww(a, m.rw(a) + runs);
}

/** what happened on the ball, for the page */
export interface BallSummary { runs: number; wide: boolean; wicket: number; swapped: boolean; overDone: boolean }

/** The bookkeeping after one delivery inside the over loop (sub_00DDE2 from $DE9E to $DF6A) */
export function afterBall(m: Ram): BallSummary {
  // the match clock (+$BF0A, minutes in 16.16): a ball takes $AAAA in unlimited-overs matches, $6AAA else
  m.wl(0xbf0a, l(m.rl(0xbf0a) + (m.rw(0xbe7a) < 0 ? 0xaaaa : 0x6aaa)));
  const runs = m.rw(MATCH + 0x32 + 2 * ballsInOver(m)); // sub_00C7D2
  m.ww(0xbf0e, m.rw(0xbf0e) + runs);
  const wide = m.rw(0xbeda) !== 0;
  if (!wide) {
    const bowler = fielderAt(m, 1);
    m.aw(bowler + 0x10, 1);
    const b = ballsInOver(m) + 1;
    setMw(m, 0x30, b);
    if (b === 6) {
      m.ww(bowler + 0x10, (m.rw(bowler + 0x10) & 0xfff0) + 0x10);
      if (m.rw(0xbf0e) === 0) m.aw(bowler + 0x12, 1); // a maiden
    }
  }
  const striker = batsmanAt(m, 1);
  m.aw(striker + 0x1a, 1);
  creditRuns(m, runs);
  addTotal(m, runs);
  let swapped = false;
  if (m.rw(0xc7f0) & 1) {
    // the batsmen crossed an odd number of times: the non-striker has the strike
    const a1 = batsmanAt(m, 1);
    const a0 = batsmanAt(m, 2);
    m.ww(a1 + 6, 2); m.ww(a0 + 6, 1);
    m.ww(0xbf08, m.rw(0xbf08) ^ 1);
    m.ww(0xbee0, m.rw(0xbee0) ^ 3);
    m.ww(0xdfde, ~m.rw(0xdfde)); // sub_046864: the computer batsman's shot history follows the striker
    swapped = true;
  }
  return { runs, wide, wicket: m.rw(0xbee2), swapped, overDone: ballsInOver(m) === 6 };
}

/** sub_004C8A: stop the crowd sound */
function crowdQuiet(m: Ram): void { if (m.rw(0xe982) === 0) m.ww(0xfc40, 0); }

/** The wicket's bookkeeping ($DF72-$DF82): fall of wicket, wickets, how out */
function wicketFallen(m: Ram): void {
  crowdQuiet(m);
  // sub_00E038: fall of wicket: the total when it fell
  m.ww(MATCH + 0x5c + 2 * (wicketsIdx(m) + 1), total(m));
  // sub_00C70C: one more down (not past 9)
  if (wicketsIdx(m) !== 9) setMw(m, 0x54 + 2 * slot(m), wicketsIdx(m) + 1);
  // sub_00E05E: the batsman's record: how out (+6, his position becomes 3..6), the bowler, the catcher
  const how = m.rw(0xbee2);
  const out = batsmanAt(m, m.rw(0xbee0));
  m.ww(out + 6, how);
  const creditBowler = () => {
    const b = fielderAt(m, 1); // sub_00E12C
    m.ww(out + 0x22, m.rw(0xbe18));
    m.aw(b + 0x16, 1);
  };
  if (how === 3 || how === 6) creditBowler(); // bowled, lbw
  else if (how === 4) {
    creditBowler(); // caught
    const a2 = m.rl(0xbee4);
    let idx = -1;
    for (const p of [0xe1b4, 0xe1b8, 0xe1bc]) {
      if (a2 === m.rl(p)) { idx = ((m.rl((m.rl(p) & 0xffff) + 0xf6) - m.rl(0xb522)) / REC) | 0; break; }
    }
    if (idx < 0) {
      let a3 = m.rl(0xb522); idx = 0;
      while (a3 !== a2) { a3 = l(a3 + REC); idx++; }
    }
    m.ww(out + 0x24, idx);
  }
}

/** sub_00E04E + sub_0468BC: the next batsman comes in where the out batsman stood */
function nextBatsman(m: Ram): void {
  m.ww(batsmanAt(m, 0) + 6, m.rw(0xbee0));
  const a = m.rw(0xdfde) === 0 ? 0xdff0 : 0xdfe0; // sub_0468DE: the other history
  for (let i = 0; i < 16; i += 4) m.wl(a + i, 0);
}

/** sub_00DFD2: in the last innings, has the side batting passed the other side's total? */
export function targetPassed(m: Ram): boolean {
  if (inningsNo(m) !== mw(m, 0x14)) return false;
  const [d4, , d6] = totals(m);
  return d6 > d4;
}
/** sub_030E00: both sides' runs (d4 first side, d6 second) and wickets (d5, d7) over the match */
export function totals(m: Ram): [number, number, number, number] {
  const run = (inn: number) => total(m, inn), wk = (inn: number) => wicketsIdx(m, inn);
  let d4 = run(0), d5 = wk(0), d6 = run(1), d7 = wk(1);
  if (mw(m, 0x14) !== 1) {
    if (mw(m, 0xa) === 0) { d4 = w(d4 + run(2)); d5 = wk(2); d6 = w(d6 + run(3)); d7 = wk(3); }
    else {
      d4 = w(d4 + run(3)); d5 = wk(3); d6 = w(d6 + run(2)); d7 = wk(2);
      [d4, d6] = [d6, d4]; [d5, d7] = [d7, d5];
    }
  }
  return [d4, d5, d6, d7];
}

/** sub_00C792 / sub_00C77A: the over limit reached? (else one more over done) */
function overLimit(m: Ram): boolean {
  if (mw(m, 0x12) >= 0 && oversDone(m) === mw(m, 0x12)) return true;
  setMw(m, 0x2e, oversDone(m) + 1);
  return false;
}

/** sub_00B3E6 / sub_00B414: the bowler (role 1, $A6BE) and the bowler at the other end ($A6C2, role 0) */
const setBowler = (m: Ram, a: number) => { m.wl(0xa6be, l(0xffff0000 | a)); m.ww(a + 6, 1); };
const setOtherEnd = (m: Ram, a: number) => { m.wl(0xa6c2, l(0xffff0000 | a)); m.ww(a + 6, 0); };
/** sub_00B420: the bowler at the other end ($BE18 = his index, 11 if none) */
function otherEnd(m: Ram): number {
  if (m.rl(0xa6c2) === 0) { m.ww(0xbe18, 0xb); return -1; }
  const a1 = m.rl(0xa6c2) & 0xffff;
  m.ww(0xbe18, ((a1 - (m.rl(0xb522) & 0xffff)) / REC) | 0);
  return a1;
}

/** sub_00DD88: change ends: the batsmen swap ends, the bowlers too, the field is set again */
function changeEnds(m: Ram): void {
  const a0 = batsmanAt(m, 1);
  const a1 = batsmanAt(m, 2);
  m.ww(a0 + 6, 2); m.ww(a1 + 6, 1);
  m.ww(0xdfde, ~m.rw(0xdfde)); // sub_046864
  m.ww(0xbf08, m.rw(0xbf08) ^ 1);
  const bowler = fielderAt(m, 1);
  const other = otherEnd(m);
  setOtherEnd(m, bowler);
  if (other >= 0) setBowler(m, other);
  fieldOrder(m); // sub_00BF5A
}

/** sub_021824: has a bowler with d0 overs reached the limit per bowler ((limit + 1) / 5, at least 1)? */
function atBowlerLimit(m: Ram, overs: number): boolean {
  let d1 = mw(m, 0x12);
  if (d1 < 0) return false;
  d1 = ((d1 + 1) / 5) | 0;
  if (d1 === 0) d1 = 1;
  return overs === d1;
}
const oversOf = (m: Ram, a: number) => (m.rw(a + 0x10) & 0xffff) >> 4;

/** sub_021748 (computer side): the captain's bowling plan ($A6A6: six (player, spell) entries, $A6A4 =
 *  changes so far): a new bowler when the spell is over or the bowler is at the limit */
function computerBowlerChange(m: Ram): void {
  // sub_021858: make sure the bowler is one of the plan's
  otherEnd(m);
  m.ww(0xc2ea, m.rw(0xbe18));
  fielderAt(m, 1);
  m.ww(0xc2e8, m.rw(0xbe18));
  const inPlan = (idx: number) => { for (let k = 0; k < 6; k++) if (m.rw(0xa6a6 + 4 * k) === idx) return 0xa6a6 + 4 * k; return -1; };
  if (inPlan(m.rw(0xc2e8)) < 0) {
    let e = 0xa6a6 + 4 * 6;
    for (let k = 0; k < 6; k++) if (m.rw(0xa6a6 + 4 * k) !== m.rw(0xc2ea)) { e = 0xa6a6 + 4 * k; break; }
    const idx = m.rw(e);
    m.ww(0xc2e8, idx);
    setBowler(m, (m.rl(0xb522) & 0xffff) + REC * idx);
  }
  const bowler = fielderAt(m, 1);
  let e = 0xa6a6;
  for (let k = 0; k < 6; k++, e += 4) if (m.rw(e) === m.rw(0xbe18)) break;
  const overs = oversOf(m, bowler);
  const spell = w(muls(w(((m.rw(0xa6a4) / 6) | 0) + 1), m.rw(e + 2)));
  if (overs !== spell && !atBowlerLimit(m, overs)) return;
  m.ww(fielderAt(m, 1) + 6, 0);
  for (;;) {
    const rem = m.rw(0xa6a4) % 6;
    const idx = m.rw(0xa6a6 + 4 * rem);
    const a1 = (m.rl(0xb522) & 0xffff) + REC * idx;
    if (l(0xffff0000 | a1) !== m.rl(0xa6c2) && !atBowlerLimit(m, oversOf(m, a1))) {
      setBowler(m, a1);
      m.aw(0xa6a4, 1);
      return;
    }
    m.aw(0xa6a4, 1);
  }
}

// ---------------------------------------------------------------- the match flow

/** What the flow stops for. The page answers "delivery" by playing a Delivery on the same RAM. */
export type MatchEvent =
  | { kind: "delivery" }
  | { kind: "ball"; ball: BallSummary }
  | { kind: "wicket"; how: number; batsman: number }
  | { kind: "overEnd" }
  | { kind: "chooseBowler"; forced: boolean }
  | { kind: "chooseOpeningBowlers" }
  | { kind: "rain" }
  | { kind: "interval"; which: "lunch" | "tea" }
  | { kind: "dayEnd"; day: number }
  | { kind: "lastDayEnd" }
  | { kind: "declared" }
  | { kind: "followOn" }
  | { kind: "inningsStart" }
  | { kind: "inningsEnd" }
  | { kind: "matchEnd"; result: MatchResult };

/** sub_00DDE2: one over. `resume`: start at a delivery (the RAM is at sub_00E13E's entry). */
export function* overFlow(m: Ram, resume = false): Generator<MatchEvent, void, number | undefined> {
  if (!resume) {
    setMw(m, 0x30, 0); // sub_00C7FE
    for (const a of [0xd292, 0xbf0e, 0xbed8, 0xd1fe, 0xd200]) m.ww(a, 0);
    if (m.rw(0xb526) < 0) computerBowlerChange(m); // sub_021748
    else if (mw(m, 0x12) >= 0 && atBowlerLimitOrPast(m)) {
      // the human captain must change bowlers (sub_021534): the page answers with the player's index
      const idx = yield { kind: "chooseBowler", forced: true };
      m.ww(fielderAt(m, 1) + 6, 0);
      if (idx !== undefined) setBowler(m, (m.rl(0xb522) & 0xffff) + REC * idx);
    }
    aiTablesForBowler(m, contextFromRam(m)); // sub_04630A
    // sub_041C9A: rain stops play, once: on the forecast day ($C5E2) when the clock passes $C5E4
    if (m.rw(0xc5e2) >= 0 && mw(m, 0x28) === m.rw(0xc5e2) && m.rw(0xbf0a) >= m.rw(0xc5e4)) {
      rainScene(m);
      yield { kind: "rain" };
      m.ww(0xc5e2, -1); m.ww(0xe98a, -1);
      m.ww(MATCH + 0x32 + 2 * ballsInOver(m), 0); // (the scene sets up a delivery: sub_00C7BE)
      if (m.rw(0xbedc) === 0 && m.rw(0xbf0a) >= 0x2fd) m.ww(0xbedc, -1); // lunch has gone
      if (m.rw(0xbede) === 0 && m.rw(0xbf0a) >= 0x39d) m.ww(0xbede, -1); // tea has gone
      setMw(m, 0x22, Math.min(mw(m, 0x22) + 2, 4)); // a wetter pitch
    }
  }
  for (;;) {
    if (!resume) {
      m.ww(0xbeda, 0); m.ww(0xbee2, 0); m.ww(0xbf10, -1);
      yield { kind: "delivery" };
    }
    resume = false;
    const ball = afterBall(m);
    yield { kind: "ball", ball };
    if (ball.wicket) {
      wicketFallen(m);
      yield { kind: "wicket", how: ball.wicket, batsman: m.rw(0xbee0) };
      if (wicketsIdx(m) === 9) break; // all out
      nextBatsman(m);
    }
    if (ballsInOver(m) === 6 || targetPassed(m)) break;
  }
  crowdQuiet(m);
}
/** sub_041D5A: the rain scene. The covers come on and the clock runs while the rain meter ($D10A) is up:
 *  the meter starts at 4, rises to 255, holds for 128 steps and falls; the clock runs an hour a step
 *  while it is at $90 or more (129 steps), then slows down over 64 more (sub_042C62, sub_04302E). The
 *  meter has no randomness, so the scene always takes 10:08 (+$A08000) plus whatever rate the last scene
 *  left ($D13C, 0 after a scene). The rest of the scene is the original's display. */
export function rainScene(m: Ram): void {
  m.wl(0xbf0a, l(m.rl(0xbf0a) + m.rl(0xd13c))); // sub_042C62's first sub_042FA4
  m.wl(0xd134, m.rl(0xbf0a));
  m.wl(0xbf0a, l(m.rl(0xbf0a) + 0xa08000));
  m.wl(0xd13c, 0);
  m.wl(0xd138, l(m.rl(0xbf0a) - m.rl(0xd134)));
}
function atBowlerLimitOrPast(m: Ram): boolean {
  let d1 = mw(m, 0x12);
  d1 = ((d1 + 1) / 5) | 0;
  if (d1 === 0) d1 = 1;
  return oversOf(m, fielderAt(m, 1)) >= d1;
}

/** sub_021B34: may this player of the fielding side be picked in the bowler menu? `forced`: the bowler has
 *  bowled his limit and a new one is needed now ("Please Select A New Bowler"); otherwise the captain
 *  changes who bowls the next over ("change next bowler"). Not the bowler or the keeper, not past the
 *  limit of a fifth of the innings' overs, and for a forced change not the bowler at the other end. */
export function canBowl(m: Ram, idx: number, forced: boolean): boolean {
  const a0 = (m.rl(0xb522) & 0xffff) + REC * idx;
  const role = m.rw(a0 + 6);
  // (for a forced change the menu first takes the ball from the bowler: he is past the limit anyway)
  if (role !== 0 && role !== 3 && !(forced && role === 1)) return false;
  const otherEnd = (m.rl(0xa6c2) & 0xffff) === a0;
  if (otherEnd) return !forced;
  if (mw(m, 0x12) < 0) return true;
  let cap = ((mw(m, 0x12) + 1) / 5) | 0;
  if (cap === 0) cap = 1;
  return oversOf(m, a0) < cap;
}

/** sub_021534 from the in-match menu: the captain names the bowler of the next over (sub_00B414) */
export function setNextBowler(m: Ram, idx: number): boolean {
  if (!canBowl(m, idx, false)) return false;
  setOtherEnd(m, (m.rl(0xb522) & 0xffff) + REC * idx);
  return true;
}

/** sub_00DC2C: the overs of an innings */
export function* inningsOvers(m: Ram, resume = false): Generator<MatchEvent, void, number | undefined> {
  if (!resume) { m.wl(0xbf82, 0); m.wl(0xbf7e, 0); } // sub_00F56E: the camera
  for (;;) {
    if (m.rw(0xc61a) !== 0) break;
    yield* overFlow(m, resume);
    resume = false;
    if (m.rw(0x86b0) !== 0) break;
    m.wl(0xbf0a, l(m.rl(0xbf0a) + (m.rw(0xbe7a) < 0 ? 0x10000 : 0xaaaa)));
    m.wl(0xbf0a, l(m.rl(0xbf0a) + (rngNextAt(m) & 0x7fff)));
    m.wl(0xbf0a, l(m.rl(0xbf0a) + (rngNextAt(m) & 0x7fff)));
    if (wicketsIdx(m) === 9 || targetPassed(m) || overLimit(m)) break;
    yield { kind: "overEnd" };
    if (computerDeclares(m)) yield { kind: "declared" }; // sub_04DBC0
    if (mw(m, 0x46 + 2 * slot(m)) !== 0) break; // sub_00C512: declared
    changeEnds(m);
    if (m.rw(0xe982) !== 0) m.ww(0xe98a, 0);
    // lunch, tea, close of play (sub_02F606 / 02F74E / 02F896)
    if (interval(m, 0xbedc, 0x30c, 0x334)) yield { kind: "interval", which: "lunch" };
    if (interval(m, 0xbede, 0x3ac, 0x3c0)) yield { kind: "interval", which: "tea" };
    yield* closeOfPlay(m);
  }
  m.wl(0xbf0a, l(m.rl(0xbf0a) + 0xf0000));
}

/** sub_02F606 (lunch: at 13:00 the clock goes to 13:40) / sub_02F74E (tea: 15:40 -> 16:00), once a day.
 *  The clock's minutes are the high word of $BF0A (11:00 = $294); only that word is set. */
function interval(m: Ram, flag: number, at: number, resume: number): boolean {
  if (m.rw(flag) !== 0 || m.rw(0xbf0a) < at) return false;
  m.ww(0xbf0a, resume);
  m.ww(flag, -1);
  m.ww(0xe98a, -1);
  return true;
}

/** sub_04DBC0: does the computer captain of the batting side declare, at the end of an over? Only in
 *  matches of unlimited overs. Days left (after today) count 400 runs (one innings a side) or 350, and the
 *  time left today to 18:00 350 runs per 10 hours.
 *  - one innings a side, first innings: declare at that many runs, or at 300 a day left + today's share
 *    with at least 250 on the board;
 *  - two innings a side: the first innings at 500; the second when the lead is 50 + 50 a day left;
 *    the third (the side that batted first, unless they followed on) when the lead is the runs left. */
export function computerDeclares(m: Ram): boolean {
  if (m.rw(0xb520) >= 0 || m.rw(0xbe7a) >= 0 || m.rw(0xc2de) !== 0) return false;
  const daysLeft = Math.max(0, w(mw(m, 0xe) - mw(m, 0x28)));
  const today = () => divs(w(muls(Math.max(0, w(0x438 - m.rw(0xbf0a))), 0x15e)), 0x258).q;
  let declare = false;
  if (mw(m, 0x14) === 1) {
    if (inningsNo(m) !== 0) return false;
    const t = today();
    const d7 = w(muls(daysLeft, 0x190) + t), d6 = w(muls(daysLeft, 0x12c) + t);
    const tot = total(m);
    declare = tot >= d7 || (tot >= 0xfa && tot >= d6);
  } else {
    const inn = inningsNo(m);
    if (inn === 0) declare = total(m) >= 0x1f4;
    else if (inn === 1) {
      const [d4, , d6] = totals(m);
      const lead = w(d6 - d4);
      declare = lead >= 0 && lead >= w(muls(daysLeft, 0x32) + 0x32);
    } else {
      if ((mw(m, 0xa) !== 0 ? inn ^ 1 : inn) !== 2) return false;
      const [d4, , d6] = totals(m);
      const lead = w(d4 - d6);
      declare = lead >= 0 && lead >= w(muls(daysLeft, 0x15e) + today());
    }
  }
  if (declare) setMw(m, 0x46 + 2 * slot(m), -1); // sub_00C58A
  return declare;
}

/** sub_04B52A: before the third innings, a human-controlled $B520 (the side that batted last) is asked
 *  whether the follow-on is enforced when the first innings' lead is at least 75 / 100 / 150 / 150 / 200
 *  runs for a 1- to 5-day match (ROM $4B608). The computer never enforces it. (Not yet seen in a
 *  recording: the condition is ported from the code as it reads.) */
export function followOnOffered(m: Ram): boolean {
  if (m.rw(0xb520) < 0 || inningsNo(m) !== 2) return false;
  const lead = w(total(m, 0) - total(m, 1));
  if (lead < 0) return false;
  const days = Math.max(0, Math.min(4, mw(m, 0xe)));
  return lead >= [75, 100, 150, 150, 200][days];
}

/** The human captain declares (the in-match menu's DECLARE): the innings ends when the over in progress
 *  is over, where the original tests the flag (sub_00C512 at $DD38). Only in matches of unlimited overs
 *  and for the side batting. */
export function humanDeclares(m: Ram): boolean {
  if (m.rw(0xbe7a) >= 0 || m.rw(0xb520) < 0) return false;
  setMw(m, 0x46 + 2 * slot(m), -1);
  return true;
}

/** sub_00C356: is this the match's last day (+$28 = +$E; not when the days are unlimited)? */
const lastDay = (m: Ram) => mw(m, 0xe) >= 0 && mw(m, 0x28) === mw(m, 0xe);

/** sub_00DBDC: a new day (or the match's start): no lunch or tea taken yet, the clock at 11:00 (10:30 on
 *  the first day of a 60-over match; sub_00DBEA) */
function dayStart(m: Ram): void {
  m.ww(0xbedc, 0); m.ww(0xbede, 0);
  m.wl(0xbf0a, m.rw(0xbe7a) === 0x3b && m.rw(0xbe76) === 0 ? 0x2760000 : 0x2940000);
}

/** sub_02F896: close of play. Stumps at 20:00, or 18:00 in a match of more than one day or of unlimited
 *  overs when $C418 is set (then also in a short limited-overs day: $5460 / ((overs + 1) * 2 per innings)
 *  minutes per over of more than 3 hours). The next day starts at 11:00 with a new pitch report; at the
 *  end of the last day the match is drawn unless the players choose to play on (the original asks:
 *  "CONTINUE MATCH" / "END MATCH"; the page answers the event with 1 to continue). */
function* closeOfPlay(m: Ram): Generator<MatchEvent, void, number | undefined> {
  let at = 0x4b0;
  if (m.rw(0xc418) !== 0) {
    if (m.rw(0xbe76) !== 0 || m.rw(0xbe7a) < 0) at = 0x438;
    else {
      let d0 = w(m.rw(0xbe7a) + 1) * 2;
      if (m.rw(0xbe7c) !== 1) d0 *= 2;
      if (divs(0x5460, d0).q <= 0xb4) at = 0x438;
    }
  }
  if (m.rw(0xbf0a) < at) return;
  m.ww(0xe98a, -1);
  if (mw(m, 0xc) === 0 && lastDay(m)) {
    // "Match Drawn (Tied) Innings Incomplete", then CONTINUE MATCH / END MATCH ($C07E; sub_02FC9E)
    const answer = yield { kind: "lastDayEnd" };
    if (answer !== 1) { m.ww(0xc61a, -1); return; }
    setMw(m, 0xc, -1); // sub_00C300: no more days: play on to a result
    dayStart(m);
    pitchAndWeather(m); // sub_02DA60 (the pitch report)
    return;
  }
  yield { kind: "dayEnd", day: mw(m, 0x28) };
  if (!lastDay(m)) setMw(m, 0x28, mw(m, 0x28) + 1); // sub_00C33E
  dayStart(m);
  pitchAndWeather(m); // sub_02DA60
}

// ---------------------------------------------------------------- between innings (sub_00DA70)

const fieldRec = (m: Ram, i: number) => (m.rl(0xb522) & 0xffff) + REC * i;
const hiWord = (v: number) => w(l(v) >> 16);

/** sub_02D918: will it rain? $C5E0 the chance, $C5E2 the day (-1: no rain), $C5E4 the time of day */
function weather(m: Ram): void {
  if (m.rw(0xc418) !== 0) { m.ww(0xc5e2, -1); return; }
  let d7 = divs(muls(w(mw(m, 0xe) + 1), 0x60), 5).q;
  const limits = [0x13, 0x27, 0x31, 0x36, 0x3b, 0x59];
  let d0 = limits.indexOf(mw(m, 0x12)) + 1;
  if (d0 === 0) d0 = 7;
  d7 = w(d7 + divs(muls(d0, 0x60), 7).q);
  if (mw(m, 0x14) !== 1) d7 = w(d7 + 0x20);
  d7 = w(d7 + (rngNextAt(m) & 0x1f));
  d7 = (d7 & 0xffff) >>> 1;
  d7 = w(d7 + ROM.rw(0x2da50 + 2 * mw(m, 0x24)));
  if (d7 < 3) d7 = 3;
  if (d7 > 0x100) d7 = 0x100;
  m.ww(0xc5e0, d7);
  d7 = w(d7 + d7);
  if ((rngNextAt(m) & 0xff) > d7) { m.ww(0xc5e2, -1); return; }
  const scaled = (k: number) => hiWord(l(muls(rngNextAt(m) & 0x7fff, k) * 2 + 0x7fff));
  m.ww(0xc5e2, w(scaled(w(mw(m, 0xe) + 1)) - 1));
  if (w(rngNextAt(m)) < 0) m.ww(0xc5e4, w(scaled(0x28) + 0x2c1));
  else m.ww(0xc5e4, w(scaled(0x3c) + 0x361));
}

/** sub_02D8A2: the pitch's values for this stage of the match ($C5BA.. bounce, turn; a copy at $C5CE),
 *  the outfield by the weather, then the rain forecast */
export function pitchAndWeather(m: Ram): void {
  const a0 = ROM.rl(0x2d718 + 4 * mw(m, 0x22));
  for (let i = 0; i < 0x12; i += 2) m.ww(0xc5ce + i, ROM.rw(a0 + i));
  for (let i = 0; i < 9; i++) m.ww(0xc5ba + 2 * i, ROM.rw(a0 + 2 * i));
  const d0 = ROM.rw(0x2d908 + 2 * mw(m, 0x24));
  m.ww(0xc5c8, d0); m.ww(0xc5de, d0);
  weather(m);
}

/** sub_00BEAA: a side's records start an innings clean (batting and bowling figures) */
function clearRecords(m: Ram, a0: number): void {
  for (let k = 0; k < 11; k++, a0 += REC) {
    for (const o of [6, 0x10, 0x12, 0x14, 0x16, 0x1a, 0x1c, 0x1e, 0x20]) m.ww(a0 + o, 0);
    m.ww(a0 + 0xc, 3);
  }
}

/** sub_00BE66: who bats and who fields in this innings ($B51C / $B522 the sides' records, $B520 / $B526
 *  their controllers) */
function swapSides(m: Ram): void {
  // sub_00BEEC: the toss (+8), flipped by the follow-on (+$A) and by the innings' parity
  let d1 = mw(m, 8);
  const inn = inningsNo(m);
  if (inn >= 2) d1 ^= mw(m, 0xa);
  if (inn & 1) d1 = ~d1;
  const side = (sel: number, recPtr: number, ctl: number) => {
    m.ww(0xb518, sel);
    const a0 = w(sel) === 0 ? 0xb528 : 0xb9a0;
    m.wl(recPtr, l(0xffff0000 | a0));
    m.ww(ctl, w(sel) !== 0 ? mw(m, 6) : mw(m, 2));
    clearRecords(m, a0);
  };
  side(w(d1), 0xb51c, 0xb520);
  side(w(~d1), 0xb522, 0xb526);
}

/** sub_020598: the first two in the batting order open */
function openers(m: Ram): void {
  m.ww(batsmanAt(m, 0) + 6, 1);
  m.ww(batsmanAt(m, 0) + 6, 2);
}

/** sub_00B1F4: the keeper and the opening bowlers; the computer captain also makes his plan
 *  (sub_00B258: six bowlers at $A6A6 with the length of their spells) */
function openingBowlers(m: Ram): void {
  // sub_00B3C2
  { m.ww(0xbe18, 0); let a1 = fieldRec(m, 0), found = -1;
    for (;;) { if (m.rw(a1 + 6) === 1) { found = a1; break; } a1 += REC; if (m.aw(0xbe18, 1) === 0xb) break; }
    if (found >= 0) { m.ww(found + 6, 0); m.wl(0xa6be, 0); }
    m.wl(0xa6c2, 0); }
  if (m.rw(0xb526) >= 0) {
    // a human captain: the two best opening bowlers until he chooses (sub_0210FE is the page's screen)
    rankPlayers(m, 0x53684);
    setBowler(m, fieldRec(m, m.rw(0xa678)));
    setOtherEnd(m, fieldRec(m, m.rw(0xa67a)));
    rankPlayers(m, 0x536ae);
    m.ww(fieldRec(m, m.rw(0xa678)) + 6, 4);
    return;
  }
  rankPlayers(m, 0x536ae);
  m.ww(fieldRec(m, m.rw(0xa678)) + 6, 4);
  let a1 = 0xa6a6;
  const take = (wt: number, n: number) => { // sub_00B306
    rankPlayers(m, wt);
    for (let k = 0; k < n; k++) {
      const idx = m.rw(0xa678 + 2 * k);
      m.ww(a1, idx); m.ww(a1 + 2, 0); a1 += 4;
      m.ww(fieldRec(m, idx) + 6, 1);
    }
  };
  take(0x53684, 2); take(0x53692, 1); take(0x536a0, 2); take(0x53692, 1);
  for (let k = 0; k < 6; k++) m.ww(fieldRec(m, m.rw(0xa6a6 + 4 * k)) + 6, 0);
  // sub_00B32C: the spells: half the bowler's share for a fast bowler, a quarter otherwise, less one at random
  let d6 = mw(m, 0x12);
  if (d6 < 0) d6 = 0x5a;
  d6 = divs(d6, 5).q;
  for (let k = 0; k < 6; k++) {
    const attr = m.rl(fieldRec(m, m.rw(0xa6a6 + 4 * k)) + 2) & 0xffff;
    let t = m.rw(attr + 0x14); if (t < 0) t = w(-t);
    const d1 = (d6 & 0xffff) >>> (t === 1 ? 1 : 2);
    let d0 = w(d1 + (w(rngNextAt(m)) < 0 ? -1 : 0));
    if (d0 < 1) d0 = 1;
    m.aw(0xa6a6 + 4 * k + 2, d0);
  }
  setBowler(m, fieldRec(m, m.rw(0xa6a6)));
  setOtherEnd(m, fieldRec(m, m.rw(0xa6aa)));
  m.ww(0xa6a4, 2);
}

/** sub_00C086: fill in every possible bowler's field with players (the keeper stays the keeper) */
function fieldsForAllBowlers(m: Ram): void {
  let keeper = -1;
  for (let k = 0; k < 11; k++) if (m.rw(fieldRec(m, k) + 6) === 4) { keeper = fieldRec(m, k); break; }
  if (keeper < 0) { rankPlayers(m, 0x536ae); keeper = fieldRec(m, m.rw(0xa678)); }
  m.wl(0xbe4a, l(0xffff0000 | keeper));
  for (let k = 0; k < 11; k++) { m.ww(0xbe4e + 2 * k, m.rw(fieldRec(m, k) + 6)); m.ww(fieldRec(m, k) + 6, 0); }
  for (let k = 0; k < 11; k++) {
    const a0 = fieldRec(m, k);
    if (a0 === keeper) continue;
    m.ww(a0 + 6, 1);
    assignFielders(m);
    m.ww(a0 + 6, 0);
  }
  for (let k = 0; k < 11; k++) m.ww(fieldRec(m, k) + 6, m.rw(0xbe4e + 2 * k));
}

/** sub_00DA70: the innings of a match, one after the other. `resume`: the RAM is at a delivery. */
export function* matchInnings(m: Ram, resume = false): Generator<MatchEvent, void, number | undefined> {
  if (!resume) {
    dayStart(m); // sub_00DBDC
  }
  for (;;) {
    if (!resume) {
      if (m.rw(0x86b0) !== 0) return;
      setMw(m, 0x4e, 0); setMw(m, 0x52, 0); setMw(m, 0x50, 0); // the extras
      if (followOnOffered(m)) {
        // sub_04B52A: the captain may enforce the follow-on (the page answers 1 to enforce it)
        const answer = yield { kind: "followOn" };
        if (answer === 1) setMw(m, 0xa, -1);
      }
      swapSides(m);
      openers(m); // sub_0203EA: a human captain's batting order is the page's screen
      openingBowlers(m);
      if (m.rw(0xb526) >= 0) {
        // sub_0210FE: a human captain names his opening bowlers (answer: first | second << 8, players'
        // indices in his side); left alone, the two best stay
        const pick = yield { kind: "chooseOpeningBowlers" };
        if (pick !== undefined) {
          m.ww(fielderAt(m, 1) + 6, 0);
          setBowler(m, fieldRec(m, pick & 0xff));
          setOtherEnd(m, fieldRec(m, (pick >> 8) & 0xff));
        }
      }
      m.ww(0xc11e, 0);
      m.ww(0xdfde, 0); // sub_046856: the computer batsmen's shot histories
      for (let i = 0; i < 32; i += 4) m.wl(0xdfe0 + i, 0);
      fieldsForAllBowlers(m);
      fieldOrder(m);
      placeFielders(m); placings(m);
      setMw(m, 0x2e, 0);
      m.ww(0xe982, 0); m.ww(0xe984, 0);
      yield { kind: "inningsStart" };
    }
    yield* inningsOvers(m, resume);
    resume = false;
    yield { kind: "inningsEnd" }; // (the scorecard is whole here: the next innings' set-up clears the records)
    m.ww(0xe982, 0);
    if (m.rw(0xc61a) !== 0 || m.rw(0x86b0) !== 0) return;
    if (inningsNo(m) === mw(m, 0x14)) return; // sub_00C628: that was the last innings
    setMw(m, 0x2c, inningsNo(m) + 1);
    if (targetPassed(m)) return;
    m.ww(0xc594, 1); // sub_00DC18 (career figures, the saved game's checksum: not kept)
    pitchAndWeather(m); // sub_02D8A2, and again from the pitch report (sub_02DA60)
    pitchAndWeather(m);
    if (targetPassed(m)) return;
    if (!(m.rw(0xbedc) !== 0 && m.rw(0xbf0a) === 0x334)) m.wl(0xbf0a, l(m.rl(0xbf0a) + 0xa0000));
  }
}

/** how the match ended, for the side batting last (`batting`) or the side fielding last */
export interface MatchResult { kind: "runs" | "wickets" | "innings" | "tie" | "draw"; margin: number; winner: "batting" | "fielding" | null }

/** sub_02380E: the result ("England Win By 23 Runs", "... By 7 Wickets", "... By An Innings", "The Match
 *  Is A Tie", "The Match Is Drawn"). The award of a tied or drawn cup match (fewer wickets lost, or a
 *  coin) is left out. */
export function matchResult(m: Ram): MatchResult {
  const [d4, , d6, d7] = totals(m);
  if (m.rw(0xc61a) === 0 && d6 !== d4) {
    if (d4 > d6) return { kind: "runs", margin: w(d4 - d6), winner: "fielding" };
    if (total(m) !== 0) return { kind: "wickets", margin: 9 - d7, winner: "batting" };
    return { kind: "innings", margin: 0, winner: "fielding" };
  }
  return { kind: m.rw(0xc61a) === 0 ? "tie" : "draw", margin: 0, winner: null };
}

/** sub_00D960 from its innings loop on: the whole match, then the result */
export function* matchFlow(m: Ram, resume = false): Generator<MatchEvent, void, number | undefined> {
  yield* matchInnings(m, resume);
  if (m.rw(0x86b0) !== 0) return; // abandoned from the menu
  yield { kind: "matchEnd", result: matchResult(m) };
}

/** sub_00D960 between the toss and the innings loop: the match's counters start clean. The match
 *  settings (teams, controllers, +8 who bats first, +$12 overs, pitch, weather) are already in the struct. */
export function matchStart(m: Ram): void {
  m.ww(0x86b0, 0); m.ww(0xbf08, 0); m.ww(0xc61a, 0); m.ww(0xd294, 0);
  if (mw(m, 0x10) === 0) m.ww(0xbf06, 0);
  // sub_00C5E4: first innings, no wickets, no runs, no extras, nothing declared, no follow-on
  setMw(m, 0x2c, 0);
  m.wl(MATCH + 0x54, -1); m.wl(MATCH + 0x58, -1);
  m.wl(MATCH + 0x3e, 0); m.wl(MATCH + 0x42, 0);
  setMw(m, 0x4e, 0); setMw(m, 0x52, 0); setMw(m, 0x50, 0);
  m.wl(MATCH + 0x46, 0); m.wl(MATCH + 0x4a, 0);
  setMw(m, 0xa, 0);
  setMw(m, 0xc, 0); // sub_00C2F2
  for (let i = 0; i < 4; i++) m.ww(0x695c + 2 * i, mw(m, 0x18)); // sub_0125BC: fielding by hand, per controller
  setMw(m, 0x28, 0); // sub_00C322: the first day
}
