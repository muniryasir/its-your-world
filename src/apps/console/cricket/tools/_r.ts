import { rngNext } from "../engine/rng";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
// e8e8 before the rain (engine at the yield = recording's value at the over start + over logic) is not
// directly in the recording; use the snapshot before (the last delivery's return) and after (next entry)
for (const name of ["spec1", "h2", "td1", "td2", "kc1"]) {
  const t = JSON.parse(gunzipSync(readFileSync(`traces/match/${name}.json.gz`)).toString());
  const snaps: Uint8Array[] = [new Uint8Array(Buffer.from(t.first, "base64"))];
  for (const d of t.deltas as [number, string][][]) { const r = snaps[snaps.length - 1].slice(); for (const [a, b] of d) r.set(Buffer.from(b, "base64"), a); snaps.push(r); }
  const rw = (r: Uint8Array, a: number) => (r[a] << 8) | r[a + 1];
  // find gaps where the clock jumped by >= $A0 minutes (a rain break)
  for (let i = 1; i < t.idx.length - 1; i++) {
    if (t.idx[i].pc !== 0xde7a || t.idx[i + 1].pc !== 0xe13e) continue;
    const c0 = rw(snaps[i], 0xbf0a), c1 = rw(snaps[i + 1], 0xbf0a);
    if (c1 - c0 < 0x90) continue;
    let v = rw(snaps[i], 0xe8e8), k = 0;
    const want = rw(snaps[i + 1], 0xe8e8);
    while (v !== want && k < 5000) { v = rngNext(v) & 0xffff; k++; }
    // a normal gap's count for comparison
    let v2 = rw(snaps[i - 2], 0xe8e8), k2 = 0; const w2 = rw(snaps[i - 1], 0xe8e8);
    while (v2 !== w2 && k2 < 5000) { v2 = rngNext(v2) & 0xffff; k2++; }
    console.log(name, "rain gap", i, "rng steps", k, "normal gap", k2, "c5cc", rw(snaps[i + 1], 0xc5cc).toString(16));
  }
}
