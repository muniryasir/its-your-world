// The toss (sub_02E0A8), for a match with a human side (in a spectate match the original has no toss:
// the first team bats). Who calls: the human, or a random side when both or neither are human
// ($C5E6: 0 the first side, -1 the second); the call ($C5E8: the human's, or random); the coin
// (sub_02EE08 spins it, sub_02E5FC decides it: $C5FE); the winner chooses to bat or bowl (the computer
// bats with a chance of $50 in $100). +8 = 0 when the first side bats.
import { Ram } from "./mem";
import { rngNextAt } from "./rngAt";
import { MATCH } from "./match";

/** what the toss asks the human: call heads (0) or tails (1); bat (0) or bowl (1) */
export type TossQuestion = { kind: "tossCall" } | { kind: "tossChoice" };
export interface TossResult { caller: 0 | 1; winner: 0 | 1; batFirst: 0 | 1; heads: boolean }

const sign = (v: number) => ((v & 0x8000) !== 0 ? -1 : 0); // ext.l / swap: the random word's sign

export function* toss(m: Ram): Generator<TossQuestion, TossResult, number | undefined> {
  const c2 = m.rw(MATCH + 2), c6 = m.rw(MATCH + 6);
  // sub_02E194: who calls, and (no human) the call
  if (c2 >= 0 && c6 < 0) m.ww(0xc5e6, 0);
  else if (c2 < 0 && c6 >= 0) m.ww(0xc5e6, -1);
  else m.ww(0xc5e6, sign(rngNextAt(m)));
  if ((c2 & c6) < 0) m.ww(0xc5e8, sign(rngNextAt(m)));
  else { const a = yield { kind: "tossCall" }; m.ww(0xc5e8, a === 1 ? -1 : 0); }
  // sub_02EE08 (the coin spins: a first draw), sub_02E5FC (where it lands)
  m.ww(0xc5fe, (rngNextAt(m) & 0x7fff) <= 0x4000 ? -1 : 0);
  m.ww(0xc5fe, (rngNextAt(m) & 0x3fff) < 0x2000 ? -1 : 0);
  // sub_02EBFC: the first side wins when coin, caller and call agree; sub_02EC72: the winner's choice
  const first = (m.rw(0xc5fe) ^ m.rw(0xc5e6) ^ m.rw(0xc5e8)) === 0;
  const ctl = m.rw(MATCH + (first ? 2 : 6));
  let bowl: boolean;
  if (ctl < 0) bowl = (rngNextAt(m) & 0xff) >= 0x50;
  else bowl = (yield { kind: "tossChoice" }) === 1;
  const d0 = bowl ? -1 : 0;
  m.ww(MATCH + 8, first ? d0 : ~d0);
  return { caller: m.rw(0xc5e6) === 0 ? 0 : 1, winner: first ? 0 : 1, batFirst: m.rw(MATCH + 8) === 0 ? 0 : 1, heads: m.rw(0xc5fe) !== 0 };
}
