// Match fidelity check (phase 4, development form): runs the engine's match flow against an emulator
// recording of a whole match (exact RAM snapshots at the delivery routine's entry, sub_00E13E, and its
// return, $DE7A) and compares RAM at every one of them:
//   A: each delivery, entry snapshot -> return snapshot (computer v computer: no input)
//   B: between deliveries (the over and innings logic), return snapshot -> next entry
// After each comparison the engine continues from the emulator's snapshot, so one difference doesn't
// hide the rest.
//
// usage: npx tsx tools/checkMatch.ts REC [--diff] [--values] [--free]
//   REC: traces/match/NAME.json.gz (packed, in the repo) or REC.bin (raw, with REC.json: [{pc, frame}])
//   --free: the engine is never put back on the recording's state: it plays the whole match alone
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { Ram } from "../engine/mem";
import { Delivery, matchInnings, MatchEvent } from "../engine/match";
import { IGNORE, UI, REPLAY } from "./checkMatchIgnore";

const file = process.argv[2];
let idx: { pc: number; frame: number }[];
let snap: (i: number) => Uint8Array;
if (file.endsWith(".gz")) {
  // packed recording (tools/packMatch.ts): the first snapshot and the changes from each to the next
  const t = JSON.parse(gunzipSync(readFileSync(file)).toString());
  idx = t.idx;
  const snaps: Uint8Array[] = [new Uint8Array(Buffer.from(t.first, "base64"))];
  for (const d of t.deltas as [number, string][][]) {
    const r = snaps[snaps.length - 1].slice();
    for (const [a, b] of d) r.set(Buffer.from(b, "base64"), a);
    snaps.push(r);
  }
  snap = (i) => snaps[i];
} else {
  idx = JSON.parse(readFileSync(file.replace(/\.bin$/, ".json"), "utf8"));
  const all = readFileSync(file);
  snap = (i) => new Uint8Array(all.buffer, all.byteOffset + i * 0x10000, 0x10000);
}
const showDiff = process.argv.includes("--diff");

const free = process.argv.includes("--free"); // never continue from the recording: the engine plays on alone
const ignored = new Uint8Array(0x10000);
const keep = new Uint8Array(0x10000); // bytes the engine keeps (never refreshed from the recording)
for (const [a, b] of [...IGNORE, ...UI]) { ignored.fill(1, a, b); keep.fill(1, a, b); }
/** continue from the recording's snapshot, except for what the engine keeps to itself */
function resync(m: Ram, want: Uint8Array): void {
  for (let a = 0; a < 0x10000; a++) if (!keep[a]) m.buf[a] = want[a];
}

function diffs(got: Uint8Array, want: Uint8Array): [number, number][] {
  const out: [number, number][] = [];
  for (let a = 0; a < 0x10000; a++) {
    if (ignored[a] || got[a] === want[a]) continue;
    if (out.length && a <= out[out.length - 1][1] + 2) out[out.length - 1][1] = a;
    else out.push([a, a]);
  }
  return out;
}
const fmt = (r: [number, number][]) => r.slice(0, 40).map(([a, b]) => (a === b ? a.toString(16) : `${a.toString(16)}-${b.toString(16)}`)).join(" ");

const stats = { A: [0, 0], B: [0, 0] };
let rains = 0, rainBad = 0;
/** the "picked" flags of sub_00B116's ranking, in the 22 players' team-table entries (+$19): scratch */
function pickedFlags(r: Uint8Array): number[] {
  const rl = (a: number) => ((r[a] << 24) | (r[a + 1] << 16) | (r[a + 2] << 8) | r[a + 3]) >>> 0;
  const out: number[] = [];
  for (const p of [0xb51c, 0xb522]) for (let k = 0; k < 11; k++) out.push(((rl((rl(p) & 0xffff) + 0x68 * k + 2) & 0xffff) + 0x19) & 0xffff);
  return out;
}
function compare(kind: "A" | "B", m: Ram, i: number, note: string, skip: [number, number][] = []): void {
  const extra: [number, number][] = [...skip, ...pickedFlags(snap(i)).map((a) => [a, a + 1] as [number, number])];
  for (const [a, b] of extra) ignored.fill(1, a, b);
  const r = diffs(m.buf, snap(i));
  for (const [a, b] of extra) ignored.fill(0, a, b);
  stats[kind][1]++;
  if (!r.length) stats[kind][0]++;
  if (showDiff && r.length) {
    console.log(`${kind} ${i} frame ${idx[i].frame} ${note}: ${r.length} ranges: ${fmt(r)}`);
    if (process.argv.includes("--values")) for (const [a, b] of r.slice(0, 12)) {
      const hex = (u: Uint8Array) => Array.from(u.slice(a & ~1, (b | 1) + 1), (x) => x.toString(16).padStart(2, "0")).join("");
      console.log(`    ${(a & ~1).toString(16)}: engine ${hex(m.buf)} original ${hex(snap(i))}`);
    }
  }
  if (free) { // only what the engine cannot know: the replay's left-overs
    for (const [a, b] of skip) m.buf.set(snap(i).subarray(a, b), a);
    return;
  }
  resync(m, snap(i));
}

