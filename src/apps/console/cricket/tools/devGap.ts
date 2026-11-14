// dev: changed RAM between two snapshots of a recording (outside the ignore lists), as words
// usage: npx tsx tools/devGap.ts REC.bin I J
import { readFileSync } from "node:fs";
import { IGNORE, UI } from "./checkMatchIgnore";
const file = process.argv[2]; const i = +process.argv[3], j = +process.argv[4];
const all = readFileSync(file);
const snap = (k: number) => new Uint8Array(all.buffer, all.byteOffset + k * 0x10000, 0x10000);
const ign = new Uint8Array(0x10000); for (const [a, b] of [...IGNORE, ...UI]) ign.fill(1, a, b);
const A = snap(i), B = snap(j);
let run: number[] = [];
const flush = () => {
  if (!run.length) return;
  const a = run[0] & ~1, b = run[run.length - 1] | 1;
  const hex = (u: Uint8Array) => Array.from(u.slice(a, b + 1), (x) => x.toString(16).padStart(2, "0")).join("").replace(/(.{4})/g, "$1 ");
  console.log(`${a.toString(16)}: ${hex(A)}-> ${hex(B)}`);
  run = [];
};
for (let a = 0; a < 0x10000; a++) {
  if (ign[a] || A[a] === B[a]) continue;
  if (run.length && a > run[run.length - 1] + 2) flush();
  run.push(a);
}
flush();
