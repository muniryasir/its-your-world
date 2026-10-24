// Fidelity check: run the engine on recorded emulator traces and compare every recorded RAM value
// tick by tick. A trace (traces/*.json.gz) holds the start state (only the RAM ranges the engine
// uses; the rest is zero), the pad input per tick, which game loop each tick belongs to, and the
// values that changed.
//
// usage: npx tsx src/apps/console/cricket/tools/check.ts [trace.json.gz ...]   (default: all traces)
import { readFileSync, readdirSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Ram } from "../engine/mem";
import { Engine } from "../engine/engine";
import { readVars } from "./vars";

// VBlank bookkeeping the engine does not model, and pad words that the emulator samples a frame later
const SKIP = new Set(["pad.fc2a", "pad.fc28", "pad.fc24", "pad.latch", "pad.prev", "pad.held"]);
const LOOPS: Record<string, string[]> = {
  camera: ["preaim"], pre13: ["preaim"], pre1: ["preaim"], aim: ["aim"], settle: ["settle"], swing: ["swing"],
  wait: ["meterWait", "paceWait"], meterA: ["meterA"], meterB: ["meterB"], meterC: ["meterC"], runup: ["runup"], live: ["live"],
};

interface Trace {
  name: string;
  ctx: ConstructorParameters<typeof Engine>[1];
  vars: string[];
  ram: [number, string][];
  newDelivery?: boolean;
  phase?: ConstructorParameters<typeof Engine>[2];
  checkDue?: boolean;
  ticks: [number, number, string, Record<string, number>][];
}

export function checkTrace(tr: Trace): { ok: boolean; ticks: number; message: string } {
  const buf = new Uint8Array(0x10000);
  for (const [a, b64] of tr.ram) buf.set(Buffer.from(b64, "base64"), a);
  const ram = new Ram(buf);
  const eng = new Engine(ram, tr.ctx, tr.phase ?? { kind: "live" }, tr.checkDue ?? false);
  if (tr.newDelivery) eng.newDelivery();
  const want: number[] = new Array(tr.vars.length).fill(0);
  for (let i = 0; i < tr.ticks.length; i++) {
    const [held, pressed, loop, changed] = tr.ticks[i];
    for (const [k, v] of Object.entries(changed)) want[+k] = v;
    eng.step({ held, pressed });
    // the end checks run at the start of a step; the emulator's tick here is already the next loop's
    if (eng.phase.kind === "done") return { ok: true, ticks: i, message: `delivery ended (${eng.phase.reason})` };
    if (loop && LOOPS[loop] && !LOOPS[loop].includes(eng.tickPhase))
      return { ok: false, ticks: i, message: `tick ${i}: emulator in loop ${loop}, engine ticked in ${eng.tickPhase}` };
    const got = readVars(ram);
    const diffs = tr.vars.map((n, j) => [n, j] as const).filter(([n, j]) => !SKIP.has(n) && got[n] !== want[j]);
    if (diffs.length)
      return { ok: false, ticks: i, message: `tick ${i} differs: ` + diffs.slice(0, 8).map(([n, j]) => `${n} engine ${got[n]} emulator ${want[j]}`).join(", ") };
  }
  return { ok: true, ticks: tr.ticks.length, message: "trace ended" };
}

export function loadTrace(file: string): Trace {
  return JSON.parse(gunzipSync(readFileSync(file)).toString("utf8"));
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "traces");
  const files = process.argv.length > 2 ? process.argv.slice(2) : readdirSync(dir).filter((f) => f.endsWith(".json.gz")).sort().map((f) => join(dir, f));
  let pass = 0, ticks = 0, unexpected = 0;
  const known = new Set(["start_s0_d4"]); // see "Known differences" in ../README.md
  for (const f of files) {
    const tr = loadTrace(f);
    const r = checkTrace(tr);
    ticks += r.ticks;
    if (r.ok) pass++;
    else if (!known.has(tr.name)) unexpected++;
    const tag = r.ok ? "ok   " : known.has(tr.name) ? "known" : "FAIL ";
    console.log(`${tag} ${tr.name}: ${r.ticks} ticks, ${r.message}`);
  }
  console.log(`\n${pass}/${files.length} traces match (${ticks} ticks compared)`);
  process.exitCode = unexpected ? 1 : 0;
}
