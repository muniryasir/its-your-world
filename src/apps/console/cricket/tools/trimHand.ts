// Cut hand-over traces down to the RAM they need: the start state to what the engine reads (TrackingRam),
// the target to HAND_RANGES. Writes traces/hand/<name>.json.gz.
//
// usage: npx tsx src/apps/console/cricket/tools/trimHand.ts SRC.json.gz ...
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { gunzipSync, gzipSync } from "node:zlib";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { TrackingRam } from "../engine/mem";
import { checkHandTrace, load, HAND_RANGES } from "./checkHand";
import type { HandTrace } from "./checkHand";

const out = join(dirname(fileURLToPath(import.meta.url)), "..", "traces", "hand");
mkdirSync(out, { recursive: true });
const cut = (full: Uint8Array, mark: (a: number) => boolean): [number, string][] => {
  const r: [number, string][] = [];
  for (let a = 0; a < 0x10000; ) {
    if (!mark(a)) { a++; continue; }
    let b = a + 1, gap = 0;
    while (b < 0x10000 && gap < 16) { if (mark(b)) gap = 0; else gap++; b++; }
    b -= gap;
    r.push([a, Buffer.from(full.subarray(a, b)).toString("base64")]);
    a = b;
  }
  return r;
};
for (const f of process.argv.slice(2)) {
  const tr = JSON.parse(gunzipSync(readFileSync(f)).toString("utf8")) as HandTrace;
  let t: TrackingRam | null = null;
  const r = checkHandTrace(tr, false, (b) => (t = new TrackingRam(b)));
  if (!r.ok) { console.log(`skip ${tr.name}: ${r.message}`); continue; }
  const src = load(tr.ram), tgt = load(tr.target);
  const inHand = (a: number) => HAND_RANGES.some(([lo, hi]) => a >= lo && a < hi);
  const small: HandTrace = { ...tr, ram: cut(src, (a) => t!.readFirst[a] === 1 || inHand(a)), target: cut(tgt, inHand) };
  const again = checkHandTrace(small);
  if (!again.ok) { console.log(`FAIL ${tr.name} after trimming: ${again.message}`); continue; }
  writeFileSync(join(out, `${tr.name}.json.gz`), gzipSync(JSON.stringify(small)));
}
