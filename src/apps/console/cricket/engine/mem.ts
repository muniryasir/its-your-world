// Engine memory: the original game keeps its state in 68000 work RAM ($FF0000-$FFFFFF) and
// reads constant tables from ROM. The rebuilt engine keeps the same layout so each routine can be
// ported line by line and checked against emulator traces value by value.
//
// Ram: 64 KB, big-endian, addressed by the low 16 bits ($FFE5B4 -> 0xe5b4).
// Rom: only the table segments the engine needs (romData.ts), addressed by ROM offset.

import { w, l } from "./m68k";
import { ROM_SEGMENTS } from "./romData";

export class Ram {
  readonly buf: Uint8Array;
  /** The upper half of the 68000's d6 register as the batting-view tick leaves it. The original's
   *  sub_048202 divides by d6 after setting only its lower half, so the upper half left by the
   *  release (sub_044480) or a dive (moveq) changes the result. Not part of the 64 KB. */
  d6hi = 0;
  private dv: DataView;
  constructor(src?: Uint8Array) {
    this.buf = src ? new Uint8Array(src) : new Uint8Array(0x10000);
    this.dv = new DataView(this.buf.buffer);
  }
  rb(a: number): number { return this.dv.getInt8(a & 0xffff); }
  rw(a: number): number { return this.dv.getInt16(a & 0xffff); }
  rl(a: number): number { return this.dv.getInt32(a & 0xffff); }
  wb(a: number, v: number): void { this.dv.setInt8(a & 0xffff, ((v & 0xff) ^ 0x80) - 0x80); }
  ww(a: number, v: number): void { this.dv.setInt16(a & 0xffff, w(v)); }
  wl(a: number, v: number): void { this.dv.setInt32(a & 0xffff, l(v)); }
  /** add to a word in place (addq.w / subq.w) */
  aw(a: number, d: number): number { const v = w(this.rw(a) + d); this.ww(a, v); return v; }
  clone(): Ram { const r = new Ram(this.buf); r.d6hi = this.d6hi; return r; }
}

class RomImage {
  private segs: { start: number; end: number; dv: DataView }[] = [];
  constructor() {
    for (const [start, b64] of ROM_SEGMENTS) {
      const bytes = decodeBase64(b64);
      this.segs.push({ start, end: start + bytes.length, dv: new DataView(bytes.buffer) });
    }
  }
  private seg(a: number, n: number) {
    for (const s of this.segs) if (a >= s.start && a + n <= s.end) return s;
    throw new Error(`ROM read outside extracted tables: $${a.toString(16)}`);
  }
  rb(a: number): number { const s = this.seg(a, 1); return s.dv.getInt8(a - s.start); }
  ub(a: number): number { const s = this.seg(a, 1); return s.dv.getUint8(a - s.start); }
  rw(a: number): number { const s = this.seg(a, 2); return s.dv.getInt16(a - s.start); }
  rl(a: number): number { const s = this.seg(a, 4); return s.dv.getInt32(a - s.start); }
}

function decodeBase64(s: string): Uint8Array {
  if (typeof atob === "function") {
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  // Node without atob (older versions)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new Uint8Array((globalThis as any).Buffer.from(s, "base64"));
}

export const ROM = new RomImage();

/** sine table $4A12A: 2048 steps per circle, cos = +$400 bytes (+512 entries) */
export const SIN = (i: number): number => ROM.rw(0x4a12a + 2 * (i & 0x7ff));
export const COS = (i: number): number => ROM.rw(0x4a12a + 0x400 + 2 * (i & 0x7ff));

/** A Ram that records which bytes were read before the engine wrote them (inputs from the start state). */
export class TrackingRam extends Ram {
  written = new Uint8Array(0x10000);
  readFirst = new Uint8Array(0x10000);
  private mark(a: number, n: number, write: boolean) {
    for (let i = 0; i < n; i++) {
      const k = (a + i) & 0xffff;
      if (write) this.written[k] = 1;
      else if (!this.written[k]) this.readFirst[k] = 1;
    }
  }
  rb(a: number): number { this.mark(a, 1, false); return super.rb(a); }
  rw(a: number): number { this.mark(a, 2, false); return super.rw(a); }
  rl(a: number): number { this.mark(a, 4, false); return super.rl(a); }
  wb(a: number, v: number): void { this.mark(a, 1, true); super.wb(a, v); }
  ww(a: number, v: number): void { this.mark(a, 2, true); super.ww(a, v); }
  wl(a: number, v: number): void { this.mark(a, 4, true); super.wl(a, v); }
}
