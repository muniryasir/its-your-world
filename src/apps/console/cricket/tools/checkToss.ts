// The toss against the original (analysis tools/p6/toss_check.py: a human first side answering each menu
// with its first item: heads, bat; traces/toss/human16.json). The original's menus draw random numbers while they wait for the
// player, so the draws themselves can't be replayed; what is checked is the rule that decides the
// toss: who calls (the human), the winner from coin, caller and call (sub_02EBFC), and +8 when the
// human wins and bats. usage: npx tsx tools/checkToss.ts TOSS.json
import { readFileSync } from "node:fs";
const runs = JSON.parse(readFileSync(process.argv[2], "utf8")) as { ctl: [number, number]; toss: number; c5e6: number; c5e8: number; c5fe: number }[];
let ok = 0, n = 0;
for (const r of runs) {
  const caller = r.ctl[0] >= 0 && r.ctl[1] < 0 ? 0 : r.ctl[0] < 0 && r.ctl[1] >= 0 ? -1 : null;
  const first = ((r.c5fe ^ r.c5e6 ^ r.c5e8) & 0xffff) === 0;
  const humanWon = (first ? r.ctl[0] : r.ctl[1]) >= 0;
  n++;
  const good = (caller === null || r.c5e6 === caller) && r.c5e8 === 0 && (!humanWon || r.toss === (first ? 0 : -1));
  if (good) ok++; else console.log("differs", JSON.stringify(r));
}
console.log(`${ok}/${n} tosses follow the rule`);
if (ok !== n) process.exitCode = 1;
