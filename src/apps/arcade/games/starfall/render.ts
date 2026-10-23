// Canvas drawing for Starfall: the board, the hold box and the next queue.
// Pieces are drawn as faceted "star-crystals" in the hub's colors. Each
// crystal is pre-rendered once per size into a sprite, so a frame is mostly
// cheap image copies.
import { COLS, HIDDEN, ROWS, pieceCells, type PieceKind, type Starfall } from "./engine";

/** Crystal color per piece kind (index 1..7). */
export const CRYSTAL_COLORS = ["", "#2ed3a0", "#ffd23f", "#a98bff", "#7be36a", "#ff5fa2", "#5b8cff", "#ff9c5a"];

type Rgb = [number, number, number];
const hexToRgb = (hex: string): Rgb => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const mix = (c: Rgb, to: number, amount: number) =>
  `rgb(${c.map((v) => Math.round(v + (to - v) * amount)).join(",")})`;
const rgba = (c: Rgb, a: number) => `rgba(${c.join(",")},${a})`;

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function sparkle(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x, y - r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.quadraticCurveTo(x, y, x, y + r);
  ctx.quadraticCurveTo(x, y, x - r, y);
  ctx.quadraticCurveTo(x, y, x, y - r);
  ctx.fill();
}

/** Draws one crystal into a square of `s` device pixels. */
function paintCrystal(ctx: CanvasRenderingContext2D, color: string, s: number) {
  const c = hexToRgb(color);
  const inset = Math.max(1, s * 0.04);
  const r = s * 0.24;
  const body = ctx.createLinearGradient(0, 0, s, s);
  body.addColorStop(0, mix(c, 255, 0.35));
  body.addColorStop(0.5, color);
  body.addColorStop(1, mix(c, 0, 0.38));
  roundRect(ctx, inset, inset, s - inset * 2, s - inset * 2, r);
  ctx.fillStyle = body;
  ctx.fill();

  // Facet: a soft light band across the top half
  const f = s * 0.2;
  const facet = ctx.createLinearGradient(0, f, 0, s - f);
  facet.addColorStop(0, "rgba(255,255,255,0.42)");
  facet.addColorStop(0.55, "rgba(255,255,255,0.06)");
  facet.addColorStop(1, "rgba(255,255,255,0)");
  roundRect(ctx, f, f, s - f * 2, s - f * 2, r * 0.6);
  ctx.fillStyle = facet;
  ctx.fill();

  // Rim and a small star glint
  roundRect(ctx, inset + 0.5, inset + 0.5, s - inset * 2 - 1, s - inset * 2 - 1, r);
  ctx.strokeStyle = "rgba(255,255,255,0.28)";
  ctx.lineWidth = Math.max(1, s * 0.03);
  ctx.stroke();
  ctx.fillStyle = "rgba(255,255,255,0.9)";
  sparkle(ctx, s * 0.32, s * 0.32, s * 0.13);
}

type Sprites = { size: number; crystals: HTMLCanvasElement[]; dim: HTMLCanvasElement[] };

function makeSprites(size: number): Sprites {
  const crystals: HTMLCanvasElement[] = [];
  const dim: HTMLCanvasElement[] = [];
  for (let k = 1; k <= 7; k++) {
    for (const [list, alpha] of [[crystals, 1], [dim, 0.32]] as const) {
      const cv = document.createElement("canvas");
      cv.width = cv.height = size;
      const ctx = cv.getContext("2d")!;
      ctx.globalAlpha = alpha;
      paintCrystal(ctx, CRYSTAL_COLORS[k], size);
      list[k] = cv;
    }
  }
  return { size, crystals, dim };
}

type Flash = { rows: number[]; start: number };
const FLASH_MS = 320;

/** Draws a game onto the three canvases. Call `resize` when the layout changes. */
export class StarfallRenderer {
  private cell = 24;
  private small = 14;
  private dpr = 1;
  private sprites: Sprites | null = null;
  private smallSprites: Sprites | null = null;
  private background: HTMLCanvasElement | null = null;
  private flashes: Flash[] = [];

  constructor(
    private board: HTMLCanvasElement,
    private hold: HTMLCanvasElement,
    private next: HTMLCanvasElement,
  ) {}

