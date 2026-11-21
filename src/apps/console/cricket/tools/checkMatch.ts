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
import { Delivery, matchFlow, MatchEvent, MatchResult, canBowl } from "../engine/match";
import { IGNORE, UI, REPLAY } from "./checkMatchIgnore";
import { batPad } from "../engine/batsman";
import { padFrame } from "../engine/pads";

const file = process.argv[2];
let idx: { pc: number; frame: number }[];
/** a session with pad input: the frames of every game tick / fielding step ... ([pc, frame]) and the pad per frame */
let session: { light: [number, number][]; pads: number[]; frame0: number } | null = null;
let snap: (i: number) => Uint8Array;
if (file.endsWith(".gz")) {
  // packed recording (tools/packMatch.ts): the first snapshot and the changes from each to the next
  const t = JSON.parse(gunzipSync(readFileSync(file)).toString());
  idx = t.idx;
  if (t.light) session = { light: t.light, pads: t.pads, frame0: t.frame0 };
  const snaps: Uint8Array[] = [new Uint8Array(Buffer.from(t.first, "base64"))];
  for (const d of t.deltas as [number, string][][]) {
    const r = snaps[snaps.length - 1].slice();
    for (const [a, b] of d) r.set(Buffer.from(b, "base64"), a);
    snaps.push(r);
  }
  snap = (i) => snaps[i];
} else {
  const j = JSON.parse(readFileSync(file.replace(/\.bin$/, ".json"), "utf8"));
  if (Array.isArray(j)) idx = j;
  else { idx = j.idx; session = { light: j.light, pads: j.pads, frame0: j.frame0 }; } // tools/p4/human_rec.py
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

let dev: { idx: { pc: number; frame: number }[]; snap: (i: number) => Uint8Array } | null = null;
let devShown = 0, fieldShown = 0;
{
  const a = process.argv.indexOf("--ticks");
  if (a > 0) {
    const f = process.argv[a + 1], all = readFileSync(f);
    dev = { idx: JSON.parse(readFileSync(f.replace(/\.bin$/, ".json"), "utf8")), snap: (i) => new Uint8Array(all.buffer, all.byteOffset + i * 0x10000, 0x10000) };
  }
}
const FIELD_STEP = new Set([0x034888, 0x0348e2, 0x034910, 0x034928, 0x034964, 0x034a02, 0x034a46, 0x034a6e, 0x03af04]);

/** One delivery, with the pad as the original read it between frames F0 (delivery entry) and F1 (its return):
 *  in the batting view once per game tick (held = the tick's frame, pressed = what went down since the
 *  last tick), in the fielding view every frame (a step can take more than one), plus the frames
 *  between the two views. Without input (computer v computer) every pass gets an empty pad. */
function playDelivery(m: Ram, F0: number, F1: number): Delivery {
  if (!session) {
    const d = new Delivery(m);
    let n = 0;
    while (!d.done && n++ < 200000) d.step({ held: 0, pressed: 0 });
    return d;
  }
  const { light, pads, frame0 } = session;
  const padAt = (f: number) => pads[f - frame0] ?? 0;
  const ev = light.filter(([, f]) => f >= F0 && f <= F1);
  const ticks = ev.filter(([pc]) => pc === 0xedbc).map(([, f]) => f);
  const block = () => (batPad(m) >= 0 ? batPad(m) : 0xfbf8);
  let lastTick = F0, ctl = F1;
  const d = new Delivery(m, {
    beforeField: () => {
      const setup = ev.find(([pc, f]) => pc === 0x343fe && f >= lastTick)?.[1] ?? lastTick;
      const exit = ev.find(([pc, f]) => (pc === 0xedb4 || pc === 0xedba) && f >= lastTick)?.[1] ?? lastTick + 1;
      for (let f = Math.max(exit, lastTick + 1); f <= setup; f++) padFrame(m, padAt(f));
      ctl = ev.find(([pc, f]) => pc === 0x3474c && f >= setup)?.[1] ?? setup;
    },
    afterField: () => { m.ww(block() + 4, padAt(ctl - 1)); m.ww(block() + 6, padAt(ctl - 1)); },
  });
  let n = 0;
  const tick = d.engine.tick.bind(d.engine);
  d.engine.tick = (input) => { n++; tick(input); };
  let k = 0, guard = 0;
  while (!d.done && !d.field && guard++ < 200000) {
    // after the recording's last tick the original still read the pad once (the check after its frame)
    // (sub_00ED82's exit, $EDB4 / $EDBA, can come a lag frame later than the tick)
    const f = k < ticks.length ? ticks[k] : ev.find(([pc, g]) => (pc === 0xedb4 || pc === 0xedba) && g > lastTick)?.[1] ?? lastTick + 1;
    let pressed = 0;
    for (let g = lastTick + 1; g <= f; g++) pressed |= padAt(g) & ~padAt(g - 1);
    if (k >= ticks.length) lastTick = f;
    const before = n;
    d.step({ held: padAt(f), pressed: pressed & 0xff });
    if (n > before) { lastTick = f; k += n - before; }
    if (dev && n > before && k < ticks.length) {
      // --ticks WINDOW.bin: exact RAM at every tick's entry (tools/p4/human_window.py)
      const t = dev.idx.findIndex((h) => h.pc === 0xedbc && h.frame === ticks[k]);
      if (t >= 0) {
        const r = diffs(m.buf, dev.snap(t)).filter(([a]) => !(a >= 0xd150 && a < 0xd1f0)); // (the aim runs before the tick: one step ahead in the snapshot)
        if (process.env.DEVT && k - 1 >= +(process.env.DEVT0 ?? 0) && k - 1 < +(process.env.DEVT0 ?? 0) + 10) {
          const o = dev.snap(t), ow = (a: number) => ((o[a] << 8) | o[a + 1]).toString(16);
          console.log(`  t ${k - 1} ${d.engine.tickPhase} pad ${padAt(f).toString(16)}: ${process.env.DEVT.split(",").map((x) => `${x} ${(m.rw(parseInt(x, 16)) & 0xffff).toString(16)}/${ow(parseInt(x, 16))}`).join("  ")}`);
        }
        if (process.env.DEVW && k - 1 >= +process.env.DEVW && k - 1 < +process.env.DEVW + 8) {
          const hx = (u: Uint8Array) => Array.from(u.slice(0xe8fa, 0xe92a), (x) => x.toString(16).padStart(2, "0")).join("").replace(/(.{4})/g, "$1 ");
          console.log(`  tick ${k - 1} pad ${padAt(f).toString(16)} next ${padAt(ticks[k]).toString(16)}\n   eng ${hx(m.buf)}\n   org ${hx(dev.snap(t))}`);
        }
        if (r.length && devShown++ < 900) console.log(`  tick ${k - 1} (${d.engine.tickPhase}, frame ${f}, pad ${padAt(f).toString(16)}): ${fmt(r)}`);
      }
    }
  }
  if (d.field) {
    const steps = ev.filter(([pc, f]) => FIELD_STEP.has(pc) && f >= ctl).map(([, f]) => f);
    for (let s = 0; s < steps.length && !d.done; s++) {
      for (let g = (s === 0 ? ctl : steps[s - 1]) + 1; g < steps[s]; g++) padFrame(m, padAt(g));
      d.step({ held: padAt(steps[s]), pressed: 0 });
      if (dev && s + 1 < steps.length) {
        // exact RAM at the next step's entry (sub_034A82)
        const t = dev.idx.findIndex((h) => h.pc === 0x34a82 && h.frame === steps[s + 1]);
        if (t >= 0) {
          const r = diffs(m.buf, dev.snap(t)).filter(([a]) => !(a >= 0xc72a && a < 0xc72e) && !(a >= 0x9000 && a < 0x9c00) && !(a >= 0xc79e && a < 0xc7a0));
          if (process.env.DEVF) { const o = dev.snap(t), ow = (a: number) => ((o[a] << 8) | o[a + 1]).toString(16); console.log(`  step ${s} f ${steps[s]}: ${process.env.DEVF.split(",").map((x) => `${x} eng ${m.rw(parseInt(x, 16)).toString(16)} org ${ow(parseInt(x, 16))}`).join("  ")}`); }
          if (r.length && fieldShown++ < 10) console.log(`  field step ${s} (frame ${steps[s]}, pad ${padAt(steps[s]).toString(16)}, ${steps[s] - (s ? steps[s - 1] : ctl)} frames): ${fmt(r)}`);
        }
      }
    }
    // the last step's after-the-frame checks read the pad of the frame after it; more steps than the
    // recording has are reported by the comparison
    for (let g = (steps[steps.length - 1] ?? ctl) + 1; !d.done && guard++ < 300000; g++) d.step({ held: g <= F1 ? padAt(g) : 0, pressed: 0 });
  }
  return d;
}

// A recording that begins at the innings loop's entry ($DA70) also checks the first innings' set-up.
const fromStart = idx[0].pc === 0xda70;
let i = fromStart ? 1 : idx.findIndex((h) => h.pc === 0xe13e);
const m = new Ram(snap(fromStart ? 0 : i).slice());
const flow = matchFlow(m, !fromStart);
let result: MatchResult | null = null;
let ev: IteratorResult<MatchEvent, void> = { done: false, value: { kind: "delivery" } };
if (fromStart) {
  ev = flow.next();
  while (!ev.done && ev.value.kind !== "delivery") {
    let answer: number | undefined;
    if (ev.value.kind === "chooseOpeningBowlers") {
      const r = snap(i), rl = (a: number) => ((r[a] << 24) | (r[a + 1] << 16) | (r[a + 2] << 8) | r[a + 3]) >>> 0;
      const at = (p: number) => ((rl(p) & 0xffff) - (rl(0xb522) & 0xffff)) / 0x68;
      answer = at(0xa6be) | (at(0xa6c2) << 8);
    }
    ev = flow.next(answer);
  }
  compare("B", m, i, "first innings set-up");
}
for (;;) {
  if (ev.done) { console.log(`match flow ended at snapshot ${i} of ${idx.length} (${idx[i]?.pc.toString(16)})`); break; }
  const e = ev.value;
  if (e.kind !== "delivery") { ev = flow.next(); continue; }
  if (idx[i].pc !== 0xe13e) { console.log(`flow wants a delivery, recording has ${idx[i].pc.toString(16)} at ${i}`); break; }
  const d = playDelivery(m, idx[i].frame, idx[i + 1]?.frame ?? idx[i].frame);
  i++;
  if (i >= idx.length || idx[i].pc !== 0xde7a) { console.log(`recording: no delivery return at ${i}`); break; }
  const replay = d.field?.label === "retEnd";
  if (replay && process.env.SHOWREPLAY) console.log(`replay at delivery ${i} frames ${idx[i - 1].frame}..${idx[i].frame} out ${m.rw(0xbee2)}`);
  compare("A", m, i, `${d.done?.reason} field ${d.fieldSteps}${replay ? " replay" : ""}`, replay ? REPLAY : []);
  i++;
  let rain = false;
  const advance = () => {
    let answer: number | undefined;
    if (!ev.done && ev.value.kind === "chooseOpeningBowlers" && i < idx.length) {
      // the human captain's choice in the original's menu, read from the recording
      const r = snap(i), rl = (a: number) => ((r[a] << 24) | (r[a + 1] << 16) | (r[a + 2] << 8) | r[a + 3]) >>> 0;
      const at = (p: number) => ((rl(p) & 0xffff) - (rl(0xb522) & 0xffff)) / 0x68;
      answer = at(0xa6be) | (at(0xa6c2) << 8);
    }
    if (!ev.done && ev.value.kind === "chooseBowler" && i < idx.length) {
      const r = snap(i), rl = (a: number) => ((r[a] << 24) | (r[a + 1] << 16) | (r[a + 2] << 8) | r[a + 3]) >>> 0;
      answer = ((rl(0xa6be) & 0xffff) - (rl(0xb522) & 0xffff)) / 0x68;
      if (!canBowl(m, answer, true)) { console.log(`chooseBowler before snapshot ${i}: the original picked ${answer}, canBowl says no`); process.exitCode = 1; }
    }
    ev = flow.next(answer);
    if (!ev.done && ev.value.kind === "matchEnd") result = ev.value.result;
    if (!ev.done && ev.value.kind === "rain") {
      // the rain scene's display is the page's; the engine moves the clock on (rainScene)
      rain = true; rains++;
    }
  };
  advance();
  while (!ev.done && ev.value.kind !== "delivery") advance();
  if (i >= idx.length) break;
  if (idx[i].pc !== 0xe13e) {
    // $DA46: the match routine's innings loop has returned
    if (ev.done && idx[i].pc === 0xda46) { compare("B", m, i, "match end"); console.log(`match ended at snapshot ${i}, as in the recording: ${JSON.stringify(result)}`); }
    else { console.log(`recording: ${idx[i].pc.toString(16)} at ${i} (not a delivery); flow ${ev.done ? "ended" : "wants a delivery"}`); process.exitCode = 1; }
    break;
  }
  if (!ev.done && rain) {
    // across a rain break the match state is compared (the clock included: rainScene)
    const r = diffs(m.buf, snap(i)).filter(([a]) => (a >= 0xa6a0 && a < 0xa6c6) || (a >= 0xbe68 && a < 0xbf12) || (a >= 0xc5ba && a < 0xc5cc) || (a >= 0xc5ce && a < 0xc5e6));
    console.log(`rain break before snapshot ${i}: match state ${r.length ? "DIFFERS " + fmt(r) + r.map(([a]) => ` ${(a & ~1).toString(16)}: engine ${m.rw(a & ~1)} original ${(snap(i)[a & ~1] << 8) | snap(i)[(a & ~1) + 1]}`).join(",") : "matches"}`);
    if (r.length) rainBad++;
    // the scene also walks the fielders off and back (their records, $8F00, the objects at $CCE8) and
    // draws the pitch's turn once more: not ported, so everything continues from the recording
    resync(m, snap(i));
  } else if (!ev.done) compare("B", m, i, "");
}
console.log(`A: ${stats.A[0]}/${stats.A[1]} deliveries match, B: ${stats.B[0]}/${stats.B[1]} between-ball gaps match${rains ? `, ${rains} rain break(s) (clock ported, scene not; match state ${rainBad ? "DIFFERS" : "matches"})` : ""}`);
if (stats.A[0] !== stats.A[1] || stats.B[0] !== stats.B[1] || rainBad) process.exitCode = 1;
