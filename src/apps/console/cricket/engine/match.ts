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
import { setUpField, placeFielders, fieldOrder } from "./teams";
import { aiTablesForBowler } from "./aiBatsman";
import { meterReset } from "./delivery";
import { setHandedness } from "./batsman";
import { muls } from "./m68k";
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
  constructor(public m: Ram) {
    deliveryPrelude(m);
    this.engine = new Engine(m, contextFromRam(m), { kind: "done", reason: "dead" });
    this.engine.newDelivery();
    setUpField(m); // sub_046FA2 (from sub_00E13E): the field for this delivery
  }
  /** one pass (batting view) or one frame (fielding view) */
  step(input: Input): void {
    if (this.done) return;
    if (this.field) {
      padFrame(this.m, input.held);
      this.field.step();
      this.fieldSteps++;
      if (this.field.done || this.fieldSteps > 100000) this.finish({ reason: "field" });
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
    fv.setup();
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
  | { kind: "inningsEnd" }
  | { kind: "matchEnd" };

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
function atBowlerLimitOrPast(m: Ram): boolean {
  let d1 = mw(m, 0x12);
  d1 = ((d1 + 1) / 5) | 0;
  if (d1 === 0) d1 = 1;
  return oversOf(m, fielderAt(m, 1)) >= d1;
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
    // sub_04DBC0: the computer captain may declare (unlimited overs, phase 4b)
    if (mw(m, 0x46 + 2 * slot(m)) !== 0) break; // sub_00C512: declared
    changeEnds(m);
    // lunch, tea, close of play (sub_02F606 / 02F74E / 02F896): phase 4b
  }
  m.wl(0xbf0a, l(m.rl(0xbf0a) + 0xf0000));
}
