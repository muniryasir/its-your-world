// The batting view's extras (phase 6 part E), as the original draws them:
// - top left, sub_010250: "1st Innings", "Eng. 59 for 1", "Runs Req. 120", "10.0 overs", and the time at an over's start;
// - bottom right, the fielders map ($4B3 dots over the oval; ground x, y → screen fitted to the original, under 1 px);
// - at an over's start, the bowler panel sliding up: "P.R.REIFFEL" / "5 OVERS  40 FOR 0" (then the map slides back).
import type { Ram } from "./engine/mem";
import { MATCH, inningsNo, total, wicketsIdx, ballsInOver, oversDone, totals } from "./engine/match";
import { playerName, TEAM_NAMES } from "./engine/matchGame";
import { HUD_FONT, PANEL_CHARS, PANEL_AT, MAP_AT } from "./art/atlas";

/** sub_01058a: "England" → "Eng.", "New Zealand" → "N.Z.", "Kenya" → "Ken." (three letters or fewer stay whole) */
export function teamAbbr(name: string): string {
  const words = name.split(/[ .]+/).filter(Boolean);
  if (words.length > 1) return words.map((w) => w[0].toUpperCase() + ".").join("");
  return name.length <= 3 ? name : name.slice(0, 3) + ".";
}

const mw = (m: Ram, o: number) => m.rw(MATCH + o);
/** the side batting in innings `inn` (sub_00BEEC: $BE68+0 or +4) */
function teamIn(m: Ram, inn: number): number {
  const first = mw(m, 8); // sub_00C838: which listed side bats first (0 or -1)
  let side = first !== 0 ? 1 : 0;
  if (inn >= 2 && mw(m, 0xa) !== 0) side ^= 1;
  if (inn & 1) side ^= 1;
  return mw(m, side ? 4 : 0);
}

function scoreLine(m: Ram, inn: number): string {
  const runs = total(m, inn), down = wicketsIdx(m, inn) + 1;
  const slot = inn >= 2 && mw(m, 0xa) !== 0 ? inn ^ 1 : inn;
  const dec = mw(m, 0x46 + 2 * slot) !== 0;
  return `${teamAbbr(TEAM_NAMES[teamIn(m, inn)])} ${runs}${down === 10 ? " all out" : ` for ${down}`}${dec ? " dec" : ""}`;
}

/** the lines and their y (x is 8) */
export function hudLines(m: Ram): [string, number][] {
  const out: [string, number][] = [];
  let y = 16;
  const I = inningsNo(m);
  if (mw(m, 0x14) > 1) { out.push([I & 2 ? "2nd Innings" : "1st Innings", y]); y += 24; }
  const line = (s: string) => { out.push([s, y]); y += 16; };
  const req = () => { const [d4, , d6] = totals(m); line(`Runs Req. ${d4 - d6 + 1}`); };
  if (!(I & 1)) line(scoreLine(m, I));
  else if (I === 1) {
    line(scoreLine(m, 0));
    line(scoreLine(m, 1));
    if (mw(m, 0x14) !== 3) req();
  } else { line(scoreLine(m, I)); req(); }
  line(`${oversDone(m)}.${ballsInOver(m)} overs`);
  if (ballsInOver(m) === 0) {
    const min = m.rw(0xbf0a), h = Math.floor(min / 60);
    out.push([`${h > 12 ? h - 12 : h}:${String(min % 60).padStart(2, "0")}${h < 12 ? "am" : "pm"}`, y + 8]);
  }
  return out;
}

/** the proportional font onto ctx (unknown characters are spaces, as sub_00a588 makes them) */
export function drawHudText(ctx: CanvasRenderingContext2D, font: HTMLImageElement, s: string, x: number, y: number): void {
  for (const c of s) {
    const g = HUD_FONT[c] ?? HUD_FONT[" "];
    if (g[1]) ctx.drawImage(font, g[0], 0, g[1], 16, x, y, g[1], 16);
    x += g[2];
  }
}

export function panelText(ctx: CanvasRenderingContext2D, font: HTMLImageElement, s: string, x: number, y: number): void {
  for (const c of s.toUpperCase()) {
    const k = Math.max(0, PANEL_CHARS.indexOf(c));
    ctx.drawImage(font, k * 8, 0, 8, 16, x, y, 8, 16);
    x += 8;
  }
}

