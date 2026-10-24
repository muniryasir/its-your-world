/**
 * Nova Raiders game engine. Pure TypeScript with no browser or server
 * imports, so the same code runs in the player's browser and on the server.
 *
 * Like Starfall, the game is deterministic: it advances in fixed ticks (60 per
 * second), uses only integer math (positions are in 1/16 pixel), takes its
 * randomness from a seeded generator and changes only through the inputs it
 * is given. The server replays the recorded inputs with the run's seed to get
 * the real score.
 *
 * The playfield is 160 × 192 "Atari pixels". Ten levels of three waves each;
 * level n introduces enemy type n and mixes in the earlier types. The chosen
 * difficulty scales swarm size, enemy speed and fire rate for the whole run.
 */

export const TICKS_PER_SECOND = 60;
/** Playfield size in pixels. */
export const WIDTH = 160;
export const HEIGHT = 192;
/** Sub-pixel units per pixel. */
export const SUB = 16;
export const LEVELS = 10;
export const WAVES_PER_LEVEL = 3;
export const START_LIVES = 3;
/** Extra life every 10,000 points on Normal (scaled with the difficulty's swarm size). */
export const EXTRA_LIFE_EVERY = 10_000;
export const MAX_LIVES = 6;
/** A run ends after one hour of play, which bounds the server's replay work. */
export const MAX_TICKS = 60 * 60 * TICKS_PER_SECOND;

const W = WIDTH * SUB;
const H = HEIGHT * SUB;

// Player
const PLAYER_SPEED = 20; // sub-pixels per tick (1.25 px)
const PLAYER_MIN_X = 6 * SUB;
const PLAYER_MAX_X = (WIDTH - 6) * SUB;
const PLAYER_MIN_Y = 116 * SUB;
const PLAYER_MAX_Y = (HEIGHT - 8) * SUB;
const PLAYER_HALF_W = 3 * SUB; // hit box 7 × 6 px, a little smaller than the sprite
const PLAYER_HALF_H = 3 * SUB;
const FIRE_COOLDOWN = 9;
const MAX_PLAYER_SHOTS = 3;
const SHOT_SPEED = 64; // 4 px per tick
const RESPAWN_TICKS = 100;
const INVULNERABLE_TICKS = 120;
const GAME_OVER_DELAY = 90;

// Flow
const INTRO_TICKS = 130;
const WAVE_BREAK_TICKS = 75;
const VICTORY_TICKS = 150;
const SPAWN_INTERVAL = 7;

// Formation: 8 columns × 4 rows of slots near the top.
const FORM_COLS = 8;
const FORM_ROWS = 4;
const FORM_LEFT = 24 * SUB;
const FORM_TOP = 22 * SUB;
const FORM_DX = 16 * SUB;
const FORM_DY = 14 * SUB;
const SWAY = 12 * SUB;
const ENTRY_SPEED = 24;

/** sin(2πi/64) × 256, written out so every JavaScript engine agrees. */
const SIN64 = [
  0, 25, 50, 74, 98, 121, 142, 162, 181, 198, 213, 226, 237, 245, 251, 255, 256, 255, 251, 245, 237, 226,
  213, 198, 181, 162, 142, 121, 98, 74, 50, 25, 0, -25, -50, -74, -98, -121, -142, -162, -181, -198, -213,
  -226, -237, -245, -251, -255, -256, -255, -251, -245, -237, -226, -213, -198, -181, -162, -142, -121, -98,
  -74, -50, -25,
];

// ---------------------------------------------------------------------------
// Difficulty and enemy types
// ---------------------------------------------------------------------------

export type Difficulty = "easy" | "normal" | "hard";
export const DIFFICULTIES: readonly Difficulty[] = ["easy", "normal", "hard"];
/** Global scale for swarm size, speed and fire rate, in percent. */
const DIFFICULTY_PCT: Record<Difficulty, number> = { easy: 70, normal: 100, hard: 130 };
export const DIFFICULTY_NAMES: Record<Difficulty, string> = { easy: "Easy", normal: "Normal", hard: "Hard" };

/** Enemy types 1..10 (one introduced per level), 11 = shard from a Splitter. */
export type EnemyType = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11;
export const SHARD: EnemyType = 11;

