// Which RAM does a practice session read from its start state? Plays many balls with random shots
// from full-RAM snapshots of the original (analysis/p3/snap_base.py) with a TrackingRam, and writes
// the union as ranges, for analysis/p3/gen_base3.py.
//
// usage: npx tsx src/apps/console/cricket/tools/touchedPractice.ts BASE_DIR OUT.json [balls]
import { readFileSync, writeFileSync } from "node:fs";
import { TrackingRam } from "../engine/mem";
import { Practice, DEFAULT_SETTINGS, PAD } from "../engine/practice";
import type { Settings } from "../engine/practice";

const [dir, out, nBalls = "300"] = process.argv.slice(2);
const union = new Uint8Array(0x10000);
const trackers: TrackingRam[] = [];
const snap = (k: string) => Buffer.from(JSON.parse(readFileSync(`${dir}/${k}.json`, "utf8")).ram, "base64");
const SNAP = { left: snap("LEFT"), right: snap("RIGHT") };
const start = (b: Settings["batsman"]) => { const t = new TrackingRam(new Uint8Array(SNAP[b])); trackers.push(t); return t; };

let rnd = 12345;
const rand = (n: number) => { rnd = (rnd * 1103515245 + 12345) & 0x7fffffff; return rnd % n; };
const DIRS = [PAD.U, PAD.D, PAD.L, PAD.R, PAD.U | PAD.L, PAD.U | PAD.R, PAD.D | PAD.L, PAD.D | PAD.R, 0];
const counts: Record<string, number> = {};
const kinds: Settings["bowler"][] = ["fast", "swing", "spin"];
for (const batsman of ["left", "right"] as const) {
  const g = new Practice(7, { ...DEFAULT_SETTINGS, batsman }, start);
  for (let b = 0; b < Number(nBalls); b++) {
    const st: Settings = { ...DEFAULT_SETTINGS, batsman, bowler: kinds[b % 3], leftArm: b % 5 === 0, difficulty: (b % 3) as 0 | 1 | 2, accuracy: rand(100) };
    g.nextBall(st);
    let held = 0, t = 0, shot = -1;
    const at = -0x100 + rand(0x300);
    const pad = DIRS[rand(9)] | [PAD.A, PAD.B, PAD.A][rand(3)];
    while (g.phase !== "result" && t < 6000) {
      let h = 0;
      if (shot < 0 && g.phase === "live" && g.m.rw(0xe5a2) !== 0 && g.m.rw(0xe5bc) > at) shot = t;
      if (shot >= 0 && t < shot + 4) h = pad;
      if (g.phase === "field" && rand(30) === 0) h = PAD.A;
      g.tick({ held: h, pressed: h & ~held });
      g.view();
      held = h; t++;
    }
    const r = g.result!;
    counts[r.outcome] = (counts[r.outcome] ?? 0) + 1;
  }
}
for (const t of trackers) for (let i = 0; i < 0x10000; i++) if (t.readFirst[i]) union[i] = 1;
const ranges: [number, number][] = [];
for (let i = 0; i < 0x10000; i++) {
  if (!union[i]) continue;
  const last = ranges[ranges.length - 1];
  if (last && i <= last[1] + 16) last[1] = i; else ranges.push([i, i]);
}
writeFileSync(out, JSON.stringify(ranges));
console.log(counts);
console.log(ranges.length, "ranges,", ranges.reduce((s, [a, b]) => s + b - a + 1, 0), "bytes");
console.log(ranges.map(([a, b]) => `${a.toString(16)}-${b.toString(16)}`).join(" "));
