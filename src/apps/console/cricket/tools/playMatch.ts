// Smoke test of the match layer: plays whole matches with the engine alone (no recording) and prints
// the scorecards. The pad is empty or random; questions get the first candidate.
// usage: npx tsx tools/playMatch.ts [seed] [human: england|australia|none] [overs] [random] [days] [innings a side]
import { MatchGame, DEFAULT_MATCH, scorecard, Team } from "../engine/matchGame";
const seed = +(process.argv[2] ?? 1);
const human = (process.argv[3] ?? "none") === "none" ? null : (process.argv[3] as Team);
const overs = +(process.argv[4] ?? 10);
const random = process.argv[5] === "random";
const days = +(process.argv[6] ?? 1), innings = (+(process.argv[7] ?? 1) === 2 ? 2 : 1) as 1 | 2;
const g = new MatchGame({ ...DEFAULT_MATCH, human, overs, seed, days, innings });
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
  // the Test screens (and with ALLEV=1 every event but the balls), with the clock
  const clock = () => `${(g.m.rw(0xbf0a) / 60) | 0}:${String(g.m.rw(0xbf0a) % 60).padStart(2, "0")}`;
  for (const e of g.news) {
    if (process.env.ALLEV ? e.kind !== "ball" : ["interval", "dayEnd", "lastDayEnd", "rain"].includes(e.kind)) console.log(`  ${JSON.stringify(e)} ${clock()}`);
  }
  g.news.length = 0;
}
for (const c of g.innings) {
  console.log(`${c.team}: ${c.total}/${c.wickets} (${c.overs} overs)  extras w ${c.extras.wides} lb ${c.extras.legByes} b ${c.extras.byes}  fow ${c.fallOfWickets.join(" ")}`);
  for (const b of c.batting) if (b.how !== "dnb") console.log(`   ${b.name.padEnd(14)} ${b.how.padEnd(8)} ${(b.bowler ?? "").padEnd(14)} ${String(b.runs).padStart(3)} (${b.balls})`);
  for (const b of c.bowling) console.log(`   > ${b.name.padEnd(14)} ${b.overs}-${b.maidens}-${b.runs}-${b.wickets}`);
}
console.log(g.over ? `result: ${JSON.stringify(g.result)} after ${n} pad samples, log ${g.log.pads.length} runs` : `NOT FINISHED after ${n} samples: ${JSON.stringify(scorecard(g.m)).slice(0, 200)}`);
if (!g.over || !g.result) process.exitCode = 1;
