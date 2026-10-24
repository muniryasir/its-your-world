// Canvas drawing for Nova Raiders. The canvas is drawn at the game's own
// resolution (160 × 192 plus a 12-pixel score bar) and scaled up by CSS with
// `image-rendering: pixelated`, so every game pixel stays a crisp square.
// Effects here (stars, explosion bits, flashes) are cosmetic and client-only;
// nothing in this file affects the game itself.
import { HEIGHT, SUB, WIDTH, type EnemyType, type GameEvent, type NovaRaiders } from "./engine";
import {
  AIMED_SHOT_COLOR,
  BACKGROUND,
  ENEMY_COLORS,
  ENEMY_SHOT_COLOR,
  ENEMY_SPRITES,
  FONT,
  LIFE,
  MINE,
  MINE_COLOR,
  PLAYER,
  PLAYER_COLOR,
  SHOT_COLOR,
  type Sprite,
} from "./sprites";

export const HUD_HEIGHT = 12;
export const CANVAS_WIDTH = WIDTH;
export const CANVAS_HEIGHT = HEIGHT + HUD_HEIGHT;

type Particle = { x: number; y: number; vx: number; vy: number; life: number; color: string; size: number };
type Star = { x: number; y: number; speed: number; tone: number };

const STAR_TONES = ["#4a4596", "#6f69c8", "#b3aef0", "#f3f0ff"];

export class NovaRenderer {
  private ctx: CanvasRenderingContext2D;
  private sprites = new Map<string, HTMLCanvasElement>();
  private particles: Particle[] = [];
  private stars: Star[] = [];
  private frame = 0;
  private flash = 0;

  constructor(private canvas: HTMLCanvasElement) {
    canvas.width = CANVAS_WIDTH;
    canvas.height = CANVAS_HEIGHT;
    this.ctx = canvas.getContext("2d")!;
    this.ctx.imageSmoothingEnabled = false;
    // A fixed starfield (the same every time, so screenshots are stable).
    let s = 12345;
    const next = () => (s = (s * 1103515245 + 12345) & 0x7fffffff);
    for (let i = 0; i < 46; i++) {
      this.stars.push({ x: next() % WIDTH, y: next() % HEIGHT, speed: 1 + (next() % 3), tone: next() % STAR_TONES.length });
    }
  }

  /** Sets the on-screen size (CSS pixels). */
  resize(scale: number) {
    this.canvas.style.width = `${Math.round(CANVAS_WIDTH * scale)}px`;
    this.canvas.style.height = `${Math.round(CANVAS_HEIGHT * scale)}px`;
  }

  /** Turns game events into explosions and flashes. */
  addEvents(events: GameEvent[]) {
    for (const e of events) {
      if (e.type === "explode") this.burst(e.x, e.y, e.enemy ? ENEMY_COLORS[e.enemy] : MINE_COLOR, e.enemy ? 10 : 5, 1);
      else if (e.type === "hit") this.burst(e.x, e.y, "#ffffff", 3, 1);
      else if (e.type === "playerHit") {
        this.burst(e.x, e.y, PLAYER_COLOR, 18, 2);
        this.burst(e.x, e.y, "#ffffff", 8, 1);
        this.flash = 8;
      } else if (e.type === "levelClear" || e.type === "extraLife") this.flash = Math.max(this.flash, 3);
    }
  }

  clearEffects() {
    this.particles = [];
    this.flash = 0;
  }

