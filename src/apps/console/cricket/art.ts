// The original game's art for the page (console/cricket branch only): images decoded from the ROM and
// the original's video memory by analysis/tools/p3/gen_art.py and p6/gen_team_art.py (see art/atlas.ts).
// The sprites are kept as palette indices and coloured for the two teams of the match (their palettes
// from the ROM, engine/teamData.ts). Loaded once; until the images are ready the renderer falls back to
// silhouettes cut from the collision masks.
import bgBat from "./art/batting-bg-bat.png";
import bgBowl from "./art/batting-bg-bowl.png";
import fgBat from "./art/batting-fg-bat.png";
import fgBowl from "./art/batting-fg-bowl.png";
import spritesIdx from "./art/sprites-idx.png";
import staticLayer from "./art/static.png";
import needles from "./art/needles.png";
import groundBat from "./art/field-ground-bat.png";
import groundBowl from "./art/field-ground-bowl.png";
import fieldIdx from "./art/field-sprites-idx.png";
import overlay from "./art/field-overlay.png";
import runoutIdx from "./art/runout-idx.png";
import { FIXED_COLOURS, RUNOUT } from "./art/atlas";
import { TEAM_DATA } from "./engine/teamData";
import type { Ram } from "./engine/mem";

export interface Sheets { sprites: CanvasImageSource; field: CanvasImageSource }
export interface Art {
  /** the batting view's background in each match's conditions (bat: the first recorded match; bowl: the second) */
  bg: { bat: HTMLImageElement; bowl: HTMLImageElement };
  /** the background's high-priority tiles (the gauges): over the sprites */
  fg: { bat: HTMLImageElement; bowl: HTMLImageElement };
  staticLayer: HTMLImageElement;
  needles: HTMLImageElement;
  /** the fielding view: the whole ground in each match's colours, the pitch overlay */
  field: { ground: { bat: HTMLImageElement; bowl: HTMLImageElement }; overlay: HTMLImageElement };
  /** the sprite atlases (batting view, fielding view) in the colours of the side batting and the side
   *  fielding, white or coloured kits */
  sheets(bat: number, field: number, coloured: boolean): Sheets;
  /** the run-out close-up's frames (atlas RUNOUT) in the two teams' colours */
  runout(bat: number, field: number, coloured: boolean): HTMLCanvasElement;
}

/** a Mega Drive colour word (0000 BBB0 GGG0 RRR0) as the VDP shows it */
const rgb = (wd: number): [number, number, number] => {
  const to8 = (x: number) => (x << 5) | (x << 2) | (x >> 1);
  return [to8((wd >> 1) & 7), to8((wd >> 5) & 7), to8((wd >> 9) & 7)];
};

/** the teams of the match in RAM: [batting, fielding, coloured kits] */
export function matchColours(m: Ram): [number, number, boolean] {
  const first = (m.rl(0xb51c) & 0xffff) === 0xb528;
  const a = m.rw(0xbe68), b = m.rw(0xbe6c);
  const ok = (t: number) => (t >= 0 && t < TEAM_DATA.length ? t : 0);
  return [ok(first ? a : b), ok(first ? b : a), m.rw(0xbe68 + 0x1a) !== 0];
}

let art: Art | null = null;
let loading = false;

function indices(im: HTMLImageElement): ImageData {
  const c = document.createElement("canvas");
  c.width = im.width; c.height = im.height;
  const ctx = c.getContext("2d")!;
  ctx.drawImage(im, 0, 0);
  return ctx.getImageData(0, 0, im.width, im.height);
}

function colour(idx: ImageData, bat: number, field: number, coloured: boolean, closeUp = false): HTMLCanvasElement {
  const pal = new Array<[number, number, number] | null>(64).fill(null);
  const pb = TEAM_DATA[bat].palettes[coloured ? 2 : 0], pf = TEAM_DATA[field].palettes[coloured ? 3 : 1];
  for (let k = 0; k < 16; k++) { pal[16 + k] = rgb(pb[k]); pal[32 + k] = rgb(pf[k]); }
  if (closeUp) for (let k = 0; k < 16; k++) { pal[k] = rgb(RUNOUT.line0[k]); pal[48 + k] = rgb(RUNOUT.line3[k]); }
  else for (const [k, v] of Object.entries(FIXED_COLOURS)) pal[+k] = v;
  const c = document.createElement("canvas");
  c.width = idx.width; c.height = idx.height;
  const ctx = c.getContext("2d")!;
  const out = ctx.createImageData(idx.width, idx.height);
  const s = idx.data, d = out.data;
  for (let i = 0; i < s.length; i += 4) {
    const v = s[i];
    if (!closeUp && (v === 0 || (v & 15) === 0 || s[i + 3] === 0)) continue;
    const p = closeUp && (v & 15) === 0 ? pal[0] : pal[v];
    if (!p) continue;
    d[i] = p[0]; d[i + 1] = p[1]; d[i + 2] = p[2]; d[i + 3] = 255;
  }
  ctx.putImageData(out, 0, 0);
  return c;
}

/** the art if it has loaded (starts loading on the first call) */
export function getArt(): Art | null {
  if (art || loading || typeof Image === "undefined") return art;
  loading = true;
  const load = (src: string) => new Promise<HTMLImageElement>((ok, fail) => {
    const im = new Image();
    im.onload = () => ok(im);
    im.onerror = fail;
    im.src = src;
  });
  Promise.all([bgBat, bgBowl, fgBat, fgBowl, spritesIdx, staticLayer, needles, groundBat, groundBowl, fieldIdx, overlay, runoutIdx].map(load))
    .then(([bga, bgb, fga, fgb, sidx, st, nd, gba, gbo, fidx, ov, ridx]) => {
      const si = indices(sidx), fi = indices(fidx), ri = indices(ridx);
      const roCache = new Map<string, HTMLCanvasElement>();
      const cache = new Map<string, Sheets>();
      art = {
        bg: { bat: bga, bowl: bgb }, fg: { bat: fga, bowl: fgb }, staticLayer: st, needles: nd,
        field: { ground: { bat: gba, bowl: gbo }, overlay: ov },
        sheets(bat, field, coloured) {
          const key = `${bat}:${field}:${coloured ? 1 : 0}`;
          let s = cache.get(key);
          if (!s) { s = { sprites: colour(si, bat, field, coloured), field: colour(fi, bat, field, coloured) }; cache.set(key, s); }
          return s;
        },
        runout(bat, field, coloured) {
          const key = `${bat}:${field}:${coloured ? 1 : 0}`;
          let c = roCache.get(key);
          if (!c) { c = colour(ri, bat, field, coloured, true); roCache.set(key, c); }
          return c;
        },
      };
    })
    .catch(() => { /* stay on the silhouettes */ });
  return null;
}