let i = idx.findIndex((h) => h.pc === 0xe13e);
const m = new Ram(snap(i).slice());
const flow = matchInnings(m, true);
let ev: IteratorResult<MatchEvent, void> = { done: false, value: { kind: "delivery" } };
for (;;) {
  if (ev.done) { console.log(`match flow ended at snapshot ${i} of ${idx.length} (${idx[i]?.pc.toString(16)})`); break; }
  const e = ev.value;
  if (e.kind !== "delivery") { ev = flow.next(); continue; }
  if (idx[i].pc !== 0xe13e) { console.log(`flow wants a delivery, recording has ${idx[i].pc.toString(16)} at ${i}`); break; }
  const d = new Delivery(m);
  let n = 0;
  while (!d.done && n++ < 200000) d.step({ held: 0, pressed: 0 });
  i++;
  if (i >= idx.length || idx[i].pc !== 0xde7a) { console.log(`recording: no delivery return at ${i}`); break; }
  const replay = d.field?.label === "retEnd";
  compare("A", m, i, `${d.done?.reason} field ${d.fieldSteps}${replay ? " replay" : ""}`, replay ? REPLAY : []);
  i++;
  let rain = false;
  const advance = () => {
    ev = flow.next();
    if (!ev.done && ev.value.kind === "rain") {
      // the rain scene is not ported: take the clock it leaves from the recording
      rain = true; rains++;
      if (i < idx.length) m.buf.set(snap(i).subarray(0xbf0a, 0xbf0e), 0xbf0a);
    }
  };
  advance();
  while (!ev.done && ev.value.kind !== "delivery") advance();
  if (i >= idx.length) break;
  if (idx[i].pc !== 0xe13e) {
    // $DA46: the match routine's innings loop has returned
    if (ev.done && idx[i].pc === 0xda46) { compare("B", m, i, "match end"); console.log(`match ended at snapshot ${i}, as in the recording`); }
    else { console.log(`recording: ${idx[i].pc.toString(16)} at ${i} (not a delivery); flow ${ev.done ? "ended" : "wants a delivery"}`); process.exitCode = 1; }
    break;
  }
  if (!ev.done && rain) {
    // only the match state is compared across a rain break; then everything continues from the recording
    const r = diffs(m.buf, snap(i)).filter(([a]) => (a >= 0xa6a0 && a < 0xa6c6) || (a >= 0xbe68 && a < 0xbf12) || (a >= 0xc5ba && a < 0xc5cc) || (a >= 0xc5ce && a < 0xc5e6));
    console.log(`rain break before snapshot ${i}: match state ${r.length ? "DIFFERS " + fmt(r) : "matches"}`);
    if (r.length) rainBad++;
    resync(m, snap(i));
  } else if (!ev.done) compare("B", m, i, "");
}
console.log(`A: ${stats.A[0]}/${stats.A[1]} deliveries match, B: ${stats.B[0]}/${stats.B[1]} between-ball gaps match${rains ? `, ${rains} rain break(s) (scene not ported; match state ${rainBad ? "DIFFERS" : "matches"})` : ""}`);
if (stats.A[0] !== stats.A[1] || stats.B[0] !== stats.B[1] || rainBad) process.exitCode = 1;
