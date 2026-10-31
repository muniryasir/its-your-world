// Identity test for a trimmed start state: play the same practice sessions from the full RAM snapshot
// the start state was cut from and from the trimmed state (engine/baseState.ts, engine/baseBowl.ts),
// and compare what the page sees after every tick (the view, the ball results, the score).
// The full snapshots stay with the analysis tools (outside this repo).
//
// usage: npx tsx src/apps/console/cricket/tools/checkBase.ts left|right|bowl FULL_RAM.bin [balls] [sessions]
import { readFileSync } from "node:fs";
import { Ram, TrackingRam } from "../engine/mem";
import { BASE_RAM_LEFT, BASE_RAM_RIGHT } from "../engine/baseState";
import { BASE_RAM_BOWL } from "../engine/baseBowl";
import { Practice, DEFAULT_SETTINGS, PAD } from "../engine/practice";
import type { Settings } from "../engine/practice";

const [which, fullFile, nBalls = "60", nSessions = "8"] = process.argv.slice(2);
if (!["left", "right", "bowl"].includes(which) || !fullFile) {
  console.error("usage: checkBase.ts left|right|bowl FULL_RAM.bin [balls] [sessions]");
  process.exit(2);
}
const full = new Uint8Array(readFileSync(fullFile));
const trackers: TrackingRam[] = [];
const DIRS = [PAD.U, PAD.D, PAD.L, PAD.R, PAD.U | PAD.L, PAD.U | PAD.R, PAD.D | PAD.L, PAD.D | PAD.R, 0];
const kinds: Settings["bowler"][] = ["fast", "swing", "spin"];

function session(k: number, fromFull: boolean): string[] {
  let rnd = 1000 + k;
  const rand = (n: number) => { rnd = (rnd * 1103515245 + 12345) & 0x7fffffff; return rnd % n; };
  const base: Settings = which === "bowl"
    ? { ...DEFAULT_SETTINGS, mode: "bowl", humanField: k % 2 === 0 }
    : { ...DEFAULT_SETTINGS, mode: "bat", batsman: which as "left" | "right" };
  const g = fromFull ? new Practice(k, base, () => { const t = new TrackingRam(full); trackers.push(t); return t; }) : new Practice(k, base);
  const log: string[] = [];
  for (let b = 0; b < Number(nBalls); b++) {
    g.nextBall({ ...base, bowler: kinds[(b + k) % 3], leftArm: (b + k) % 5 === 0, difficulty: ((b + k) % 3) as 0 | 1 | 2, accuracy: rand(100) });
    let held = 0, t = 0, hold = 0, cur = 0, shot = -1;
    // batting: a shot (random direction, A or B) when the ball is a random distance from the batsman
    const at = 0x40 + rand(0x200), dir = DIRS[rand(9)] | (rand(3) ? PAD.A : PAD.B);
    while (g.phase !== "result" && t < 8000) {
      if (which !== "bowl" && g.phase === "live") {
        if (shot < 0 && g.m.rw(0xe5a2) !== 0 && g.m.rw(0xe5bc) > at) shot = t;
        cur = shot >= 0 && t < shot + 3 ? dir : 0;
      } else if (hold-- <= 0) {
        const r = rand(10);
        cur = r < 5 ? DIRS[rand(9)] : r < 8 ? PAD.A : g.phase === "field" ? [PAD.B, PAD.C, PAD.A | PAD.U][rand(3)] : rand(2) ? PAD.B : 0;
        hold = 2 + rand(30);
      }
      g.tick({ held: cur, pressed: cur & ~held });
      log.push(JSON.stringify(g.view()));
      held = cur; t++;
    }
    log.push(JSON.stringify({ result: g.result, score: g.score }));
  }
  return log;
}

/** the first value that differs between two JSON texts, as a path */
function firstDiff(x?: string, y?: string): string {
  if (x === undefined || y === undefined) return x === undefined ? "full session ended first" : "trimmed session ended first";
  const walk = (p: string, u: unknown, v: unknown): string | null => {
    if (typeof u !== "object" || u === null || typeof v !== "object" || v === null) return JSON.stringify(u) === JSON.stringify(v) ? null : `${p}: full ${JSON.stringify(u)} trimmed ${JSON.stringify(v)}`;
    for (const k of new Set([...Object.keys(u), ...Object.keys(v as object)])) {
      const d = walk(`${p}.${k}`, (u as Record<string, unknown>)[k], (v as Record<string, unknown>)[k]);
      if (d) return d;
    }
    return null;
  };
  return walk("view", JSON.parse(x), JSON.parse(y)) ?? "?";
}

let same = 0, ticks = 0, fieldViews = 0;
for (let k = 0; k < Number(nSessions); k++) {
  const a = session(k, true), b = session(k, false);
  const n = Math.min(a.length, b.length);
  for (let j = 1; j < a.length; j++) if (a[j].startsWith('{"phase":"field"') && !a[j - 1].startsWith('{"phase":"field"')) fieldViews++;
  let i = 0;
  while (i < n && a[i] === b[i]) i++;
  ticks += n;
  if (i === n && a.length === b.length) { same++; console.log(`ok    session ${k}: ${a.length} ticks identical`); }
  else console.log(`FAIL  session ${k}: differs at tick ${i}: ${firstDiff(a[i], b[i])}`);
}
console.log(`\n${same}/${nSessions} sessions play identically from the full snapshot and the trimmed ${which} state (${ticks} ticks, ${fieldViews} fielding views)`);
// bytes the sessions read from the start state that the trimmed state leaves out (and that are not 0)
const kept = new Uint8Array(0x10000);
for (const [a, b] of which === "bowl" ? BASE_RAM_BOWL : which === "left" ? BASE_RAM_LEFT : BASE_RAM_RIGHT) kept.set(new Uint8Array(Buffer.from(b, "base64").length).fill(1), a);
const missing: string[] = [];
for (let i = 0; i < 0x10000; i++) if (!kept[i] && full[i] !== 0 && trackers.some((t) => t.readFirst[i])) missing.push(`$${i.toString(16)}=${full[i]}`);
if (missing.length) console.log(`read but not in the trimmed state: ${missing.join(" ")}`);
process.exitCode = same === Number(nSessions) ? 0 : 1;