/** the bowler's panel lines: name and figures ($E950: " Overs  ", " Over  ", " For ") */
export function panelLines(m: Ram): [string, string] | null {
  const field = m.rl(0xb522) & 0xffff;
  for (let k = 0; k < 11; k++) {
    const r = field + 0x68 * k;
    if (m.rw(r + 6) !== 1) continue;
    const ov = (m.rw(r + 0x10) & 0xffff) >> 4;
    return [playerName(m, r), `${ov}${ov === 1 ? " OVER  " : " OVERS  "}${m.rw(r + 0x14)} FOR ${m.rw(r + 0x16)}`];
  }
  return null;
}

export interface HudArt { hudFont: HTMLImageElement; panelFont: HTMLImageElement; panelBox: HTMLImageElement; mapOval: HTMLImageElement; mapDot: HTMLImageElement }

// the panel comes up at the start of each over: 8 px a frame in, ~3.2 s up, 8 px a frame out; the map follows it
let panelKey = "", panelAt = -1e9;
const PANEL_UP = 3200, SLIDE = 6 * 20;

/** the extras over the batting view; `bowling` = the ball not yet bowled (the map's dots go when it is) */
export function drawHud(ctx: CanvasRenderingContext2D, m: Ram, art: HudArt, bowling: boolean, time: number): void {
  for (const [s, y] of hudLines(m)) drawHudText(ctx, art.hudFont, s, 8, y);
  const key = `${inningsNo(m)}:${oversDone(m)}`;
  if (bowling && ballsInOver(m) === 0 && key !== panelKey) { panelKey = key; panelAt = time; }
  const t = time - panelAt;
  // panel offset (0 = fully in, 48 = gone) and the map's (0 = in, 56 = gone)
  let panelOff = 48, mapOff = 0;
  if (t >= 0 && t < PANEL_UP + 2 * SLIDE) {
    panelOff = t < SLIDE ? 48 - (48 * t) / SLIDE : t < SLIDE + PANEL_UP ? 0 : (48 * (t - SLIDE - PANEL_UP)) / SLIDE;
    mapOff = 56;
  } else if (t >= PANEL_UP + 2 * SLIDE && t < PANEL_UP + 3 * SLIDE) mapOff = 56 - (56 * (t - PANEL_UP - 2 * SLIDE)) / SLIDE;
  panelOff = Math.round(panelOff / 8) * 8; mapOff = Math.round(mapOff / 8) * 8;
  if (mapOff < 56) {
    ctx.drawImage(art.mapOval, MAP_AT[0], MAP_AT[1] + mapOff);
    if (bowling) {
      const field = m.rl(0xb522) & 0xffff;
      for (let k = 0; k < 11; k++) {
        const r = field + 0x68 * k;
        const x = 269 + m.rw(r + 0x3c) * 0.00757, y = 196 - m.rw(r + 0x44) * 0.00323 + mapOff;
        ctx.drawImage(art.mapDot, Math.round(x), Math.round(y));
      }
    }
  }
  const lines = panelOff < 48 ? panelLines(m) : null;
  if (lines) {
    const [px, py] = [PANEL_AT[0], PANEL_AT[1] + panelOff];
    ctx.drawImage(art.panelBox, px, py);
    panelText(ctx, art.panelFont, lines[0], px + 8, py + 8);
    panelText(ctx, art.panelFont, lines[1], px + 8, py + 32);
  }
}

/** width of a line in the proportional font */
export function hudTextWidth(s: string): number {
  let w = 0;
  for (const c of s) w += (HUD_FONT[c] ?? HUD_FONT[" "])[2];
  return w;
}

/** a banner between balls in the original's look: the bowler panel's box, the headline in its tile font
 *  (capitals), the detail in the proportional font; both centred */
export function drawBanner(ctx: CanvasRenderingContext2D, art: HudArt, text: string, sub?: string): void {
  ctx.clearRect(0, 0, 208, 48);
  ctx.drawImage(art.panelBox, 0, 0);
  const head = text.toUpperCase().replace(/[^ .'0-9A-Z/:]/g, " ").slice(0, 24);
  panelText(ctx, art.panelFont, head, Math.round((208 - head.length * 8) / 2), sub ? 6 : 16);
  if (sub) {
    let t = sub.replace(/·/g, "-").replace(/[^ -~]/g, " ");
    while (t.length > 3 && hudTextWidth(t) > 196) t = t.slice(0, -2) + ".";
    drawHudText(ctx, art.hudFont, t, Math.round((208 - hudTextWidth(t)) / 2), 26);
  }
}
