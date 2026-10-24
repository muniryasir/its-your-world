// sub_049B34: the game's 16-bit random number generator (a byte-wise LFSR mix).
// State lives in RAM $FFE8E8. Every call advances the state and returns it as a signed word;
// callers mask the bits they need (andi.w #$ff, #$7ff, ...).

import { w } from "./m68k";

/** advance the generator; returns [newState, valueReturnedInD0 (signed word)] */
export function rngNext(state: number): number {
  let d7 = state & 0xff; // move.b d0,d7
  let x = (state >> 7) & 1; // lsr.w #8,d0 -> X = last bit shifted out (bit 7)
  let d6 = (state >> 8) & 0xff;
  let d0 = d6;
  const roxr1 = () => {
    const out = d0 & 1;
    d0 = ((x << 7) | (d0 >> 1)) & 0xff;
    x = out;
  };
  roxr1(); // roxr.b #1,d0
  d6 ^= d0; // eor.b d0,d6
  roxr1(); roxr1(); // roxr.b #2,d0
  d6 ^= d0;
  roxr1(); // roxr.b #1,d0
  d7 ^= d0; // eor.b d0,d7
  roxr1(); roxr1(); // roxr.b #2,d0
  d0 &= 1; // andi.b #1,d0
  x = (d7 >> 7) & 1; // asl.b #1,d7
  d7 = (d7 << 1) & 0xff;
  const hi = (d6 >> 7) & 1; // roxl.b #1,d6
  d6 = ((d6 << 1) | x) & 0xff;
  x = hi;
  d0 = (d0 + d7) & 0xff; // add.b d7,d0
  d7 = d0;
  return w((d6 << 8) | d7);
}

/** convenience wrapper around a mutable state holder */
export class Rng {
  constructor(public state: number) {}
  /** one call of sub_049B34: returns the new state word (signed) */
  next(): number {
    this.state = rngNext(this.state);
    return this.state;
  }
}
