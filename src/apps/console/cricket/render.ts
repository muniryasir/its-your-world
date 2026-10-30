// Draws the batting view on a canvas from the engine state. Positions come from the original's own
// projection and sprite placement. With the original art loaded (art.ts) it draws the original's
// background, sprites, umpire and gauge needles; until then (or if it fails to load) players are drawn
// as flat silhouettes cut from the original's collision masks, on a night-time ground.

import type { Ram } from "./engine/mem";
import { projectFloat } from "./engine/project";
import { getMask } from "./engine/collide";
import type { View, Sprite, FieldScene } from "./engine/practice";
import { BOUNDARY } from "./engine/practice";
import { fieldScreen, outside } from "./engine/fieldlib";
import { getArt } from "./art";
import type { Art } from "./art";
import { ATLAS, STATIC_AT, GAUGES } from "./art/atlas";

export const SCREEN_W = 320;
export const SCREEN_H = 224;

const COLORS: Record<Sprite["kind"], string> = {
  batsman: "#f3f0ff",
  bowler: "#ff7ab3",
  fielder: "#2ed3a0",
  stumps: "#ffd23f",
};

const silhouettes = new Map<string, HTMLCanvasElement>();
function silhouette(frame: number, color: string): HTMLCanvasElement {
  const key = `${frame}:${color}`;
  let c = silhouettes.get(key);
  if (c) return c;
  const mk = getMask(frame);
  c = document.createElement("canvas");
  c.width = mk.w;
  c.height = mk.h;
  const ctx = c.getContext("2d")!;
  const img = ctx.createImageData(mk.w, mk.h);
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16));
  for (let y = 0; y < mk.h; y++)
    for (let x = 0; x < mk.w; x++) {
      if (!(mk.bits[y * mk.stride + (x >> 3)] & (0x80 >> (x & 7)))) continue;
      const o = 4 * (y * mk.w + x);
      // a little shading: darker towards the bottom and on the right edge
      const k = 1 - 0.28 * (y / mk.h);
      img.data[o] = r * k; img.data[o + 1] = g * k; img.data[o + 2] = b * k; img.data[o + 3] = 255;
    }
  ctx.putImageData(img, 0, 0);
  silhouettes.set(key, c);
  return c;
}

// fixed star field for the sky above the far rope
const STARS = Array.from({ length: 70 }, (_, i) => {
  const h = Math.sin(i * 12.9898) * 43758.5453;
  const g = Math.sin(i * 78.233) * 12345.678;
  return [((h - Math.floor(h)) * SCREEN_W) | 0, ((g - Math.floor(g)) * 30) | 0, (i % 3) + 1] as const;
});

