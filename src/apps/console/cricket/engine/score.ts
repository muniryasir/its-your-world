// The match struct at $BE68 (accessors at $C2A0-$C910): per-innings values are indexed by the batting
// innings, which sub_00C3E0 / sub_00C41A / sub_00C6A4 work out from +$2C (innings number) and +$0A.

import { Ram } from "./mem";

const MATCH = 0xbe68;

/** the slot the current innings' values live in (+$2C, flipped between the two teams' second innings
 *  when +$0A is set) */
export function inningsSlot(m: Ram): number {
  const inn = m.rw(MATCH + 0x2c);
  return inn >= 2 && m.rw(MATCH + 0xa) !== 0 ? inn ^ 1 : inn;
}

/** sub_00C394 / sub_00C3C4: the innings total; add runs to it */
export const inningsTotal = (m: Ram): number => m.rw(MATCH + 0x3e + 2 * inningsSlot(m));
export function addToTotal(m: Ram, runs: number): void {
  const a = MATCH + 0x3e + 2 * inningsSlot(m);
  m.ww(a, m.rw(a) + runs);
}

/** sub_00C6A4: wickets down in this innings */
export const wicketsDown = (m: Ram): number => m.rw(MATCH + 0x54 + 2 * inningsSlot(m));