  private burst(x: number, y: number, color: string, count: number, size: number) {
    const px = x / SUB;
    const py = y / SUB + HUD_HEIGHT;
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + Math.random() * 0.6;
      const v = 0.4 + Math.random() * 1.2;
      this.particles.push({
        x: px, y: py, vx: Math.cos(a) * v, vy: Math.sin(a) * v,
        life: 14 + Math.floor(Math.random() * 14), color, size: size + (Math.random() < 0.3 ? 1 : 0),
      });
    }
  }

  /** A sprite pre-drawn in one colour, cached. */
  private sprite(key: string, art: Sprite, color: string): HTMLCanvasElement {
    const k = `${key}|${color}`;
    let c = this.sprites.get(k);
    if (!c) {
      c = document.createElement("canvas");
      c.width = art[0].length;
      c.height = art.length;
      const g = c.getContext("2d")!;
      g.fillStyle = color;
      art.forEach((row, y) => {
        for (let x = 0; x < row.length; x++) if (row[x] === "#") g.fillRect(x, y, 1, 1);
      });
      this.sprites.set(k, c);
    }
    return c;
  }

  private blit(key: string, art: Sprite, color: string, cx: number, cy: number, alpha = 1) {
    const img = this.sprite(key, art, color);
    const x = Math.round(cx / SUB - img.width / 2);
    const y = Math.round(cy / SUB - img.height / 2) + HUD_HEIGHT;
    if (alpha !== 1) this.ctx.globalAlpha = alpha;
    this.ctx.drawImage(img, x, y);
    if (alpha !== 1) this.ctx.globalAlpha = 1;
  }

  private text(str: string, x: number, y: number, color: string) {
    const ctx = this.ctx;
    ctx.fillStyle = color;
    for (const ch of str) {
      const glyph = FONT[ch] ?? FONT[" "];
      glyph.forEach((row, gy) => {
        for (let gx = 0; gx < 3; gx++) if (row[gx] === "#") ctx.fillRect(x + gx, y + gy, 1, 1);
      });
      x += 4;
    }
  }

  /** Draws the game, or just the starfield when `game` is null. */
  draw(game: NovaRaiders | null, animate = true) {
    const ctx = this.ctx;
    if (animate) this.frame++;
    const f = this.frame;

    // Playfield and stars
    ctx.fillStyle = this.flash > 0 && this.flash % 2 === 1 ? "#2a0b2c" : BACKGROUND;
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    if (this.flash > 0 && animate) this.flash--;
    for (const st of this.stars) {
      const y = Math.floor(st.y + (f * st.speed) / 4) % HEIGHT;
      const twinkle = (f + st.x * 7) % 90 < 6;
      ctx.fillStyle = twinkle ? "#ffffff" : STAR_TONES[st.tone];
      ctx.fillRect(st.x, y + HUD_HEIGHT, 1, 1);
    }
    // Ground stripes, like the coloured bands of old console shooters
    const bands = ["#1c1040", "#2a1658", "#3a1e6e"];
    bands.forEach((c, i) => {
      ctx.fillStyle = c;
      ctx.fillRect(0, CANVAS_HEIGHT - 6 + i * 2, CANVAS_WIDTH, i === 2 ? 2 : 1);
    });

    if (game) this.drawGame(game, f);
    else this.drawAttract(f);

    // Explosion bits
    for (const p of this.particles) {
      ctx.fillStyle = p.color;
      ctx.fillRect(Math.round(p.x), Math.round(p.y), p.size, p.size);
      if (animate) {
        p.x += p.vx;
        p.y += p.vy;
        p.life--;
      }
    }
    if (animate) this.particles = this.particles.filter((p) => p.life > 0);

    // Score bar
    ctx.fillStyle = "#120f2e";
    ctx.fillRect(0, 0, CANVAS_WIDTH, HUD_HEIGHT);
    ctx.fillStyle = "#ff5fa2";
    ctx.fillRect(0, HUD_HEIGHT - 1, CANVAS_WIDTH, 1);
    const score = game ? game.score : 0;
    this.text(String(score).padStart(6, "0"), 3, 3, PLAYER_COLOR);
    if (game) {
      this.text(`L${game.level}-W${Math.max(1, game.wave)}`, 62, 3, "#ff8cc0");
      const lifeImg = this.sprite("life", LIFE, PLAYER_COLOR);
      const shown = Math.min(game.lives, 6);
      for (let i = 0; i < shown; i++) ctx.drawImage(lifeImg, CANVAS_WIDTH - 8 - i * 7, 4);
    }
  }

  /** The title screen: all ten raiders on parade above a resting ship. */
  private drawAttract(f: number) {
    const anim = Math.floor(f / 16) % 2;
    const bob = Math.round(Math.sin(f / 30) * 2);
    for (let t = 1; t <= 10; t++) {
      const col = (t - 1) % 5;
      const row = Math.floor((t - 1) / 5);
      const type = t as EnemyType;
      this.blit(`e${type}${anim}`, ENEMY_SPRITES[type][anim], ENEMY_COLORS[type], (24 + col * 28) * SUB, (22 + row * 16 + bob) * SUB);
    }
    this.blit("player", PLAYER, PLAYER_COLOR, (WIDTH / 2) * SUB, (HEIGHT - 18) * SUB);
  }

  private drawGame(g: NovaRaiders, f: number) {
    const ctx = this.ctx;
    const anim = Math.floor(f / 16) % 2;

    for (const e of g.enemies) {
      const art = ENEMY_SPRITES[e.type][anim];
      if (!e.visible) {
        // Phantoms shimmer faintly while invisible.
        if (f % 6 < 2) this.blit(`e${e.type}${anim}`, art, ENEMY_COLORS[e.type], e.x, e.y, 0.22);
        continue;
      }
      const color = e.flash > 0 ? "#ffffff" : e.type === 5 && e.hp < 3 ? (e.hp === 2 ? "#8fa6ff" : "#c3cfff") : ENEMY_COLORS[e.type];
      this.blit(`e${e.type}${anim}`, art, color, e.x, e.y);
    }

    for (const b of g.enemyShots) {
      if (b.mine) {
        this.blit(`m${anim}`, MINE[anim], f % 10 < 5 ? MINE_COLOR : "#ffb0b0", b.x, b.y);
      } else {
        ctx.fillStyle = b.vx !== 0 && Math.abs(b.vx) !== 6 ? AIMED_SHOT_COLOR : ENEMY_SHOT_COLOR;
        const x = Math.round(b.x / SUB);
        const y = Math.round(b.y / SUB) + HUD_HEIGHT;
        ctx.fillRect(x, y - 1, 1, 3);
      }
    }

    ctx.fillStyle = SHOT_COLOR;
    for (const s of g.shots) {
      ctx.fillRect(Math.round(s.x / SUB), Math.round(s.y / SUB) + HUD_HEIGHT - 2, 1, 4);
    }

    if (g.alive && !(g.invulnerable > 0 && Math.floor(g.invulnerable / 4) % 2 === 1)) {
      this.blit("player", PLAYER, PLAYER_COLOR, g.px, g.py);
      // Engine flicker
      if (f % 4 < 2) {
        ctx.fillStyle = "#ff5fa2";
        ctx.fillRect(Math.round(g.px / SUB), Math.round(g.py / SUB) + HUD_HEIGHT + 4, 1, 1);
      }
    }
  }
}