type TypeInfo = {
  name: string;
  points: number;
  hp: number;
  /** Shots per 10,000 ticks at 100% scale. */
  fire: number;
  /** Half size of the hit box in sub-pixels. */
  hw: number;
  hh: number;
  /** Lives in the formation (false: moves freely across the screen). */
  formation: boolean;
};

export const ENEMY_TYPES: Record<EnemyType, TypeInfo> = {
  1: { name: "Drone", points: 100, hp: 1, fire: 8, hw: 4 * SUB, hh: 3 * SUB, formation: true },
  2: { name: "Darter", points: 150, hp: 1, fire: 5, hw: 4 * SUB, hh: 3 * SUB, formation: true },
  3: { name: "Gunner", points: 200, hp: 1, fire: 24, hw: 4 * SUB, hh: 3 * SUB, formation: true },
  4: { name: "Weaver", points: 200, hp: 1, fire: 9, hw: 4 * SUB, hh: 3 * SUB, formation: false },
  5: { name: "Bulwark", points: 300, hp: 3, fire: 10, hw: 4 * SUB, hh: 3 * SUB, formation: true },
  6: { name: "Splitter", points: 250, hp: 1, fire: 8, hw: 4 * SUB, hh: 4 * SUB, formation: true },
  7: { name: "Miner", points: 250, hp: 1, fire: 0, hw: 4 * SUB, hh: 3 * SUB, formation: false },
  8: { name: "Seeker", points: 300, hp: 1, fire: 0, hw: 4 * SUB, hh: 3 * SUB, formation: true },
  9: { name: "Spreader", points: 350, hp: 1, fire: 13, hw: 4 * SUB, hh: 3 * SUB, formation: true },
  10: { name: "Phantom", points: 400, hp: 1, fire: 16, hw: 4 * SUB, hh: 3 * SUB, formation: true },
  11: { name: "Shard", points: 50, hp: 1, fire: 0, hw: 2 * SUB, hh: 2 * SUB, formation: false },
};

const MINE_POINTS = 25;
const LEVEL_BONUS = 1000;
const LIFE_BONUS = 5000;

// ---------------------------------------------------------------------------
// Seeded random numbers (mulberry32) and integer helpers
// ---------------------------------------------------------------------------

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  };
}