  /** Sets the size of a board cell and of a hold/next cell, in CSS pixels. */
  resize(cell: number, smallCell: number) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (cell === this.cell && smallCell === this.small && dpr === this.dpr && this.sprites) return;
    this.cell = cell;
    this.small = smallCell;
    this.dpr = dpr;
    this.sprites = makeSprites(Math.round(cell * dpr));
    this.smallSprites = makeSprites(Math.round(this.smallCell() * dpr));
    this.setSize(this.board, cell * COLS, cell * ROWS);
    this.setSize(this.hold, this.smallCell() * 4.6, this.smallCell() * 3.6);
    this.setSize(this.next, this.smallCell() * 4.6, this.smallCell() * 10.4);
    this.background = this.paintBackground();
  }

  private smallCell() {
    return this.small;
  }

  private setSize(cv: HTMLCanvasElement, w: number, h: number) {
    cv.width = Math.round(w * this.dpr);
    cv.height = Math.round(h * this.dpr);
    cv.style.width = `${w}px`;
    cv.style.height = `${h}px`;
  }

  private paintBackground(): HTMLCanvasElement {
    const cv = document.createElement("canvas");
    cv.width = this.board.width;
    cv.height = this.board.height;
    const ctx = cv.getContext("2d")!;
    ctx.scale(this.dpr, this.dpr);
    const w = this.cell * COLS;
    const h = this.cell * ROWS;
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, "#0b0d2b");
    g.addColorStop(1, "#141748");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    // Faint dots where cell corners meet
    ctx.fillStyle = "rgba(201,196,242,0.16)";
    for (let y = 1; y < ROWS; y++) {
      for (let x = 1; x < COLS; x++) {
        ctx.beginPath();
        ctx.arc(x * this.cell, y * this.cell, 1, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    // A few fixed background stars
    let seed = 7;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 40; i++) {
      ctx.fillStyle = `rgba(243,240,255,${0.15 + rand() * 0.35})`;
      ctx.fillRect(rand() * w, rand() * h, rand() < 0.2 ? 2 : 1, rand() < 0.2 ? 2 : 1);
    }
    return cv;
  }

  /** Remember line clears so they can flash for a moment. */
  addFlash(rows: number[]) {
    this.flashes.push({ rows, start: performance.now() });
  }

  draw(game: Starfall) {
    if (!this.sprites || !this.background) return;
    this.drawBoard(game);
    this.drawHold(game);
    this.drawNext(game);
  }

  private drawBoard(game: Starfall) {
    const ctx = this.board.getContext("2d")!;
    const c = this.cell;
    const { crystals, dim } = this.sprites!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.background!, 0, 0);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    for (let y = HIDDEN; y < HIDDEN + ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        const k = game.cell(x, y);
        if (k) ctx.drawImage(crystals[k], x * c, (y - HIDDEN) * c, c, c);
      }
    }

    const p = game.piece;
    if (p && !game.over) {
      const cells = pieceCells(p.kind, p.rotation);
      // Ghost: where the piece will land
      const gy = game.ghostY;
      if (gy !== p.y) {
        for (const [cx, cy] of cells) {
          const y = gy + cy - HIDDEN;
          if (y >= 0) ctx.drawImage(dim[p.kind], (p.x + cx) * c, y * c, c, c);
        }
      }
      // The falling piece, with a soft glow
      ctx.save();
      ctx.shadowColor = CRYSTAL_COLORS[p.kind];
      ctx.shadowBlur = c * 0.6;
      for (const [cx, cy] of cells) {
        const y = p.y + cy - HIDDEN;
        if (y >= 0) ctx.drawImage(crystals[p.kind], (p.x + cx) * c, y * c, c, c);
      }
      ctx.restore();
    }

    // Line clear flashes
    const now = performance.now();
    this.flashes = this.flashes.filter((f) => now - f.start < FLASH_MS);
    for (const f of this.flashes) {
      const t = (now - f.start) / FLASH_MS;
      ctx.fillStyle = `rgba(255,244,214,${0.85 * (1 - t)})`;
      for (const row of f.rows) {
        if (row < 0) continue;
        const grow = c * 0.5 * t;
        ctx.fillRect(0, row * c - grow / 2, c * COLS, c + grow);
      }
    }
  }

  private drawPiece(ctx: CanvasRenderingContext2D, kind: PieceKind, cx: number, cy: number, sprites: HTMLCanvasElement[]) {
    const s = this.smallCell();
    const cells = pieceCells(kind, 0);
    const xs = cells.map(([x]) => x);
    const ys = cells.map(([, y]) => y);
    const w = (Math.max(...xs) - Math.min(...xs) + 1) * s;
    const h = (Math.max(...ys) - Math.min(...ys) + 1) * s;
    const ox = cx - w / 2 - Math.min(...xs) * s;
    const oy = cy - h / 2 - Math.min(...ys) * s;
    for (const [x, y] of cells) ctx.drawImage(sprites[kind], ox + x * s, oy + y * s, s, s);
  }

  private drawHold(game: Starfall) {
    const ctx = this.hold.getContext("2d")!;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const s = this.smallCell();
    ctx.clearRect(0, 0, s * 4.6, s * 3.6);
    if (game.holdKind) {
      const sprites = game.holdUsed ? this.smallSprites!.dim : this.smallSprites!.crystals;
      this.drawPiece(ctx, game.holdKind, s * 2.3, s * 1.8, sprites);
    }
  }

  private drawNext(game: Starfall) {
    const ctx = this.next.getContext("2d")!;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const s = this.smallCell();
    ctx.clearRect(0, 0, s * 4.6, s * 10.4);
    game.preview.forEach((kind, i) => {
      this.drawPiece(ctx, kind, s * 2.3, s * (1.7 + i * 3.4), this.smallSprites!.crystals);
    });
  }
}