/** draw one frame. `scale` = canvas pixels per original screen pixel */
export function drawScene(ctx: CanvasRenderingContext2D, m: Ram, view: View, scale: number, time: number): void {
  if (view.field) return drawField(ctx, m, view.field, scale);
  const art = getArt();
  if (art) return drawOriginal(ctx, m, view, scale, art);
  ctx.save();
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.imageSmoothingEnabled = false;
  const P = (x: number, y: number, h = 0) => projectFloat(m, x, -h, y);

  // sky
  const sky = ctx.createLinearGradient(0, 0, 0, 40);
  sky.addColorStop(0, "#07081a");
  sky.addColorStop(1, "#15183a");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, SCREEN_W, SCREEN_H);
  for (const [x, y, s] of STARS) {
    ctx.globalAlpha = 0.35 + 0.25 * Math.sin(time / 700 + x);
    ctx.fillStyle = "#dfe6ff";
    ctx.fillRect(x, y, s > 2 ? 1.5 : 1, s > 2 ? 1.5 : 1);
  }
  ctx.globalAlpha = 1;

  // the ground inside the rope
  const rope: [number, number][] = [];
  for (let a = -180; a <= 180; a += 3) {
    const r = (a * Math.PI) / 180;
    const p = P(BOUNDARY * Math.sin(r), BOUNDARY * Math.cos(r));
    if (p && BOUNDARY * Math.cos(r) > -2300) rope.push(p);
  }
  const outfield = ctx.createLinearGradient(0, 10, 0, SCREEN_H);
  outfield.addColorStop(0, "#0d3a3a");
  outfield.addColorStop(1, "#14524a");
  ctx.fillStyle = "#0b1027"; // beyond the rope
  ctx.fillRect(0, 12, SCREEN_W, SCREEN_H);
  ctx.beginPath();
  rope.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.lineTo(SCREEN_W + 400, SCREEN_H + 50);
  ctx.lineTo(-400, SCREEN_H + 50);
  ctx.closePath();
  ctx.fillStyle = outfield;
  ctx.fill();
  ctx.save();
  ctx.clip();
  // mowing stripes across the ground
  ctx.fillStyle = "rgba(255,255,255,0.035)";
  for (let y = -2400; y < BOUNDARY; y += 800) {
    const a = P(-9000, y), b = P(9000, y), c = P(9000, y + 400), d = P(-9000, y + 400);
    if (!a || !b || !c || !d) continue;
    ctx.beginPath(); ctx.moveTo(...a); ctx.lineTo(...b); ctx.lineTo(...c); ctx.lineTo(...d); ctx.fill();
  }
  ctx.restore();
  // the rope
  ctx.strokeStyle = "#ffd23f";
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  rope.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.stroke();

  // the pitch and creases
  const quad = (pts: [number, number][], fill?: string, stroke?: string, lw = 0.7) => {
    const s = pts.map(([x, y]) => P(x, y));
    if (s.some((p) => !p)) return;
    ctx.beginPath();
    s.forEach((p, i) => (i ? ctx.lineTo(p![0], p![1]) : ctx.moveTo(p![0], p![1])));
    ctx.closePath();
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.stroke(); }
  };
  quad([[-0xb0, -0x4c0], [0xb0, -0x4c0], [0xb0, 0x4c0], [-0xb0, 0x4c0]], "#5d5140");
  quad([[-0x60, -0x3a0], [0x60, -0x3a0], [0x60, 0x3a0], [-0x60, 0x3a0]], "rgba(255,240,210,0.06)");
  const line = (x1: number, y1: number, x2: number, y2: number) => {
    const a = P(x1, y1), b = P(x2, y2);
    if (!a || !b) return;
    ctx.beginPath(); ctx.moveTo(...a); ctx.lineTo(...b); ctx.stroke();
  };
  ctx.strokeStyle = "rgba(244,241,255,0.75)";
  ctx.lineWidth = 0.7;
  for (const s of [-1, 1]) {
    line(-0x120, s * 0x370, 0x120, s * 0x370); // popping crease
    line(-0x84, s * 0x400, 0x84, s * 0x400); // bowling crease
    line(-0x84, s * 0x370, -0x84, s * 0x440); // return creases
    line(0x84, s * 0x370, 0x84, s * 0x440);
  }

  // the aim marker while the machine sets its line and length
  if (view.marker) {
    ctx.beginPath();
    view.marker.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
    ctx.fillStyle = "rgba(46,211,160,0.25)";
    ctx.fill();
    ctx.strokeStyle = "#2ed3a0";
    ctx.lineWidth = 0.6;
    ctx.stroke();
  }

  // the ball's shadow on the ground
  const ball = view.ball;
  if (ball) {
    ctx.fillStyle = "rgba(0,0,0,0.45)";
    ctx.beginPath();
    ctx.ellipse(ball.hx, ball.hy, ball.r * 1.1, ball.r * 0.5, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // the bowler's-end stumps (the original draws them as part of its background)
  {
    ctx.strokeStyle = COLORS.stumps;
    ctx.lineWidth = 1.2;
    for (const x of [-0x14, 0, 0x14]) {
      const a = P(x, -0x400, 0), b = P(x, -0x400, 0x58);
      if (a && b) { ctx.beginPath(); ctx.moveTo(...a); ctx.lineTo(...b); ctx.stroke(); }
    }
  }

  // players, stumps and the ball, far to near (larger y = further from this camera)
  const items: { depth: number; draw: () => void }[] = view.sprites.map((s) => ({
    depth: s.depth,
    draw: () => ctx.drawImage(silhouette(s.frame, COLORS[s.kind]), s.x, s.y),
  }));
  if (ball)
    items.push({
      depth: ball.depth - 1,
      draw: () => {
        ctx.fillStyle = "#ff5a5f";
        ctx.beginPath();
        ctx.arc(ball.sx, ball.sy, ball.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "rgba(255,255,255,0.7)";
        ctx.fillRect(ball.sx - ball.r * 0.45, ball.sy - ball.r * 0.45, Math.max(0.6, ball.r * 0.45), Math.max(0.6, ball.r * 0.45));
      },
    });
  items.sort((a, b) => b.depth - a.depth).forEach((it) => it.draw());

  if (view.meters && view.mode === "bowl") drawMeters(ctx, view.meters); // (with the art: the original's gauges)
  ctx.restore();
}

/** the batting view with the original art: background, sprites from the atlas (the team palettes of the
 *  match being played), the umpire layer, the gauge needles */
function drawOriginal(ctx: CanvasRenderingContext2D, m: Ram, view: View, scale: number, art: Art): void {
  ctx.save();
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(art.bg, 0, 0);
  if (view.marker) {
    ctx.beginPath();
    view.marker.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
    ctx.fillStyle = "rgba(255,255,255,0.22)";
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.9)";
    ctx.lineWidth = 0.6;
    ctx.stroke();
  }
  const ball = view.ball;
  if (ball) {
    ctx.fillStyle = "rgba(0,0,0,0.4)";
    ctx.beginPath();
    ctx.ellipse(ball.hx, ball.hy, ball.r * 1.1, ball.r * 0.5, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  const sheet = view.mode === "bowl" ? art.sprites.bowl : art.sprites.bat;
  const sprite = (frame: number, x: number, y: number) => {
    const r = ATLAS[Math.abs(frame)];
    if (!r) return;
    const [sx, sy, w, h] = r;
    if (frame < 0) {
      ctx.save(); ctx.translate(x + w, y); ctx.scale(-1, 1);
      ctx.drawImage(sheet, sx, sy, w, h, 0, 0, w, h);
      ctx.restore();
    } else ctx.drawImage(sheet, sx, sy, w, h, x, y, w, h);
  };
  const items: { depth: number; draw: () => void }[] = view.sprites.map((s) => ({ depth: s.depth, draw: () => sprite(s.frame, s.x, s.y) }));
  // the umpire and the bowler's-end stumps stand just behind the bowler's crease
  items.push({ depth: -0x440, draw: () => ctx.drawImage(art.staticLayer, STATIC_AT[0], STATIC_AT[1]) });
  if (ball)
    items.push({
      depth: ball.depth - 1,
      draw: () => {
        ctx.fillStyle = "#c8102e";
        ctx.beginPath(); ctx.arc(ball.sx, ball.sy, ball.r, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "rgba(255,255,255,0.55)";
        ctx.fillRect(ball.sx - ball.r * 0.45, ball.sy - ball.r * 0.45, Math.max(0.6, ball.r * 0.4), Math.max(0.6, ball.r * 0.4));
      },
    });
  items.sort((a, b) => b.depth - a.depth).forEach((it) => it.draw());
  ctx.drawImage(art.fg, 0, 0); // high-priority background tiles (the gauges) cover low-priority sprites
  // the gauge needles (the original's high-priority sprites at the gauges)
  const g = view.gauges;
  if (g) {
    const py = Math.round(GAUGES.power.y + (g.needle * GAUGES.power.swing) / 32768);
    const sy = Math.round(GAUGES.speed.y - Math.max(0, Math.min(0x7f, g.pace)) / 4);
    ctx.drawImage(art.needles, 0, 0, 8, 16, GAUGES.power.x, py, 8, 16);
    ctx.drawImage(art.needles, 9, 0, 8, 16, GAUGES.speed.x, sy, 8, 16);
  }
  ctx.restore();
}

/** your bowling meters, bottom left: swing/spin direction, the power needle, the run-up pace */
function drawMeters(ctx: CanvasRenderingContext2D, mt: NonNullable<View["meters"]>): void {
  const x = 8, y = SCREEN_H - 46, w = 74, h = 38;
  ctx.fillStyle = "rgba(12,14,46,0.78)";
  ctx.strokeStyle = "rgba(201,196,242,0.25)";
  ctx.lineWidth = 0.6;
  ctx.beginPath(); ctx.roundRect(x, y, w, h, 4); ctx.fill(); ctx.stroke();
  ctx.font = "600 5.5px system-ui, sans-serif";
  ctx.textBaseline = "middle";
  const bar = (by: number, label: string, v: number, color: string, live: boolean) => {
    ctx.fillStyle = live ? "#f3f0ff" : "rgba(185,181,223,0.7)";
    ctx.fillText(label, x + 4, by + 2);
    ctx.fillStyle = "rgba(243,240,255,0.1)";
    ctx.fillRect(x + 26, by, 44, 4);
    ctx.fillStyle = color;
    ctx.fillRect(x + 26, by, 44 * v, 4);
  };
  const turn = mt.swing === 0 ? "" : mt.swing < 0 ? "◀ in" : "out ▶";
  ctx.fillStyle = mt.stage === "swing" ? "#ffd23f" : "rgba(185,181,223,0.7)";
  ctx.fillText(mt.swing === 0 ? "Fast" : `Move ${turn}`, x + 4, y + 7);
  bar(y + 16, "Power", mt.power, mt.power > 0.85 ? "#ffd23f" : "#2ed3a0", mt.stage === "meter");
  bar(y + 27, "Pace", mt.pace, "#ff5fa2", mt.stage === "runup");
}

/** top-down map of where the ball went (SVG path in world units, batsman's end at the top) */
export function fieldMapPath(path: [number, number][]): string {
  return path.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(0)} ${(-y).toFixed(0)}`).join(" ");
}

// ---------------------------------------------------------------- the fielding view (from above)

/** the rope in world units, traced from the original's boundary test (sub_035090) */
let ropeWorld: [number, number][] | null = null;
function rope(): [number, number][] {
  if (ropeWorld) return ropeWorld;
  ropeWorld = [];
  for (let a = 0; a < 360; a += 2) {
    const r = (a * Math.PI) / 180, dx = Math.sin(r), dy = Math.cos(r);
    let lo = 0, hi = 20000;
    for (let i = 0; i < 24; i++) { const mid = (lo + hi) / 2; if (outside(Math.round(dx * mid), Math.round(dy * mid))) hi = mid; else lo = mid; }
    ropeWorld.push([dx * lo, dy * lo]);
  }
  return ropeWorld;
}

const FIELD_COLORS = { field: "#2ed3a0", bat: "#f3f0ff", ball: "#ff5a5f" };

/** draw the fielding view: the ground from above, fielders, the batsmen running, the ball */
export function drawField(ctx: CanvasRenderingContext2D, m: Ram, f: FieldScene, scale: number): void {
  ctx.save();
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  const S = (x: number, y: number): [number, number] => fieldScreen(m, Math.round(x), 0, Math.round(y));
  ctx.fillStyle = "#0b1027"; // beyond the rope
  ctx.fillRect(0, 0, SCREEN_W, SCREEN_H);
  const path = (pts: [number, number][]) => {
    ctx.beginPath();
    pts.forEach(([x, y], i) => { const [sx, sy] = S(x, y); if (i) ctx.lineTo(sx, sy); else ctx.moveTo(sx, sy); });
    ctx.closePath();
  };
  const ground = rope();
  path(ground);
  ctx.fillStyle = "#14524a";
  ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.fillStyle = "rgba(255,255,255,0.035)"; // mowing stripes, along the pitch
  for (let x = -9000; x < 9000; x += 180) { path([[x, -9000], [x + 90, -9000], [x + 90, 9000], [x, 9000]]); ctx.fill(); }
  ctx.restore();
  path(ground);
  ctx.strokeStyle = "#ffd23f";
  ctx.lineWidth = 1;
  ctx.stroke();
  // the square, the pitch and the creases
  path([[-0x50, -0x4c0], [0x50, -0x4c0], [0x50, 0x4c0], [-0x50, 0x4c0]]);
  ctx.fillStyle = "#5d5140";
  ctx.fill();
  ctx.strokeStyle = "rgba(244,241,255,0.75)";
  ctx.lineWidth = 0.7;
  for (const s of [-1, 1]) {
    const [ax, ay] = S(-0x9c, s * 0x370), [bx, by] = S(0x9c, s * 0x370);
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
    const [cx, cy] = S(0, s * 0x400);
    ctx.fillStyle = "#ffd23f";
    ctx.fillRect(cx - 2, cy - 0.75, 4, 1.5); // the stumps
  }
  // your target (human fielding)
  if (f.target) {
    const { x, y } = f.target;
    ctx.strokeStyle = "rgba(255,210,63,0.85)"; ctx.lineWidth = 0.8;
    ctx.beginPath(); ctx.ellipse(x, y, 5, 3.4, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x - 7, y); ctx.lineTo(x - 3, y); ctx.moveTo(x + 3, y); ctx.lineTo(x + 7, y); ctx.stroke();
  }
  // players
  for (const p of f.players) {
    const r = p.side === "bat" ? 3.2 : 3.6;
    const a = (p.facing / 2048) * Math.PI * 2;
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.beginPath(); ctx.ellipse(p.x + 1, p.y + 1.5, r, r * 0.8, 0, 0, Math.PI * 2); ctx.fill();
    if (p.you) {
      ctx.strokeStyle = "#ffd23f"; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(p.x, p.y, r + 2.2, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.fillStyle = FIELD_COLORS[p.side];
    ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill();
    // facing: world angle (0 = +x, counter-clockwise towards +y, which is up the screen)
    ctx.strokeStyle = "#0b1027";
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x + Math.cos(a) * r, p.y - Math.sin(a) * r * 0.6); ctx.stroke();
    if (p.ball) { ctx.fillStyle = FIELD_COLORS.ball; ctx.beginPath(); ctx.arc(p.x + Math.cos(a) * r, p.y - Math.sin(a) * r * 0.6, 1.3, 0, Math.PI * 2); ctx.fill(); }
  }
  if (f.ball) {
    ctx.fillStyle = "rgba(0,0,0,0.45)";
    ctx.beginPath(); ctx.ellipse(f.ball.gx, f.ball.gy, 1.8, 1.2, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = FIELD_COLORS.ball;
    ctx.beginPath(); ctx.arc(f.ball.x, f.ball.y, 1.6, 0, Math.PI * 2); ctx.fill();
    // off the screen: an arrow at the edge, pointing at it
    const { gx, gy } = f.ball, M = 9;
    if (gx < 0 || gx > SCREEN_W || gy < 0 || gy > SCREEN_H) {
      const cx = SCREEN_W / 2, cy = SCREEN_H / 2, dx = gx - cx, dy = gy - cy;
      const k = Math.min((cx - M) / Math.abs(dx || 1e-6), (cy - M) / Math.abs(dy || 1e-6));
      const ax = cx + dx * k, ay = cy + dy * k, a = Math.atan2(dy, dx);
      ctx.save(); ctx.translate(ax, ay); ctx.rotate(a);
      ctx.fillStyle = FIELD_COLORS.ball;
      ctx.beginPath(); ctx.moveTo(6, 0); ctx.lineTo(-3, -4); ctx.lineTo(-1, 0); ctx.lineTo(-3, 4); ctx.closePath(); ctx.fill();
      ctx.restore();
    }
  }
  ctx.restore();
}
