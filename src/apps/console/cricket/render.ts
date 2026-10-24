// Draws the batting view on a canvas from the engine state. Positions come from the original's own
// projection and sprite placement; the look is our own: players are drawn as flat silhouettes cut from
// the original's collision masks, on a night-time ground.

import type { Ram } from "./engine/mem";
import { projectFloat } from "./engine/project";
import { getMask } from "./engine/collide";
import type { View, Sprite } from "./engine/practice";
import { BOUNDARY } from "./engine/practice";

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

  ctx.restore();
}

/** top-down map of where the ball went (SVG path in world units, batsman's end at the top) */
export function fieldMapPath(path: [number, number][]): string {
  return path.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(0)} ${(-y).toFixed(0)}`).join(" ");
}
