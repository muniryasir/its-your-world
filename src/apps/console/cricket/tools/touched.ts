// Which RAM bytes does the engine read from its start state? Runs every trace with a TrackingRam and
// prints the union as address ranges (used to cut the committed start states down to what matters).
import { readFileSync, writeFileSync } from "node:fs";
import { TrackingRam } from "../engine/mem";
import { Engine } from "../engine/engine";

const files = process.argv.slice(2);
const union = new Uint8Array(0x10000);
for (const f of files) {
  const tr = JSON.parse(readFileSync(f, "utf8"));
  const ram = new TrackingRam(new Uint8Array(Buffer.from(tr.ram0, "base64")));
  const eng = new Engine(ram, tr.ctx, tr.phase ?? { kind: "runup", left: 14 }, tr.checkDue ?? false);
  if (tr.newDelivery) eng.newDelivery();
  for (const t of tr.ticks) { eng.step({ held: t.held, pressed: t.pressed }); if (eng.phase.kind === "done") break; }
  for (let i = 0; i < 0x10000; i++) if (ram.readFirst[i]) union[i] = 1;
}
const ranges: [number, number][] = [];
for (let i = 0; i < 0x10000; i++) {
  if (!union[i]) continue;
  const last = ranges[ranges.length - 1];
  if (last && i <= last[1] + 16) last[1] = i; else ranges.push([i, i]);
}
writeFileSync("/tmp/w/touched.json", JSON.stringify(ranges));
console.log(ranges.length, "ranges,", ranges.reduce((s, [a, b]) => s + b - a + 1, 0), "bytes");
console.log(ranges.map(([a, b]) => `${a.toString(16)}-${b.toString(16)}`).join(" "));
