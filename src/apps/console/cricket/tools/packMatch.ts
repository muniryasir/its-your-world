// Packs a match recording (REC.bin: N x 64 KB RAM snapshots from the tracing emulator, REC.json:
// [{pc, frame}]) into the form kept in the repo: the first snapshot (whole), then for every later snapshot the
// byte ranges that changed, leaving out the RAM the engine does not model (checkMatchIgnore.ts: IGNORE).
//
// usage: npx tsx tools/packMatch.ts REC.bin traces/match/NAME.json.gz
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { gzipSync } from "node:zlib";
import { IGNORE } from "./checkMatchIgnore";

const [file, out] = process.argv.slice(2);
const idx = JSON.parse(readFileSync(file.replace(/\.bin$/, ".json"), "utf8"));
const all = readFileSync(file);
const snap = (i: number) => all.subarray(i * 0x10000, (i + 1) * 0x10000);
const ign = new Uint8Array(0x10000);
for (const [a, b] of IGNORE) ign.fill(1, a, b);
const b64 = (u: Uint8Array) => Buffer.from(u).toString("base64");
const first = Buffer.from(snap(0));

const deltas: [number, string][][] = [];
for (let i = 1; i < idx.length; i++) {
  const p = snap(i - 1), c = snap(i);
  const d: [number, string][] = [];
  for (let a = 0; a < 0x10000; a++) {
    if (ign[a] || p[a] === c[a]) continue;
    let b = a + 1, last = a;
    for (; b < 0x10000 && b - last <= 4 && !ign[b]; b++) if (p[b] !== c[b]) last = b;
    d.push([a, b64(c.subarray(a, last + 1))]);
    a = last;
  }
  deltas.push(d);
}
mkdirSync(dirname(out), { recursive: true });
const gz = gzipSync(JSON.stringify({ idx, first: b64(first), deltas }), { level: 9 });
writeFileSync(out, gz);
console.log(`${idx.length} snapshots -> ${out} (${gz.length} bytes)`);
