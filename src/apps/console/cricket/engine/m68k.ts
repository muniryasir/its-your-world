// Integer helpers that reproduce Motorola 68000 arithmetic exactly.
// The original game is compiled C running on a 68000; the engine keeps every value as a JS number
// holding an integer and uses these helpers wherever the original mixes 16- and 32-bit operations.

/** signed 16-bit view of a value */
export const w = (x: number): number => ((x & 0xffff) ^ 0x8000) - 0x8000;
/** signed 32-bit view of a value */
export const l = (x: number): number => x | 0;
/** unsigned 16-bit view */
export const uw = (x: number): number => x & 0xffff;

/** muls.w: signed 16 x 16 -> 32 */
export const muls = (a: number, b: number): number => l(w(a) * w(b));
/** mulu.w: unsigned 16 x 16 -> 32 (kept as a signed 32-bit value, like a register) */
export const mulu = (a: number, b: number): number => l(uw(a) * uw(b));

/** asr.l */
export const asr = (x: number, n: number): number => l(x) >> n;
/** lsl.l */
export const lsl = (x: number, n: number): number => l(x << n);
/** swap: exchange register halves */
export const swap = (x: number): number => l(((x & 0xffff) << 16) | ((x >>> 16) & 0xffff));
/** "lsl.l #n,d; swap d" then use the low word: signed 16-bit of bits (16-n)..(31-n) */
export const hiAfterShift = (x: number, n: number): number => w(l(x << n) >>> 16);
/** set the high word of a 32-bit register (move.w to the high half of a long variable) */
export const setHi = (x: number, hi: number): number => l(((hi & 0xffff) << 16) | (x & 0xffff));
/** high word (as s16) of a 32-bit value: what a word read at the variable's address returns */
export const hi = (x: number): number => w(x >>> 16);
/** replace the low word of a register (word-sized op result) */
export const setLo = (reg: number, v: number): number => l((reg & ~0xffff) | (v & 0xffff));

/**
 * divs.w: 32 / 16 signed. Returns the new register value (remainder:quotient) or the unchanged
 * dividend when the quotient overflows (68000 leaves the destination untouched and sets V).
 */
export function divs(dividend: number, divisor: number): { reg: number; q: number; overflow: boolean } {
  const d = w(divisor);
  if (d === 0) throw new Error('divs by zero');
  const n = l(dividend);
  const q = Math.trunc(n / d);
  if (q > 32767 || q < -32768) return { reg: n, q: w(n), overflow: true };
  const r = n - q * d;
  return { reg: setLo(lsl(r & 0xffff, 16), q), q: w(q), overflow: false };
}

/** divs.w returning only the quotient word, for code that ignores the remainder */
export const divsQ = (dividend: number, divisor: number): number => divs(dividend, divisor).q;

/** divu.w: 32 / 16 unsigned. Same overflow behaviour as divs. */
export function divu(dividend: number, divisor: number): { reg: number; q: number; overflow: boolean } {
  const d = uw(divisor);
  if (d === 0) throw new Error('divu by zero');
  const n = dividend >>> 0;
  const q = Math.floor(n / d);
  if (q > 0xffff) return { reg: l(n), q: n & 0xffff, overflow: true };
  const r = n - q * d;
  return { reg: l((r << 16) | q), q, overflow: false };
}

/**
 * sub_049D18: the game's 32 / 32 signed division (compiled C helper). Exact port including its
 * shortcuts: divisor 0 -> $7FFFFFFF, equal magnitudes -> 1, |divisor| > |dividend| -> 0, and the
 * shifted approximation used when the divisor needs more than 16 bits.
 */
export function div32(dividend: number, divisor: number): number {
  let neg = false;
  let d6 = l(divisor);
  if (d6 < 0) { d6 = l(-d6); neg = !neg; }
  let d7 = l(dividend);
  if (d7 < 0) { d7 = l(-d7); neg = !neg; }
  let q: number;
  const u6 = d6 >>> 0, u7 = d7 >>> 0;
  if (u6 === 0) q = 0x7fffffff;
  else if (u6 === u7) q = 1;
  else if (l(d6) > l(d7)) q = 0; // cmp.l d7,d6 ; blt -> signed compare (both non-negative here except $80000000)
  else if ((u7 >>> 16) === 0) {
    q = divu(u7, u6).q; // dividend fits 16 bits
  } else if ((u6 >>> 16) === 0) {
    // divisor fits 16 bits, dividend doesn't: two-step long division
    let d4 = 0;
    let d3 = (u6 << 16) >>> 0;
    // find shift so that (divisor << 16) << d4 > dividend (unsigned compare, bcs)
    while (!(u7 < d3)) { d3 = (d3 + d3) >>> 0; d4++; if (d4 > 32) break; }
    let t = (u7 >>> d4) >>> 0;
    const r1 = divu(t, u6);
    t = r1.reg >>> 0;
    const d2lo = t & 0xffff;
    let hiq = ((t & 0xffff) >>> 0); // swap; clr.w; swap -> low word quotient
    hiq = (hiq << d4) >>> 0;
    const prod = ((d2lo * u6) >>> 0) << d4 >>> 0;
    let rem = (u7 - prod) >>> 0;
    const r2 = divu(rem, u6);
    rem = r2.reg & 0xffff;
    q = (rem + hiq) >>> 0;
  } else {
    // divisor needs > 16 bits: shift both right until the divisor fits, then divu
    let d3 = u6 & 0xffff;
    let hi6 = u6 >>> 16;
    let d4 = 0;
    // move.w d6,d3 (low word, after swap d6 = hi word) ; loop on hi word
    d3 = hi6;
    do { d4++; d3 >>>= 1; } while (d3 !== 0);
    const a = u7 >>> d4;
    const b = (u6 >>> d4) & 0xffff;
    q = divu(a, b).reg & 0xffff;
  }
  q = l(q);
  return neg ? l(-q) : q;
}
