// The toss against the original: for each recorded seed (analysis tools/p6/toss_check.py, a human first
// side answering each menu with its first item), the engine's toss from the same random word.
// usage: npx tsx tools/checkToss.ts TOSS.json
import { readFileSync } from "node:fs";
import { Ram } from "../engine/mem";
import { toss } from "../engine/toss";
import { MATCH } from "../engine/match";
const runs = JSON.parse(readFileSync(process.argv[2], "utf8")) as { rng_in: number; ctl: [number, number]; rng: number; toss: number; c5e6: number; c5e8: number; c5fe: number }[];
let ok = 0;
for (const r of runs) {
  const m = new Ram(new Uint8Array(0x10000));
  m.ww(0xe8e8, r.rng_in); m.ww(MATCH + 2, r.ctl[0]); m.ww(MATCH + 6, r.ctl[1]);
  const g = toss(m);
  let e = g.next();
  while (!e.done) e = g.next(0);
  const got = { rng: m.rw(0xe8e8) & 0xffff, toss: m.rw(MATCH + 8), c5e6: m.rw(0xc5e6), c5e8: m.rw(0xc5e8), c5fe: m.rw(0xc5fe) };
  const same = got.rng === r.rng && got.toss === r.toss && got.c5e6 === r.c5e6 && got.c5e8 === r.c5e8 && got.c5fe === r.c5fe;
  if (same) ok++; else console.log("differs", JSON.stringify(r), JSON.stringify(got));
}
console.log(`${ok}/${runs.length} tosses match`);
if (ok !== runs.length) process.exitCode = 1;
