// The original game's art for the page (console/cricket branch only): images decoded from the ROM and
// the original's video memory by analysis/tools/p3/gen_art.py (see art/atlas.ts). Loaded once; until the
// images are ready the renderer falls back to silhouettes cut from the collision masks.
import bgBat from "./art/batting-bg-bat.png";
import bgBowl from "./art/batting-bg-bowl.png";
import fgBat from "./art/batting-fg-bat.png";
import fgBowl from "./art/batting-fg-bowl.png";
import spritesBat from "./art/sprites-bat.png";
import spritesBowl from "./art/sprites-bowl.png";
import staticLayer from "./art/static.png";
import needles from "./art/needles.png";
import groundBat from "./art/field-ground-bat.png";
import groundBowl from "./art/field-ground-bowl.png";
import fieldBat from "./art/field-sprites-bat.png";
import fieldBowl from "./art/field-sprites-bowl.png";
import overlay from "./art/field-overlay.png";

export interface Art {
  /** the batting view's background in each match's colours (bat: England bat; bowl: Australia bat) */
  bg: { bat: HTMLImageElement; bowl: HTMLImageElement };
  /** the background's high-priority tiles (the gauges): over the sprites */
  fg: { bat: HTMLImageElement; bowl: HTMLImageElement };
  /** sprite atlases coloured with the batting match's palettes (England bat) / the bowling match's (Australia bat) */
  sprites: { bat: HTMLImageElement; bowl: HTMLImageElement };
  staticLayer: HTMLImageElement;
  needles: HTMLImageElement;
  /** the fielding view: the whole ground in each match's colours, its sprites, the pitch overlay */
  field: {
    ground: { bat: HTMLImageElement; bowl: HTMLImageElement };
    sprites: { bat: HTMLImageElement; bowl: HTMLImageElement };
    overlay: HTMLImageElement;
  };
}

let art: Art | null = null;
let loading = false;

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
  Promise.all([bgBat, bgBowl, fgBat, fgBowl, spritesBat, spritesBowl, staticLayer, needles, groundBat, groundBowl, fieldBat, fieldBowl, overlay].map(load))
    .then(([bga, bgb, fga, fgb, bat, bowl, st, nd, gba, gbo, fba, fbo, ov]) => {
      art = {
        bg: { bat: bga, bowl: bgb }, fg: { bat: fga, bowl: fgb }, sprites: { bat, bowl }, staticLayer: st, needles: nd,
        field: { ground: { bat: gba, bowl: gbo }, sprites: { bat: fba, bowl: fbo }, overlay: ov },
      };
    })
    .catch(() => { /* stay on the silhouettes */ });
  return null;
}
