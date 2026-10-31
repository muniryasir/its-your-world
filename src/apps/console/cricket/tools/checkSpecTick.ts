// dev: run a full-RAM delivery trace that starts at sub_00E13E's entry through the match Delivery set-up
import { readFileSync } from "node:fs"; import { gunzipSync } from "node:zlib";
import { Ram } from "../engine/mem";
import { deliveryPrelude, contextFromRam } from "../engine/match";
import { checkTrace } from "./check";
const tr = JSON.parse(gunzipSync(readFileSync(process.argv[2])).toString());
// prelude on the start RAM, then hand to the normal checker (newDelivery + setUpField happen there)
const buf = Buffer.from(tr.ram[0][1], "base64");
const m = new Ram(new Uint8Array(buf));
deliveryPrelude(m);
tr.ram = [[0, Buffer.from(m.buf).toString("base64")]];
tr.ctx = contextFromRam(m);
console.log(checkTrace(tr));
