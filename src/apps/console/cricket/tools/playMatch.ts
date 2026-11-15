// Smoke test of the match layer: plays whole matches with the engine alone (no recording) and prints
// the scorecards. The pad is empty or random; questions get the first candidate.
// usage: npx tsx tools/playMatch.ts [seed] [human: england|australia|none] [overs] [random]
import { MatchGame, DEFAULT_MATCH, scorecard, Team } from "../engine/matchGame";
const seed = +(process.argv[2] ?? 1);
const human = (process.argv[3] ?? "none") === "none" ? null : (process.argv[3] as Team);
const overs = +(process.argv[4] ?? 10);
const random = process.argv[5] === "random";
const g = new MatchGame({ ...DEFAULT_MATCH, human, overs, seed });
let r = seed * 7919 + 1, held = 0, n = 0;
while (!g.over && n < 40_000_000) {
  if (g.question) { const q = g.question; g.answer(q.kind === "chooseBowler" ? q.candidates[0] : undefined); continue; }
  let pressed = 0;
  if (random) {
    r = (r * 1103515245 + 12345) >>> 0;
    if ((r >>> 16) % 12 === 0) { const next = (r >>> 8) & 0x5f; pressed = next & ~held; held = next; }
  }
  g.step({ held, pressed });
  n++;
}
for (const c of g.innings) {
  console.log(`${c.team}: ${c.total}/${c.wickets} (${c.overs} overs)  extras w ${c.extras.wides} lb ${c.extras.legByes} b ${c.extras.byes}  fow ${c.fallOfWickets.join(" ")}`);
  for (const b of c.batting) if (b.how !== "dnb") console.log(`   ${b.name.padEnd(14)} ${b.how.padEnd(8)} ${(b.bowler ?? "").padEnd(14)} ${String(b.runs).padStart(3)} (${b.balls})`);
  for (const b of c.bowling) console.log(`   > ${b.name.padEnd(14)} ${b.overs}-${b.maidens}-${b.runs}-${b.wickets}`);
}
console.log(g.over ? `result: ${JSON.stringify(g.result)} after ${n} pad samples, log ${g.log.pads.length} runs` : `NOT FINISHED after ${n} samples: ${JSON.stringify(scorecard(g.m)).slice(0, 200)}`);
if (!g.over || !g.result) process.exitCode = 1;
