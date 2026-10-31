// Match fidelity check (phase 4, development form): runs the engine's match flow against an emulator
// recording of a whole match (exact RAM snapshots at the delivery routine's entry, sub_00E13E, and its
// return, $DE7A) and compares RAM at every one of them:
//   A: each delivery, entry snapshot -> return snapshot (computer v computer: no input)
//   B: between deliveries (the over and innings logic), return snapshot -> next entry
// After each comparison the engine continues from the emulator's snapshot, so one difference doesn't
// hide the rest.
//
// usage: npx tsx tools/checkMatch.ts REC.bin [--diff]   (REC.json next to it: [{pc, frame}])
import { readFileSync } from "node:fs";
import { Ram } from "../engine/mem";
import { Delivery, inningsOvers, MatchEvent } from "../engine/match";
import { IGNORE } from "./checkMatchIgnore";

const file = process.argv[2];
const idx: { pc: number; frame: number }[] = JSON.parse(readFileSync(file.replace(/\.bin$/, ".json"), "utf8"));
const all = readFileSync(file);
const snap = (i: number) => new Uint8Array(all.buffer, all.byteOffset + i * 0x10000, 0x10000);
const showDiff = process.argv.includes("--diff");

const ignored = new Uint8Array(0x10000);
for (const [a, b] of IGNORE) ignored.fill(1, a, b);

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
function compare(kind: "A" | "B", m: Ram, i: number, note: string): void {
  const r = diffs(m.buf, snap(i));
  stats[kind][1]++;
  if (!r.length) stats[kind][0]++;
  if (showDiff && r.length) console.log(`${kind} ${i} frame ${idx[i].frame} ${note}: ${r.length} ranges: ${fmt(r)}`);
  m.buf.set(snap(i)); // continue from the emulator's state
}

let i = idx.findIndex((h) => h.pc === 0xe13e);
const m = new Ram(snap(i));
const flow = inningsOvers(m, true);
let ev: IteratorResult<MatchEvent, void> = { done: false, value: { kind: "delivery" } };
for (;;) {
  if (ev.done) { console.log(`innings flow ended at snapshot ${i}`); break; }
  const e = ev.value;
  if (e.kind !== "delivery") { ev = flow.next(); continue; }
  if (idx[i].pc !== 0xe13e) { console.log(`flow wants a delivery, recording has ${idx[i].pc.toString(16)} at ${i}`); break; }
  const d = new Delivery(m);
  let n = 0;
  while (!d.done && n++ < 200000) d.step({ held: 0, pressed: 0 });
  i++;
  if (i >= idx.length || idx[i].pc !== 0xde7a) { console.log(`recording: no delivery return at ${i}`); break; }
  compare("A", m, i, `${d.done?.reason} field ${d.fieldSteps}`);
  i++;
  ev = flow.next();
  while (!ev.done && ev.value.kind !== "delivery") ev = flow.next();
  if (i >= idx.length) break;
  if (idx[i].pc !== 0xe13e) { console.log(`recording: ${idx[i].pc.toString(16)} at ${i} (not a delivery); flow ${ev.done ? "ended" : "wants a delivery"}`); break; }
  if (!ev.done) compare("B", m, i, "");
}
console.log(`A: ${stats.A[0]}/${stats.A[1]} deliveries match, B: ${stats.B[0]}/${stats.B[1]} between-ball gaps match`);
