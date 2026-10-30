// The original game's art for the page (console/cricket branch only): images decoded from the ROM and
// the original's video memory by analysis/tools/p3/gen_art.py (see art/atlas.ts). Loaded once; until the
// images are ready the renderer falls back to silhouettes cut from the collision masks.
import batsBg from "./art/batting-bg.png";
import batsFg from "./art/batting-fg.png";
import spritesBat from "./art/sprites-bat.png";
import spritesBowl from "./art/sprites-bowl.png";
import staticLayer from "./art/static.png";
import needles from "./art/needles.png";

export interface Art {
  bg: HTMLImageElement;
  /** the background's high-priority tiles (the gauges): over the sprites */
  fg: HTMLImageElement;
  /** sprite atlases coloured with the batting match's palettes (England bat) / the bowling match's (Australia bat) */
  sprites: { bat: HTMLImageElement; bowl: HTMLImageElement };
  staticLayer: HTMLImageElement;
  needles: HTMLImageElement;
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
  Promise.all([batsBg, batsFg, spritesBat, spritesBowl, staticLayer, needles].map(load))
    .then(([bg, fg, bat, bowl, st, nd]) => { art = { bg, fg, sprites: { bat, bowl }, staticLayer: st, needles: nd }; })
    .catch(() => { /* stay on the silhouettes */ });
  return null;
}
