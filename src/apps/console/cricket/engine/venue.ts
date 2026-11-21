// The venue and its conditions (sub_02C2A8): the original's venue table ($2C122, one entry per country of
// the team list) gives the climate (which ground graphics and outfield) and the chances of each pitch
// and weather; the pitch and weather are drawn from them at the start of a match, or chosen on the
// original's weather screen. ROM-derived (console/cricket branch only).
import { Ram } from "./mem";
import { rngNextAt } from "./rngAt";
import { MATCH } from "./match";

/** per venue: climate, then the pitch chances (+6..+$C, out of 256: hard, dusty, hard/green, green;
 *  the rest damp) and the weather chances (+$10..+$14, pairs of weathers; the rest the last pair) */
const VENUE: { climate: number; pitch: [number, number, number, number]; weather: [number, number, number] }[] = [
  [0, 51, 25, 76, 51, 51, 76, 76], [1, 51, 25, 102, 51, 204, 51, 0], [0, 51, 25, 76, 51, 51, 76, 76],
  [3, 76, 102, 51, 25, 204, 51, 0], [3, 76, 102, 51, 25, 204, 51, 0], [3, 76, 102, 51, 25, 204, 51, 0],
  [2, 51, 25, 102, 51, 204, 51, 0], [4, 76, 25, 76, 51, 204, 51, 0], [4, 76, 25, 76, 51, 204, 51, 0],
  [0, 51, 25, 76, 51, 51, 76, 76], [4, 76, 25, 76, 51, 204, 51, 0], [3, 76, 102, 51, 25, 204, 51, 0],
].map(([c, p0, p1, p2, p3, w0, w1, w2]) => ({ climate: c, pitch: [p0, p1, p2, p3], weather: [w0, w1, w2] }));
/** the climate table ($2D6A0): the words sub_02D662 copies to $C5AE (ground graphics in the ROM) */
const CLIMATE: number[][] = [
  [5, 44204, 5, 45444], [5, 44204, 5, 45444], [5, 47908, 5, 49148], [5, 51460, 5, 52700], [5, 54860, 5, 56100],
];

export const VENUES = VENUE.length;
export const PITCH_NAMES = ["Hard", "Dusty", "Hard, slightly green", "Green", "Damp"];
export const WEATHER_NAMES = ["Sunny, hot", "Sunny, hot, humid", "Cloudy, humid", "Cloudy, warm", "Overcast, warm", "Overcast, mild", "Grey clouds, humid", "Grey clouds, mild"];

/** sub_02D662: the climate's ground (+$26 and $C5AA..$C5B9) */
function climate(m: Ram, c: number): void {
  m.ww(MATCH + 0x26, c);
  m.ww(0xc5aa, 0x14); m.ww(0xc5ac, 0x3e7);
  CLIMATE[c].forEach((v, i) => m.ww(0xc5ae + 2 * i, v));
  m.wl(0xc5b6, 0);
}

/** sub_02C2A8 (a venue chosen: $BE88): pitch and weather drawn from the venue's chances, unless given */
export function venueConditions(m: Ram, venue: number, pitch?: number, weather?: number): void {
  const v = VENUE[venue] ?? VENUE[0];
  m.ww(0xbe88, venue);
  let r = rngNextAt(m) & 0xff, p = 0;
  for (const t of v.pitch) { r -= t; if (r < 0) break; p++; }
  r = rngNextAt(m) & 0xff;
  let wd = 0;
  for (const t of v.weather) { r -= t; if (r < 0) break; wd += 2; }
  wd += rngNextAt(m) & 1;
  m.ww(MATCH + 0x22, pitch ?? p);
  m.ww(MATCH + 0x24, weather ?? wd);
  climate(m, v.climate);
}

/** the chance of rain the original's weather screen shows (sub_02DC..: $C5E0 x 100 / 256) */
export const rainChance = (m: Ram) => ((m.rw(0xc5e0) * 100) >> 8);
