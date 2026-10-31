// Generate engine/baseState.ts: the start states for batting practice (left-handed opener on strike,
// and a right-hander with the field mirrored). Replaces the lost analysis/p3/gen_base3.py.
// Reads the full-RAM snapshots of the original (analysis/tools/p3/find_base.py finds the frame of each
// state that the start state was cut from), plays many balls with random shots on a TrackingRam and
// keeps the RAM the sessions read from the start state, plus every RAM range the committed batting-side
// traces start from (rarely read bytes a random session may miss) and the ranges the previous start state
// had. Check the result with checkBase.ts.
//
// usage: npx tsx src/apps/console/cricket/tools/genBatBase.ts LEFT.bin RIGHT.bin [balls]
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { TrackingRam, Ram } from "../engine/mem";
import { Practice, DEFAULT_SETTINGS, PAD } from "../engine/practice";
import type { Settings } from "../engine/practice";
import { BASE_CONTEXT_LEFT, BASE_CONTEXT_RIGHT, BASE_RAM_LEFT, BASE_RAM_RIGHT } from "../engine/baseState";

const [leftFile, rightFile, nBalls = "300"] = process.argv.slice(2);
const here = dirname(fileURLToPath(import.meta.url));
const DIRS = [PAD.U, PAD.D, PAD.L, PAD.R, PAD.U | PAD.L, PAD.U | PAD.R, PAD.D | PAD.L, PAD.D | PAD.R, 0];
const kinds: Settings["bowler"][] = ["fast", "swing", "spin"];

function ranges(full: Uint8Array, batsman: "left" | "right", useTrace: (file: string) => boolean, previous: [number, string][]): [number, number][] {
  const trackers: TrackingRam[] = [];
  const start = (): Ram => { const t = new TrackingRam(full); trackers.push(t); return t; };
  let rnd = 4242;
  const rand = (n: number) => { rnd = (rnd * 1103515245 + 12345) & 0x7fffffff; return rnd % n; };
  const base: Settings = { ...DEFAULT_SETTINGS, mode: "bat", batsman };
  const counts: Record<string, number> = {};
  // several sessions of 60 balls (balls faced feeds the batsman's misjudge rolls, so long sessions drift)
  for (let k = 0; k < Math.ceil(Number(nBalls) / 60); k++) {
    const g = new Practice(11 + k, base, start);
    for (let b = 0; b < 60; b++) {
      g.nextBall({ ...base, bowler: kinds[(b + k) % 3], leftArm: (b + k) % 5 === 0, difficulty: ((b + k) % 3) as 0 | 1 | 2, accuracy: rand(100) });
      let held = 0, t = 0, hold = 0, cur = 0, shot = -1;
      const at = 0x40 + rand(0x200), dir = DIRS[rand(9)] | (rand(3) ? PAD.A : PAD.B);
      while (g.phase !== "result" && t < 8000) {
        if (g.phase === "live") {
          if (shot < 0 && g.m.rw(0xe5a2) !== 0 && g.m.rw(0xe5bc) > at) shot = t;
          cur = shot >= 0 && t < shot + 3 ? dir : 0;
        } else if (hold-- <= 0) {
          const r = rand(10);
          cur = r < 5 ? DIRS[rand(9)] : r < 8 ? PAD.A : rand(2) ? PAD.B : 0;
          hold = 2 + rand(30);
        }
        g.tick({ held: cur, pressed: cur & ~held });
        g.view();
        held = cur; t++;
      }
      const r = g.result;
      counts[r ? r.outcome : "timeout"] = (counts[r ? r.outcome : "timeout"] ?? 0) + 1;
    }
  }
  console.log(batsman, counts);
  const union = new Uint8Array(0x10000);
  for (const t of trackers) for (let i = 0; i < 0x10000; i++) if (t.readFirst[i]) union[i] = 1;
  const mark = (ram: unknown) => {
    if (!Array.isArray(ram)) return;
    for (const [a, b64] of ram as [number, string][]) { const n = Buffer.from(b64, "base64").length; for (let i = 0; i < n; i++) union[(a + i) & 0xffff] = 1; }
  };
  mark(previous); // and everything the previous start state kept (never shrink it)
  const tdir = join(here, "..", "traces");
  for (const sub of ["", "field", "hand"]) {
    for (const f of readdirSync(join(tdir, sub)).filter((f) => f.endsWith(".json.gz") && useTrace(f))) {
      const tr = JSON.parse(gunzipSync(readFileSync(join(tdir, sub, f))).toString("utf8"));
      mark(tr.ram); mark(tr.target);
    }
  }
  const out: [number, number][] = [];
  for (let i = 0; i < 0x10000; i++) {
    if (!union[i]) continue;
    const last = out[out.length - 1];
    if (last && i <= last[1] + 16) last[1] = i; else out.push([i, i]);
  }
  return out;
}

const left = new Uint8Array(readFileSync(leftFile)), right = new Uint8Array(readFileSync(rightFile));
// the batting-side traces: right-hander = 0for2 (also obj_0for2); everything else not bowling = the opener
const isBowl = /^(obj_)?bowl/;
const rl = ranges(left, "left", (f) => !isBowl.test(f) && !/0for2/.test(f), BASE_RAM_LEFT);
const rr = ranges(right, "right", (f) => /0for2/.test(f), BASE_RAM_RIGHT);
const block = (name: string, from: string, full: Uint8Array, rs: [number, number][]) => [
  `/** from state ${from} */`,
  `export const ${name}: [number, string][] = [`,
  ...rs.map(([a, b]) => `  [0x${a.toString(16).padStart(4, "0")}, "${Buffer.from(full.subarray(a, b + 1)).toString("base64")}"],`),
  "];",
];
const lines = [
  "// GENERATED by tools/genBatBase.ts (full snapshots found by analysis/tools/p3/find_base.py). Do not edit.",
  "// Start states for practice sessions: the RAM ranges the engine uses, recorded from the original game",
  "// (England batting, first over, fast bowler, standard field) just before the first delivery is set up;",
  "// one with the left-handed opener on strike, one with a right-hander (field mirrored).",
  "// Contains values copied from the ROM (tables, player data): console/cricket branch only.",
  "",
  ...block("BASE_RAM_LEFT", "england_batting_start (frame 345)", left, rl),
  `export const BASE_CONTEXT_LEFT = ${JSON.stringify(BASE_CONTEXT_LEFT)} as const;`,
  "",
  ...block("BASE_RAM_RIGHT", "england_batting_0for2 (frame 385)", right, rr),
  `export const BASE_CONTEXT_RIGHT = ${JSON.stringify(BASE_CONTEXT_RIGHT)} as const;`,
  "",
];
writeFileSync(join(here, "..", "engine", "baseState.ts"), lines.join("\n"));
for (const [n, rs] of [["left", rl], ["right", rr]] as const) console.log(n, rs.length, "ranges,", rs.reduce((s, [a, b]) => s + b - a + 1, 0), "bytes");
