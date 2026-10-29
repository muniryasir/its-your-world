// Fidelity check for the fielding view: replay recorded emulator traces of the fielding view
// (traces/field/*.json.gz) through engine/fielding.ts and compare the recorded RAM words after
// every step.
//
// usage: npx tsx src/apps/console/cricket/tools/checkField.ts [trace.json.gz ...]
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Ram } from "../engine/mem";
import { FieldView } from "../engine/fielding";
import { padPresses, padFrame } from "../engine/pads";

interface FieldTrace {
  name: string;
  ram: [number, string][] | string;
  vars: string[];
  /** per step: [the input handler's pad values since the last step, 0, loop, changed words] */
  ticks: [[number, number][] | number, number, string, Record<string, number>][];
  /** the human pad's "previous" word when the set-up dropped all presses */
  prev0?: Record<string, number>;
  /** words the fielding code wrote by the time it returned (runs on the ball, wicket) */
  result?: Record<string, number>;
}

/** words the engine does not model: sprite/display bookkeeping, the pads (sampled a frame later) */
export const FIELD_SKIP = new Set<string>([
  "8d06", "8d0c", // tile-map scroll bookkeeping (sub_009536)
  "c7f6", // the running batsmen's overlay is on screen (sub_039C62)
]);

export function loadFieldTrace(file: string): FieldTrace {
  return JSON.parse(gunzipSync(readFileSync(file)).toString("utf8"));
}

export function checkFieldTrace(tr: FieldTrace, verbose = false, mk: (buf: Uint8Array) => Ram = (b) => new Ram(b)): { ok: boolean; ticks: number; message: string } {
  const buf = new Uint8Array(0x10000);
  if (typeof tr.ram === "string") buf.set(Buffer.from(tr.ram, "base64"));
  else for (const [a, b64] of tr.ram) buf.set(Buffer.from(b64, "base64"), a);
  const m = mk(buf);
  const fv = new FieldView(m, {
    fielding: (r) => padPresses(r, r.rw(0xb526)),
    batting: (r) => padPresses(r, r.rw(0xb520)),
  });
  try {
    fv.setup();
  } catch (e) {
    return { ok: false, ticks: 0, message: `setup: ${(e as Error).message}` };
  }
  const blk = () => { const mode = m.rw(0xfc1c); const slot = mode === 1 ? m.rw(0xfc1a) : m.rw(0xfc18); return slot >= 0 ? 0xfbf8 + 8 * slot : 0xfbf8; };
  for (const [b, v] of Object.entries(tr.prev0 ?? {})) m.ww(parseInt(b, 16) + 4, v);
  const want: number[] = new Array(tr.vars.length).fill(0);
  const addr = tr.vars.map((v) => parseInt(v, 16));
  for (let i = 0; i < tr.ticks.length; i++) {
    const [reads, , loop, changed] = tr.ticks[i] as unknown as [[number, number][] | number, number, string, Record<string, number>];
    for (const [k, v] of Object.entries(changed)) want[+k] = v;
    if (fv.done) return { ok: false, ticks: i, message: `engine ended (${fv.phase.kind === "done" ? fv.phase.end : "?"}) at step ${i}, emulator went on (${loop})` };
    if (typeof reads === "number") padFrame(m, reads);
    else for (const [b, h] of reads) if (b === blk()) padFrame(m, h);
    try {
      fv.step();
    } catch (e) {
      return { ok: false, ticks: i, message: `step ${i} (${loop}): ${(e as Error).message}` };
    }
    if (fv.label !== loop) return { ok: false, ticks: i, message: `step ${i}: emulator in loop ${loop}, engine in ${fv.label}` };
    const diffs: string[] = [];
    for (let j = 0; j < addr.length; j++) {
      if (FIELD_SKIP.has(tr.vars[j])) continue;
      const got = m.rw(addr[j]);
      if (got !== want[j]) diffs.push(`$${tr.vars[j]} engine ${got} emulator ${want[j]}`);
    }
    if (diffs.length) return { ok: false, ticks: i, message: `step ${i} (${loop}) differs: ` + diffs.slice(0, verbose ? 40 : 10).join(", ") + (diffs.length > 10 && !verbose ? ` (+${diffs.length - 10})` : "") };
  }
  const ended = fv.done && fv.phase.kind === "done" ? fv.phase.end : null;
  const bad = Object.entries(tr.result ?? {}).filter(([a, v]) => m.rw(parseInt(a, 16)) !== w16(v));
  if (bad.length) return { ok: false, ticks: tr.ticks.length, message: `result differs: ` + bad.map(([a, v]) => `$${a} engine ${m.rw(parseInt(a, 16))} emulator ${w16(v)}`).join(", ") };
  return { ok: true, ticks: tr.ticks.length, message: ended ? `ended (${ended})` + resultText(tr) : "trace ended" };
}

const w16 = (v: number) => ((v & 0xffff) ^ 0x8000) - 0x8000;
function resultText(tr: FieldTrace): string {
  const r = tr.result ?? {};
  const parts: string[] = [];
  if (r.be9a !== undefined) parts.push(`${w16(r.be9a)} runs`);
  if (r.bee2 !== undefined && w16(r.bee2) !== 0) parts.push(["", "", "", "bowled", "caught", "run out", "lbw"][w16(r.bee2)] ?? `wicket ${r.bee2}`);
  return parts.length ? `, ${parts.join(", ")}` : "";
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "traces", "field");
  const args = process.argv.slice(2).filter((a) => !a.startsWith("-"));
  const verbose = process.argv.includes("-v");
  const files = args.length ? args : existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".json.gz")).sort().map((f) => join(dir, f)) : [];
  let pass = 0, ticks = 0;
  for (const f of files) {
    const tr = loadFieldTrace(f);
    const r = checkFieldTrace(tr, verbose);
    ticks += r.ticks;
    if (r.ok) pass++;
    console.log(`${r.ok ? "ok   " : "FAIL "} ${tr.name}: ${r.ticks} steps, ${r.message}`);
  }
  console.log(`\n${pass}/${files.length} fielding traces match (${ticks} steps compared)`);
  process.exitCode = pass === files.length ? 0 : 1;
}
