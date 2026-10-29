// Fidelity check for the hand-over from the batting view to the fielding view ($ED2E): from the
// emulator's RAM at the end of the ball-live loop, run the 15 batting-view passes that follow and
// compare the RAM the fielding view starts from (traces/hand/*.json.gz).
//
// usage: npx tsx src/apps/console/cricket/tools/checkHand.ts [-v] [trace.json.gz ...]
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Ram } from "../engine/mem";
import { Engine } from "../engine/engine";
import { Context } from "../engine/context";
import { batPad } from "../engine/batsman";
import { padFrame } from "../engine/pads";

export interface HandTrace { name: string; ctx: Context; ram: [number, string][] | string; held: number[]; target: [number, string][] | string }

/** RAM the hand-over is checked on: the fielding view's inputs (the ball, fielders, match, pads) */
export const HAND_RANGES: [number, number][] = [
  [0x8600, 0x8620], [0xb9a0, 0xbe18], [0xbe68, 0xbef0], [0xbf20, 0xbf26], [0xd1b0, 0xd2d0],
  [0xe1a8, 0xe5c0], [0xe8e8, 0xe8ea], [0xe934, 0xe960], [0xfbf8, 0xfc2c],
];

/** words the engine leaves out: the field map overlay's copies of fielder positions (sub_03AD98, the
 *  fielding view's set-up rewrites them), the pad idle counter (VBlank), and the press latches while
 *  the screen fades out between the views (some presses then are dropped; the set-up clears them all) */
function skipped(m: Ram, a: number): boolean {
  if (a === 0xfc2a) return true;
  if (a >= 0xfbf8 && a < 0xfc18 && (a & 7) === 2) return true;
  const base = m.rl(0xb522) & 0xffff, k = a - base;
  return k >= 0 && k < 11 * 0x68 && (k % 0x68 === 0x3c || k % 0x68 === 0x44);
}

export function load(r: [number, string][] | string): Uint8Array {
  const buf = new Uint8Array(0x10000);
  if (typeof r === "string") buf.set(Buffer.from(r, "base64"));
  else for (const [a, b64] of r) buf.set(Buffer.from(b64, "base64"), a);
  return buf;
}

export function checkHandTrace(tr: HandTrace, verbose = false, mk: (b: Uint8Array) => Ram = (b) => new Ram(b)): { ok: boolean; message: string } {
  const m = mk(load(tr.ram));
  const want = new Ram(load(tr.target));
  const eng = new Engine(m, tr.ctx, { kind: "live" }, true);
  let prev = m.rw((batPad(m) >= 0 ? batPad(m) : 0xfbf8) + 4);
  let i = 0, passes = 0;
  for (; i < tr.held.length; i++) {
    const held = tr.held[i];
    const input = { held, pressed: held & ~prev & 0xff };
    prev = held;
    if (eng.phase.kind === "done" && passes > 0) { padFrame(m, held); continue; }
    eng.step(input);
    if (eng.phase.kind === "done" && passes === 0) {
      if (eng.phase.reason !== "offscreen" && eng.phase.reason !== "settled") return { ok: false, message: `the ball-live loop ended with ${eng.phase.reason}` };
      eng.handOver();
      eng.step(input);
    }
    if (eng.phase.kind === "handover" || passes > 0 || eng.phase.kind === "done") passes++;
  }
  if (eng.phase.kind !== "done") return { ok: false, message: `still in ${eng.phase.kind} after ${tr.held.length} frames` };
  const diffs: string[] = [];
  for (const [lo, hi] of HAND_RANGES)
    for (let a = lo; a < hi; a += 2) if (m.rw(a) !== want.rw(a) && !skipped(m, a)) diffs.push(`$${a.toString(16)} engine ${m.rw(a)} emulator ${want.rw(a)}`);
  if (diffs.length) return { ok: false, message: `${passes} passes, ${diffs.length} words differ: ` + diffs.slice(0, verbose ? 200 : 12).join(", ") };
  return { ok: true, message: `${passes} passes, ${tr.held.length} frames` };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "traces", "hand");
  const args = process.argv.slice(2).filter((a) => !a.startsWith("-"));
  const files = args.length ? args : existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".json.gz")).sort().map((f) => join(dir, f)) : [];
  let pass = 0;
  for (const f of files) {
    const tr = JSON.parse(gunzipSync(readFileSync(f)).toString("utf8")) as HandTrace;
    const r = checkHandTrace(tr, process.argv.includes("-v"));
    if (r.ok) pass++;
    console.log(`${r.ok ? "ok   " : "FAIL "} ${tr.name}: ${r.message}`);
  }
  console.log(`\n${pass}/${files.length} hand-overs match`);
  process.exitCode = pass === files.length ? 0 : 1;
}
