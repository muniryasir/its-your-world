// Keep only the RAM a fielding trace needs: replay it with a TrackingRam and store the bytes the
// engine (and the checker) read before writing them, as ranges. Run after recording new traces.
//
// usage: npx tsx src/apps/console/cricket/tools/trimField.ts traces/field/*.json.gz
import { writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { TrackingRam } from "../engine/mem";
import { loadFieldTrace, checkFieldTrace } from "./checkField";

for (const f of process.argv.slice(2)) {
  const tr = loadFieldTrace(f);
  let tracker: TrackingRam | null = null;
  const r = checkFieldTrace(tr, false, (b) => (tracker = new TrackingRam(b)));
  if (!r.ok || !tracker) { console.log(`skip ${f}: ${r.message}`); continue; }
  const t = tracker as TrackingRam;
  const full = new Uint8Array(0x10000);
  if (typeof tr.ram === "string") full.set(Buffer.from(tr.ram, "base64"));
  else for (const [a, b64] of tr.ram) full.set(Buffer.from(b64, "base64"), a);
  const ranges: [number, string][] = [];
  for (let a = 0; a < 0x10000; ) {
    if (!t.readFirst[a]) { a++; continue; }
    let b = a + 1, gap = 0;
    while (b < 0x10000 && gap < 16) { if (t.readFirst[b]) gap = 0; else gap++; b++; }
    b -= gap;
    ranges.push([a, Buffer.from(full.subarray(a, b)).toString("base64")]);
    a = b;
  }
  const out = { ...tr, ram: ranges };
  const again = checkFieldTrace(out);
  if (!again.ok) { console.log(`FAIL ${f} after trimming: ${again.message}`); continue; }
  writeFileSync(f, gzipSync(JSON.stringify(out)));
  console.log(`${f}: ${ranges.reduce((n, [, s]) => n + Buffer.from(s, "base64").length, 0)} bytes`);
}
