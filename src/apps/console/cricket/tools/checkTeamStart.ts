// A match built by newMatch for two teams vs the original's RAM at the innings loop of the same pairing
// (analysis tools/p6/team_start.py). Expected differences: the settings (human controllers, rain
// forecast, the random seed), the AUTO TEAM ranking scratch ($A65F-) and a display table ($F6xx), which
// a recording showed never feed back into play.
// usage: npx tsx tools/checkTeamStart.ts START.bin FIRST SECOND
import { readFileSync } from "node:fs";
import { newMatch, DEFAULT_MATCH } from "../engine/matchGame";
import { IGNORE, UI } from "./checkMatchIgnore";
const [f, a, b] = [process.argv[2], +process.argv[3], +process.argv[4]];
const want = new Uint8Array(readFileSync(f));
const m = newMatch({ ...DEFAULT_MATCH, human: null, teams: [a, b], batFirst: a, seed: 1 });
const ign = new Uint8Array(0x10000);
for (const [x, y] of [...IGNORE, ...UI]) ign.fill(1, x, y);
const out: [number, number][] = [];
for (let x = 0x400; x < 0x10000; x++) {
  if (ign[x] || m.buf[x] === want[x]) continue;
  if (out.length && x <= out[out.length - 1][1] + 4) out[out.length - 1][1] = x; else out.push([x, x]);
}
console.log(out.length, out.slice(0, 60).map(([x, y]) => x.toString(16) + (y > x ? "-" + y.toString(16) : "")).join(" "));