/** Integer square root (floor). */
function isqrt(n: number): number {
  if (n <= 0) return 0;
  let x = n;
  let y = Math.floor((x + 1) / 2);
  while (y < x) {
    x = y;
    y = Math.floor((x + Math.floor(n / x)) / 2);
  }
  return x;
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
/** Scales an integer by a percentage, rounding toward zero. */
const pct = (v: number, p: number) => Math.trunc((v * p) / 100);

/** A velocity of length `speed` pointing from (x, y) to (tx, ty). */
function aim(x: number, y: number, tx: number, ty: number, speed: number): [number, number] {
  const dx = tx - x;
  const dy = ty - y;
  const len = isqrt(dx * dx + dy * dy);
  if (len === 0) return [0, speed];
  return [Math.trunc((dx * speed) / len), Math.trunc((dy * speed) / len)];
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

/** Every input the game understands. All controls are held keys. */
export type Input =
  | "leftDown" | "leftUp"
  | "rightDown" | "rightUp"
  | "upDown" | "upUp"
  | "downDown" | "downUp"
  | "fireDown" | "fireUp"
  | "end";

/** One letter per input in the recorded log. */
export const INPUT_CODES: Record<Input, string> = {
  leftDown: "A", leftUp: "B", rightDown: "C", rightUp: "D", upDown: "E", upUp: "F",
  downDown: "G", downUp: "H", fireDown: "I", fireUp: "J", end: "Z",
};
const CODE_INPUTS: Record<string, Input> = Object.fromEntries(
  Object.entries(INPUT_CODES).map(([k, v]) => [v, k as Input]),
);
/** The log starts with one digit for the difficulty. */
const DIFFICULTY_CODES: Record<Difficulty, string> = { easy: "1", normal: "2", hard: "3" };
const CODE_DIFFICULTIES: Record<string, Difficulty> = { "1": "easy", "2": "normal", "3": "hard" };

export type OverReason = "won" | "lost" | "time" | "ended";

/** Things that happened during the last step, for effects and banners. */
export type GameEvent =
  | { type: "explode"; x: number; y: number; enemy: EnemyType | 0 }
  | { type: "hit"; x: number; y: number }
  | { type: "playerHit"; x: number; y: number }
  | { type: "level"; level: number }
  | { type: "wave"; wave: number }
  | { type: "levelClear"; level: number; bonus: number }
  | { type: "extraLife" }
  | { type: "victory"; bonus: number }
  | { type: "over"; reason: OverReason };

// ---------------------------------------------------------------------------
// Game state
// ---------------------------------------------------------------------------

export type EnemyState = "enter" | "formation" | "dive" | "free";

export type Enemy = {
  id: number;
  type: EnemyType;
  hp: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  state: EnemyState;
  /** Formation slot, or -1. */
  slot: number;
  /** Counts down to the next dive, teleport or mine. */
  timer: number;
  /** Free movers: sine phase (0..63 × 16) and base row. */
  phase: number;
  baseY: number;
  /** Phantom: false while it is invisible (can't be hit, doesn't shoot). */
  visible: boolean;
  /** Ticks left of the white "hit" flash. */
  flash: number;
};

export type Shot = { x: number; y: number };
export type EnemyShot = { x: number; y: number; vx: number; vy: number; mine: boolean };

export type Phase = "intro" | "play" | "break" | "victory";

export class NovaRaiders {
  readonly difficulty: Difficulty;
  private readonly rand: () => number;
  private readonly dpct: number;

  tick = 0;
  score = 0;
  lives = START_LIVES;
  level = 1;
  /** 1..3 within the level. */
  wave = 0;
  phase: Phase = "intro";
  phaseTimer = INTRO_TICKS;

  // Player
  px = (WIDTH / 2) * SUB;
  py = (HEIGHT - 16) * SUB;
  alive = true;
  invulnerable = INVULNERABLE_TICKS;
  respawnTimer = 0;
  fireCooldown = 0;

  shots: Shot[] = [];
  enemyShots: EnemyShot[] = [];
  enemies: Enemy[] = [];
  private queue: EnemyType[] = [];
  private spawnTimer = 0;
  private nextId = 1;
  private sway = 0;
  private swayDir = 1;
  private readonly lifeStep: number;
  private nextLifeAt: number;

  // Stats
  kills = 0;
  shotsFired = 0;
  shotsHit = 0;

  over = false;
  overReason: OverReason | null = null;
  private overTimer = 0;
  events: GameEvent[] = [];

  private held = { left: false, right: false, up: false, down: false, fire: false };

  constructor(seed: number, difficulty: Difficulty) {
    this.rand = rng(seed);
    this.difficulty = difficulty;
    this.dpct = DIFFICULTY_PCT[difficulty];
    this.lifeStep = pct(EXTRA_LIFE_EVERY, this.dpct);
    this.nextLifeAt = this.lifeStep;
    this.events.push({ type: "level", level: 1 });
  }

  // ---- inputs -------------------------------------------------------------

  input(input: Input) {
    if (this.over) return;
    switch (input) {
      case "leftDown": this.held.left = true; break;
      case "leftUp": this.held.left = false; break;
      case "rightDown": this.held.right = true; break;
      case "rightUp": this.held.right = false; break;
      case "upDown": this.held.up = true; break;
      case "upUp": this.held.up = false; break;
      case "downDown": this.held.down = true; break;
      case "downUp": this.held.down = false; break;
      case "fireDown": this.held.fire = true; break;
      case "fireUp": this.held.fire = false; break;
      case "end": this.finish("ended"); break;
    }
  }

  // ---- derived numbers ----------------------------------------------------

  /** Overall pace in percent: difficulty × level (70% on Easy level 1, 235% on Hard level 10). */
  get scale(): number {
    return pct(this.dpct, 100 + (this.level - 1) * 9);
  }

  /** Formation slot position (sub-pixels), including the sideways sway. */
  slotPos(slot: number): [number, number] {
    const col = slot % FORM_COLS;
    const row = Math.floor(slot / FORM_COLS);
    return [FORM_LEFT + col * FORM_DX + this.sway, FORM_TOP + row * FORM_DY];
  }

  private randInt(n: number): number {
    return this.rand() % n;
  }

  // ---- one tick -----------------------------------------------------------

  step() {
    if (this.over) return;
    this.tick++;

    if (this.overTimer > 0) {
      // The player's last ship is exploding; the world keeps moving.
      this.updateWorld();
      if (--this.overTimer === 0) this.finish("lost");
      return;
    }

    this.updatePlayer();
    this.updateFlow();
    this.updateWorld();

    if (this.tick >= MAX_TICKS && !this.over) this.finish("time");
  }

  private updatePlayer() {
    if (!this.alive) {
      if (--this.respawnTimer <= 0) {
        this.alive = true;
        this.px = (WIDTH / 2) * SUB;
        this.py = (HEIGHT - 16) * SUB;
        this.invulnerable = INVULNERABLE_TICKS;
        this.enemyShots = [];
      }
      return;
    }
    const h = this.held;
    const dx = (h.right ? 1 : 0) - (h.left ? 1 : 0);
    const dy = (h.down ? 1 : 0) - (h.up ? 1 : 0);
    this.px = clamp(this.px + dx * PLAYER_SPEED, PLAYER_MIN_X, PLAYER_MAX_X);
    this.py = clamp(this.py + dy * PLAYER_SPEED, PLAYER_MIN_Y, PLAYER_MAX_Y);
    if (this.invulnerable > 0) this.invulnerable--;
    if (this.fireCooldown > 0) this.fireCooldown--;
    if (h.fire && this.fireCooldown === 0 && this.shots.length < MAX_PLAYER_SHOTS && this.phase !== "victory") {
      this.shots.push({ x: this.px, y: this.py - 5 * SUB });
      this.fireCooldown = FIRE_COOLDOWN;
      this.shotsFired++;
    }
  }

  private updateFlow() {
    switch (this.phase) {
      case "intro":
      case "break":
        if (--this.phaseTimer <= 0) this.startWave(this.wave + 1);
        break;
      case "play":
        if (this.queue.length > 0) {
          if (--this.spawnTimer <= 0) {
            this.spawn(this.queue.shift()!);
            this.spawnTimer = SPAWN_INTERVAL;
          }
        } else if (this.enemies.length === 0) {
          this.waveCleared();
        }
        break;
      case "victory":
        if (--this.phaseTimer <= 0) this.finish("won");
        break;
    }
  }

  private startWave(wave: number) {
    this.wave = wave;
    this.phase = "play";
    this.queue = this.makeWave();
    this.spawnTimer = 0;
    this.events.push({ type: "wave", wave });
  }

  private waveCleared() {
    if (this.wave < WAVES_PER_LEVEL) {
      this.phase = "break";
      this.phaseTimer = WAVE_BREAK_TICKS;
      return;
    }
    const bonus = LEVEL_BONUS * this.level;
    this.addScore(bonus);
    this.events.push({ type: "levelClear", level: this.level, bonus });
    if (this.level >= LEVELS) {
      const lifeBonus = LIFE_BONUS * this.lives;
      this.addScore(lifeBonus);
      this.events.push({ type: "victory", bonus: lifeBonus });
      this.phase = "victory";
      this.phaseTimer = VICTORY_TICKS;
      return;
    }
    this.level++;
    this.wave = 0;
    this.phase = "intro";
    this.phaseTimer = INTRO_TICKS;
    this.events.push({ type: "level", level: this.level });
  }

  /** The enemy types of one wave: more of them, and more of the new type, as the level goes on. */
  private makeWave(): EnemyType[] {
    const L = this.level;
    const w = this.wave;
    const count = clamp(Math.round(((5 + L + w * 2) * this.dpct) / 100), 4, 26);
    // Share of the level's new type: 40% / 50% / 65% across the three waves.
    const newShare = [40, 50, 65][w - 1];
    const types: EnemyType[] = [];
    let formation = 0;
    let free = 0;
    for (let i = 0; i < count; i++) {
      let t: EnemyType;
      if (L === 1 || this.randInt(100) < newShare) t = L as EnemyType;
      else t = (1 + this.randInt(L - 1)) as EnemyType;
      // Keep free movers to a handful and the formation within its 32 slots.
      if (!ENEMY_TYPES[t].formation) {
        if (free >= 2 + Math.floor(L / 3)) t = (L === 4 || L === 7 ? 1 : 3) as EnemyType;
        else free++;
      }
      if (ENEMY_TYPES[t].formation) {
        if (formation >= FORM_COLS * FORM_ROWS) continue;
        formation++;
      }
      types.push(t);
    }
    // Tougher types fly in first and take the top rows.
    types.sort((a, b) => b - a);
    return types;
  }

  private freeSlot(): number {
    const used = new Set(this.enemies.map((e) => e.slot));
    const free: number[] = [];
    for (let s = 0; s < FORM_COLS * FORM_ROWS; s++) if (!used.has(s)) free.push(s);
    if (free.length === 0) return -1;
    return free[0];
  }

  private randomFreeSlot(): number {
    const used = new Set(this.enemies.map((e) => e.slot));
    const free: number[] = [];
    for (let s = 0; s < FORM_COLS * FORM_ROWS; s++) if (!used.has(s)) free.push(s);
    if (free.length === 0) return -1;
    return free[this.randInt(free.length)];
  }

  private spawn(type: EnemyType) {
    const info = ENEMY_TYPES[type];
    const e: Enemy = {
      id: this.nextId++, type, hp: info.hp, x: 0, y: 0, vx: 0, vy: 0, state: "enter", slot: -1,
      timer: this.diveDelay(), phase: 0, baseY: 0, visible: true, flash: 0,
    };
    if (info.formation) {
      e.slot = this.freeSlot();
      if (e.slot < 0) return;
      const col = e.slot % FORM_COLS;
      e.x = col < FORM_COLS / 2 ? -8 * SUB : W + 8 * SUB;
      e.y = (12 + this.randInt(30)) * SUB;
    } else if (type === 4) {
      // Weaver: sweeps sideways along a wave, one row lower each crossing.
      e.state = "free";
      const fromLeft = this.randInt(2) === 0;
      e.x = fromLeft ? -6 * SUB : W + 6 * SUB;
      e.vx = (fromLeft ? 1 : -1) * Math.max(6, pct(10, this.scale));
      e.baseY = (24 + this.randInt(50)) * SUB;
      e.phase = this.randInt(64) * 16;
      e.y = e.baseY;
    } else {
      // Miner: patrols near the top, laying mines.
      e.state = "free";
      const fromLeft = this.randInt(2) === 0;
      e.x = fromLeft ? -6 * SUB : W + 6 * SUB;
      e.vx = (fromLeft ? 1 : -1) * Math.max(5, pct(8, this.scale));
      e.baseY = (14 + this.randInt(24)) * SUB;
      e.y = e.baseY;
      e.timer = this.mineDelay();
    }
    this.enemies.push(e);
  }

  private diveDelay(): number {
    return Math.trunc(((90 + this.randInt(240)) * 100) / this.scale);
  }

  private mineDelay(): number {
    return Math.trunc(((80 + this.randInt(80)) * 100) / this.scale);
  }

  private get maxDivers(): number {
    return Math.max(1, Math.floor(((2 + this.level) * this.dpct) / 200));
  }

  private get maxEnemyShots(): number {
    return Math.max(2, Math.floor(((4 + this.level) * this.dpct) / 100));
  }

  // ---- world --------------------------------------------------------------

  private updateWorld() {
    const s = this.scale;

    // Formation sway (a slow triangle wave).
    const swaySpeed = Math.max(2, pct(4, s));
    this.sway += this.swayDir * swaySpeed;
    if (this.sway > SWAY) { this.sway = SWAY; this.swayDir = -1; }
    if (this.sway < -SWAY) { this.sway = -SWAY; this.swayDir = 1; }

    // Player shots
    for (const shot of this.shots) shot.y -= SHOT_SPEED;
    this.shots = this.shots.filter((shot) => shot.y > -4 * SUB);

    let divers = 0;
    for (const e of this.enemies) if (e.state === "dive" && e.type !== SHARD) divers++;

    for (const e of this.enemies) {
      if (e.flash > 0) e.flash--;
      this.moveEnemy(e, s, divers);
      if (e.state === "dive" && e.type !== SHARD && e.timer === -1) {
        divers++;
        e.timer = 0;
      }
      this.maybeFire(e, s);
    }
    this.enemies = this.enemies.filter((e) => e.hp > 0);

    // Enemy shots and mines
    for (const b of this.enemyShots) {
      b.x += b.vx;
      b.y += b.vy;
    }
    this.enemyShots = this.enemyShots.filter((b) => b.y < H + 4 * SUB && b.y > -8 * SUB && b.x > -4 * SUB && b.x < W + 4 * SUB);

    this.collide();
  }

  private moveEnemy(e: Enemy, s: number, divers: number) {
    switch (e.state) {
      case "enter": {
        const [tx, ty] = this.slotPos(e.slot);
        const dx = tx - e.x;
        const dy = ty - e.y;
        if (dx * dx + dy * dy <= ENTRY_SPEED * ENTRY_SPEED) {
          e.x = tx;
          e.y = ty;
          e.state = "formation";
        } else {
          const [vx, vy] = aim(e.x, e.y, tx, ty, ENTRY_SPEED);
          e.x += vx;
          e.y += vy;
        }
        break;
      }
      case "formation": {
        [e.x, e.y] = this.slotPos(e.slot);
        if (e.type === 2 || e.type === 8) {
          // Darters and Seekers take turns diving at the player.
          if (--e.timer <= 0) {
            if (this.alive && divers < this.maxDivers && this.phase === "play") {
              e.state = "dive";
              e.vx = 0;
              e.vy = Math.max(10, pct(e.type === 2 ? 20 : 12, s));
              e.timer = -1; // counted as a diver this tick
            } else {
              e.timer = 30;
            }
          }
        } else if (e.type === 10) {
          // Phantoms fade out, then reappear in another slot.
          if (--e.timer <= 0) {
            if (e.visible) {
              e.visible = false;
              e.timer = 50;
            } else {
              const slot = this.randomFreeSlot();
              if (slot >= 0) e.slot = slot;
              [e.x, e.y] = this.slotPos(e.slot);
              e.visible = true;
              e.timer = 150 + this.randInt(90);
            }
          }
        }
        break;
      }
      case "dive": {
        if (e.type === 2) {
          // Darter: falls fast, sliding toward the player's column.
          const maxVx = Math.max(6, pct(10, s));
          if (this.alive) e.vx = clamp(Math.trunc((this.px - e.x) / 12), -maxVx, maxVx);
        } else if (e.type === 8) {
          // Seeker: steers toward the player, picking up speed.
          const top = Math.max(14, pct(22, s));
          if (this.alive && e.y < this.py) {
            const [ax, ay] = aim(e.x, e.y, this.px, this.py, 2);
            e.vx = clamp(e.vx + ax, -top, top);
            e.vy = clamp(e.vy + ay, 6, top);
          } else {
            e.vy = clamp(e.vy + 1, 6, top);
          }
        }
        e.x += e.vx;
        e.y += e.vy;
        if (e.y > H + 8 * SUB || e.x < -12 * SUB || e.x > W + 12 * SUB) {
          if (e.type === SHARD) {
            e.hp = 0; // gone off screen (no points)
          } else {
            // Loop back in from the top and return to the formation.
            e.x = clamp(e.x, 8 * SUB, W - 8 * SUB);
            e.y = -8 * SUB;
            e.vx = 0;
            e.vy = 0;
            e.state = "enter";
            e.timer = this.diveDelay();
          }
        }
        break;
      }
      case "free": {
        e.x += e.vx;
        if (e.type === 4) {
          e.phase = (e.phase + Math.max(8, pct(12, s))) & 1023;
          e.y = e.baseY + Math.trunc((SIN64[e.phase >> 4] * 12 * SUB) / 256);
        } else {
          e.y = e.baseY;
          if (--e.timer <= 0) {
            e.timer = this.mineDelay();
            if (e.x > 4 * SUB && e.x < W - 4 * SUB && this.enemyShots.length < this.maxEnemyShots + 4) {
              this.enemyShots.push({ x: e.x, y: e.y + 4 * SUB, vx: 0, vy: Math.max(4, pct(6, Math.min(s, 160))), mine: true });
            }
          }
        }
        if ((e.vx > 0 && e.x > W + 8 * SUB) || (e.vx < 0 && e.x < -8 * SUB)) {
          // Wrap to the other side.
          e.x = e.vx > 0 ? -8 * SUB : W + 8 * SUB;
          if (e.type === 4) {
            e.baseY += 10 * SUB;
            if (e.baseY > 100 * SUB) e.baseY = 24 * SUB;
          }
        }
        break;
      }
    }
  }

  private maybeFire(e: Enemy, s: number) {
    const info = ENEMY_TYPES[e.type];
    if (info.fire === 0 || !this.alive || !e.visible || this.phase !== "play") return;
    if (e.state === "enter" || e.y < 0 || e.y > this.py - 20 * SUB || e.x < 0 || e.x > W) return;
    if (this.enemyShots.length >= this.maxEnemyShots) return;
    if (this.randInt(10_000) >= pct(info.fire, s)) return;
    const speed = Math.max(14, pct(20, Math.min(s, 170)));
    const y = e.y + 4 * SUB;
    if (e.type === 3 || e.type === 10) {
      const [vx, vy] = aim(e.x, y, this.px, this.py, speed);
      this.enemyShots.push({ x: e.x, y, vx, vy: Math.max(vy, 4), mine: false });
    } else if (e.type === 9) {
      for (const vx of [-6, 0, 6]) this.enemyShots.push({ x: e.x, y, vx, vy: speed, mine: false });
    } else {
      this.enemyShots.push({ x: e.x, y, vx: 0, vy: speed, mine: false });
    }
  }

  private collide() {
    // Player shots against enemies and mines.
    for (const shot of this.shots) {
      let used = false;
      for (const e of this.enemies) {
        if (e.hp <= 0 || !e.visible) continue;
        const info = ENEMY_TYPES[e.type];
        if (Math.abs(shot.x - e.x) <= info.hw && shot.y - 2 * SUB <= e.y + info.hh && shot.y + 2 * SUB >= e.y - info.hh) {
          used = true;
          this.shotsHit++;
          this.damage(e);
          break;
        }
      }
      if (!used) {
        for (const b of this.enemyShots) {
          if (b.mine && Math.abs(shot.x - b.x) <= 2 * SUB && Math.abs(shot.y - b.y) <= 3 * SUB) {
            used = true;
            this.shotsHit++;
            this.addScore(MINE_POINTS);
            this.events.push({ type: "explode", x: b.x, y: b.y, enemy: 0 });
            b.y = H * 2; // removed below
            break;
          }
        }
      }
      if (used) shot.y = -100 * SUB;
    }
    this.shots = this.shots.filter((shot) => shot.y > -4 * SUB);
    this.enemyShots = this.enemyShots.filter((b) => b.y < H * 2);
    this.enemies = this.enemies.filter((e) => e.hp > 0);

    // Enemy shots and bodies against the player.
    if (!this.alive || this.invulnerable > 0) return;
    for (const b of this.enemyShots) {
      const r = b.mine ? 2 * SUB : SUB;
      if (Math.abs(b.x - this.px) <= PLAYER_HALF_W + r && Math.abs(b.y - this.py) <= PLAYER_HALF_H + r) {
        b.y = H * 2;
        this.playerHit();
        return;
      }
    }
    for (const e of this.enemies) {
      const info = ENEMY_TYPES[e.type];
      if (!e.visible) continue;
      if (Math.abs(e.x - this.px) <= PLAYER_HALF_W + info.hw - SUB && Math.abs(e.y - this.py) <= PLAYER_HALF_H + info.hh - SUB) {
        e.hp = 0;
        this.kill(e);
        this.enemies = this.enemies.filter((x) => x.hp > 0);
        this.playerHit();
        return;
      }
    }
  }

  private damage(e: Enemy) {
    e.hp--;
    if (e.hp > 0) {
      e.flash = 8;
      this.events.push({ type: "hit", x: e.x, y: e.y });
      return;
    }
    this.kill(e);
  }

  private kill(e: Enemy) {
    this.kills++;
    this.addScore(ENEMY_TYPES[e.type].points);
    this.events.push({ type: "explode", x: e.x, y: e.y, enemy: e.type });
    if (e.type === 6) {
      // A Splitter breaks into two shards that dive away diagonally.
      const vy = Math.max(12, pct(16, this.scale));
      for (const vx of [-10, 10]) {
        this.enemies.push({
          id: this.nextId++, type: SHARD, hp: 1, x: e.x, y: e.y, vx, vy, state: "dive", slot: -1,
          timer: 0, phase: 0, baseY: 0, visible: true, flash: 0,
        });
      }
    }
  }

  private playerHit() {
    this.events.push({ type: "playerHit", x: this.px, y: this.py });
    this.alive = false;
    this.lives--;
    if (this.lives <= 0) {
      this.lives = 0;
      this.overTimer = GAME_OVER_DELAY;
    } else {
      this.respawnTimer = RESPAWN_TICKS;
    }
  }

  private addScore(points: number) {
    this.score += points;
    while (this.score >= this.nextLifeAt) {
      this.nextLifeAt += this.lifeStep;
      if (this.overTimer === 0 && this.lives > 0 && this.lives < MAX_LIVES) {
        this.lives++;
        this.events.push({ type: "extraLife" });
      }
    }
  }

  private finish(reason: OverReason) {
    if (this.over) return;
    this.over = true;
    this.overReason = reason;
    this.events.push({ type: "over", reason });
  }

  /** A short fingerprint of the whole state, for determinism tests. */
  fingerprint(): string {
    const parts = [
      this.tick, this.score, this.lives, this.level, this.wave, this.phase, this.px, this.py, this.kills,
      this.enemies.map((e) => `${e.type}:${e.x},${e.y},${e.hp}`).join(";"),
      this.enemyShots.map((b) => `${b.x},${b.y}`).join(";"),
    ];
    return parts.join("|");
  }
}

// ---------------------------------------------------------------------------
// Input log
//
// Format: one digit for the difficulty (1 easy, 2 normal, 3 hard), then one
// entry per input, "<letter><ticks since previous input, base 36>", e.g.
// "2I0A5B1k" = Normal; fire at tick 0, left at tick 5, left released at 61.
// ---------------------------------------------------------------------------

/** Longest log the server accepts (characters). */
export const MAX_LOG_LENGTH = 90_000;
const LOG_PATTERN = /^[123](?:[A-JZ][0-9a-z]{1,6})*$/;

export class InputRecorder {
  private parts: string[];
  private lastTick = 0;
  length = 1;

  constructor(difficulty: Difficulty) {
    this.parts = [DIFFICULTY_CODES[difficulty]];
  }

  record(tick: number, input: Input) {
    const part = INPUT_CODES[input] + (tick - this.lastTick).toString(36);
    this.lastTick = tick;
    this.parts.push(part);
    this.length += part.length;
  }

  /** True when the log is close to the limit and the run should end. */
  get nearlyFull(): boolean {
    return this.length > MAX_LOG_LENGTH - 64;
  }

  toString(): string {
    return this.parts.join("");
  }
}

export type ReplayResult = {
  score: number;
  level: number;
  wave: number;
  ticks: number;
  kills: number;
  lives: number;
  shotsFired: number;
  shotsHit: number;
  difficulty: Difficulty;
  reason: OverReason;
};

export class InvalidLogError extends Error {}

/**
 * Re-plays a recorded game from its seed and input log. The log must end with
 * exactly one "end" entry ("Z") at the tick where the game ended: either the
 * player quit there, or the game was already over at that exact tick. Throws
 * InvalidLogError otherwise.
 */
export function replay(seed: number, log: string): ReplayResult {
  if (log.length > MAX_LOG_LENGTH) throw new InvalidLogError("The input log is too long.");
  if (!LOG_PATTERN.test(log)) throw new InvalidLogError("The input log isn't in the expected format.");

  const difficulty = CODE_DIFFICULTIES[log[0]];
  const game = new NovaRaiders(seed, difficulty);
  const entry = /([A-JZ])([0-9a-z]+)/g;
  entry.lastIndex = 1;
  let tick = 0;
  let ended = false;
  let m: RegExpExecArray | null;
  while ((m = entry.exec(log)) !== null) {
    if (ended) throw new InvalidLogError("The input log continues after the end of the run.");
    tick += parseInt(m[2], 36);
    if (tick > MAX_TICKS) throw new InvalidLogError("The input log is longer than a run can last.");
    while (game.tick < tick && !game.over) game.step();

    if (m[1] === INPUT_CODES.end) {
      if (!game.over) game.input("end");
      if (game.tick !== tick) throw new InvalidLogError("The run's end doesn't match the game.");
      ended = true;
    } else {
      if (game.over) throw new InvalidLogError("The input log continues after the game ended.");
      game.input(CODE_INPUTS[m[1]]);
    }
  }
  if (!ended) throw new InvalidLogError("The input log has no end.");

  return {
    score: game.score,
    level: game.level,
    wave: game.wave,
    ticks: game.tick,
    kills: game.kills,
    lives: game.lives,
    shotsFired: game.shotsFired,
    shotsHit: game.shotsHit,
    difficulty,
    reason: game.overReason!,
  };
}
