// dev: step a recorded delivery's batting view against exact emulator snapshots at sub_00EDBC
import { readFileSync } from "node:fs";
import { Ram } from "../engine/mem";
import { Delivery } from "../engine/match";
import { IGNORE } from "./checkMatchIgnore";
const file = process.argv[2]; const off = +(process.argv[3] ?? 1); const show = +(process.argv[4] ?? 3);
const idx: { pc: number; frame: number }[] = JSON.parse(readFileSync(file.replace(/\.bin$/, ".json"), "utf8"));
const all = readFileSync(file);
const snap = (i: number) => new Uint8Array(all.buffer, all.byteOffset + i * 0x10000, 0x10000);
const ign = new Uint8Array(0x10000); for (const [a, b] of IGNORE) ign.fill(1, a, b);
ign.fill(1, 0x9000, 0x9c00);
const diff = (a: Uint8Array, b: Uint8Array) => { const o: string[] = []; for (let i = 0; i < 0x10000; i++) if (!ign[i] && a[i] !== b[i]) o.push(i.toString(16)); return o; };
const start = idx.findIndex((h) => h.pc === 0xe13e);
const ticks = idx.map((h, i) => [h, i] as const).filter(([h, i]) => h.pc === 0xedbc && i > start).map(([, i]) => i);
const m = new Ram(snap(start));
const d = new Delivery(m);
let bad = 0;
for (let k = 0; k + off < ticks.length && !d.field && !d.done; k++) {
  d.step({ held: 0, pressed: 0 });
  const r = diff(m.buf, snap(ticks[k + off]));
  if (r.length) { console.log(`tick ${k} (${d.engine.tickPhase}, frame ${idx[ticks[k + off]].frame}): ${r.length} bytes: ${r.slice(0, 40).join(" ")}`); if (++bad >= show) break; }
}
