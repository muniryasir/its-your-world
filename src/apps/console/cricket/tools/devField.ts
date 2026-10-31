// dev: step a recorded delivery's fielding view against exact emulator snapshots at sub_034A82
import { readFileSync } from "node:fs";
import { Ram } from "../engine/mem";
import { Delivery } from "../engine/match";
import { IGNORE } from "./checkMatchIgnore";
const file = process.argv[2]; const off = +(process.argv[3] ?? 0);
const idx: { pc: number; frame: number }[] = JSON.parse(readFileSync(file.replace(/\.bin$/, ".json"), "utf8"));
const all = readFileSync(file);
const snap = (i: number) => new Uint8Array(all.buffer, all.byteOffset + i * 0x10000, 0x10000);
const ign = new Uint8Array(0x10000); for (const [a, b] of IGNORE) ign.fill(1, a, b);
ign.fill(1, 0x9000, 0x9c00);
const diff = (a: Uint8Array, b: Uint8Array) => { const o: string[] = []; for (let i = 0; i < 0x10000; i++) if (!ign[i] && a[i] !== b[i]) o.push(i.toString(16)); return o; };
const start = idx.findIndex((h) => h.pc === 0xe13e);
const steps = idx.map((h, i) => [h, i] as const).filter(([h]) => h.pc === 0x34a82).map(([, i]) => i);
const m = new Ram(snap(start));
const d = new Delivery(m);
let n = 0;
while (!d.field && !d.done && n++ < 100000) d.step({ held: 0, pressed: 0 });
console.log("field view after", n, "passes; emulator steps", steps.length, "frames", idx[steps[0]].frame);
for (let k = 0; k < steps.length - off && !d.done; k++) {
  const r = diff(m.buf, snap(steps[k + off]));
  if (r.length) { console.log(`step ${k}: ${r.length} bytes differ: ${r.slice(0, 30).join(" ")}`); if (k > 2) break; }
  d.step({ held: 0, pressed: 0 });
}
console.log("done", d.done, "fieldSteps", d.fieldSteps);
