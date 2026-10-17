/**
 * Starfall game engine. Pure TypeScript with no browser or server imports, so
 * the exact same code runs in the player's browser and on the server.
 *
 * Determinism is the whole point: the game advances in fixed ticks (60 per
 * second), uses only integer math and a seeded random generator, and changes
 * only through the input events it is given. Replaying the same seed and the
 * same input log always produces the same game, which is how the server
 * checks a score instead of trusting the number the browser reports.
 */

export const TICKS_PER_SECOND = 60;
export const COLS = 10;
/** Visible rows. Two hidden rows sit above them, where pieces spawn. */
export const ROWS = 20;
export const HIDDEN = 2;
export const TOTAL_ROWS = ROWS + HIDDEN;
export const PREVIEW = 3;
/** A run ends after one hour of play, which bounds the server's replay work. */
export const MAX_TICKS = 60 * 60 * TICKS_PER_SECOND;

const DAS = 10; // ticks before a held left/right starts repeating
const ARR = 2; // ticks between repeats
const SOFT_DROP_TICKS = 2; // ticks per row while soft drop is held
const LOCK_TICKS = 30; // time on the ground before a piece locks
const MAX_LOCK_RESETS = 15; // moves on the ground that restart the lock timer
const LINES_PER_LEVEL = 10;
/** Ticks per row by level (1-based). Faster than 1 row per tick isn't modelled. */
const GRAVITY = [60, 48, 37, 28, 21, 16, 11, 8, 6, 4, 3, 2, 1];
const CLEAR_POINTS = [0, 100, 300, 500, 800];

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

/** Piece kinds. 0 means an empty cell on the board. */
export type PieceKind = 1 | 2 | 3 | 4 | 5 | 6 | 7;
export const PIECE_NAMES = ["", "I", "O", "T", "S", "Z", "J", "L"] as const;

type Cell = readonly [x: number, y: number];

/** Spawn shape (rotation 0) inside its box, y pointing down. */
const SHAPES: Record<PieceKind, { size: number; cells: Cell[] }> = {
  1: { size: 4, cells: [[0, 1], [1, 1], [2, 1], [3, 1]] },
  2: { size: 2, cells: [[0, 0], [1, 0], [0, 1], [1, 1]] },
  3: { size: 3, cells: [[1, 0], [0, 1], [1, 1], [2, 1]] },
  4: { size: 3, cells: [[1, 0], [2, 0], [0, 1], [1, 1]] },
  5: { size: 3, cells: [[0, 0], [1, 0], [1, 1], [2, 1]] },
  6: { size: 3, cells: [[0, 0], [0, 1], [1, 1], [2, 1]] },
  7: { size: 3, cells: [[2, 0], [0, 1], [1, 1], [2, 1]] },
};

/** ROTATIONS[kind][rotation] = cells in the piece's box. Rotation 0..3 clockwise. */
const ROTATIONS: Record<PieceKind, Cell[][]> = (() => {
  const out = {} as Record<PieceKind, Cell[][]>;
  for (const k of [1, 2, 3, 4, 5, 6, 7] as PieceKind[]) {
    const { size, cells } = SHAPES[k];
    const states: Cell[][] = [cells];
    for (let r = 1; r < 4; r++) {
      states.push(states[r - 1].map(([x, y]) => [size - 1 - y, x] as const));
    }
    out[k] = states;
  }
  return out;
})();

export function pieceCells(kind: PieceKind, rotation: number): Cell[] {
  return ROTATIONS[kind][rotation & 3];
}

// Wall kicks: offsets tried in order when a rotation is blocked. Written with
// y pointing up (the usual notation) and flipped when used.
type Kick = readonly [number, number];
const KICKS_JLSTZ: Record<string, Kick[]> = {
  "0>1": [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
  "1>0": [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
  "1>2": [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
  "2>1": [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
  "2>3": [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
  "3>2": [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
  "3>0": [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
  "0>3": [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
};
const KICKS_I: Record<string, Kick[]> = {
  "0>1": [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]],
  "1>0": [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]],
  "1>2": [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]],
  "2>1": [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]],
  "2>3": [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]],
  "3>2": [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]],
  "3>0": [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]],
  "0>3": [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]],
};

// ---------------------------------------------------------------------------
// Seeded random numbers (mulberry32): small, fast, identical everywhere.
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

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

/** Every input the game understands. Left, right and soft drop are held keys. */
export type Input =
  | "leftDown" | "leftUp"
  | "rightDown" | "rightUp"
  | "softDown" | "softUp"
  | "hardDrop" | "rotateCw" | "rotateCcw" | "hold"
  | "end";

/** One letter per input in the recorded log. */
export const INPUT_CODES: Record<Input, string> = {
  leftDown: "A", leftUp: "B", rightDown: "C", rightUp: "D", softDown: "E", softUp: "F",
  hardDrop: "G", rotateCw: "H", rotateCcw: "I", hold: "J", end: "Z",
};
const CODE_INPUTS: Record<string, Input> = Object.fromEntries(
  Object.entries(INPUT_CODES).map(([k, v]) => [v, k as Input]),
);

/** Things that happened during the last step, for effects and sound. */
export type GameEvent =
  | { type: "lock" }
  | { type: "clear"; rows: number[]; count: number; points: number }
  | { type: "level"; level: number }
  | { type: "over"; reason: "topOut" | "time" | "ended" };

export type ActivePiece = { kind: PieceKind; rotation: number; x: number; y: number };

// ---------------------------------------------------------------------------
// The game
// ---------------------------------------------------------------------------

export class Starfall {
  /** Board cells, row by row from the top (hidden rows first). 0 = empty. */
  readonly board = new Uint8Array(COLS * TOTAL_ROWS);
  piece: ActivePiece | null = null;
  holdKind: PieceKind | null = null;
  holdUsed = false;
  score = 0;
  lines = 0;
  level = 1;
  /** Consecutive locks that cleared lines; -1 when the chain is broken. */
  combo = -1;
  /** Whether the last line clear was a four-line clear (back-to-back bonus). */
  backToBack = false;
  supernovas = 0;
  piecesPlaced = 0;
  tick = 0;
  over = false;
  overReason: "topOut" | "time" | "ended" | null = null;
  events: GameEvent[] = [];

  private readonly next: () => number;
  private queue: PieceKind[] = [];
  private leftHeld = false;
  private rightHeld = false;
  private lastDir: -1 | 0 | 1 = 0;
  private dasTicks = 0;
  private softHeld = false;
  private gravityTicks = 0;
  private lockTicks = 0;
  private lockResets = 0;
  private lowestY = 0;

  constructor(readonly seed: number) {
    this.next = rng(seed);
    this.fillQueue();
    this.spawn(this.queue.shift()!);
  }

  /** Upcoming pieces, nearest first. */
  get preview(): PieceKind[] {
    return this.queue.slice(0, PREVIEW);
  }

  /** Row the current piece would land on (for the ghost). */
  get ghostY(): number {
    const p = this.piece;
    if (!p) return 0;
    let y = p.y;
    while (this.fits(p.kind, p.rotation, p.x, y + 1)) y++;
    return y;
  }

  cell(x: number, y: number): number {
    return this.board[y * COLS + x];
  }

  /** Applies one input at the current tick. */
  input(input: Input) {
    if (this.over || !this.piece) return;
    switch (input) {
      case "leftDown":
        this.leftHeld = true; this.lastDir = -1; this.dasTicks = 0; this.shift(-1); break;
      case "rightDown":
        this.rightHeld = true; this.lastDir = 1; this.dasTicks = 0; this.shift(1); break;
      case "leftUp":
        this.leftHeld = false;
        if (this.lastDir === -1) { this.lastDir = this.rightHeld ? 1 : 0; this.dasTicks = 0; }
        break;
      case "rightUp":
        this.rightHeld = false;
        if (this.lastDir === 1) { this.lastDir = this.leftHeld ? -1 : 0; this.dasTicks = 0; }
        break;
      case "softDown": this.softHeld = true; break;
      case "softUp": this.softHeld = false; break;
      case "hardDrop": this.hardDrop(); break;
      case "rotateCw": this.rotate(1); break;
      case "rotateCcw": this.rotate(-1); break;
      case "hold": this.holdPiece(); break;
      case "end": this.finish("ended"); break;
    }
  }

  /** Advances the game by one tick (1/60 s). */
  step() {
    if (this.over) return;
    this.tick++;
    if (this.tick >= MAX_TICKS) { this.finish("time"); return; }
    const p = this.piece;
    if (!p) return;

    // Auto-repeat for a held left/right key
    if (this.lastDir !== 0) {
      this.dasTicks++;
      if (this.dasTicks >= DAS && (this.dasTicks - DAS) % ARR === 0) this.shift(this.lastDir);
    }

    // Gravity (faster while soft drop is held; each soft-dropped row scores 1)
    const g = GRAVITY[Math.min(this.level, GRAVITY.length) - 1];
    const interval = this.softHeld ? Math.min(g, SOFT_DROP_TICKS) : g;
    this.gravityTicks++;
    if (this.gravityTicks >= interval) {
      this.gravityTicks = 0;
      if (this.fits(p.kind, p.rotation, p.x, p.y + 1)) {
        p.y++;
        if (this.softHeld) this.score += 1;
        if (p.y > this.lowestY) { this.lowestY = p.y; this.lockResets = 0; }
      }
    }

    // Lock once the piece has rested on something long enough
    if (!this.fits(p.kind, p.rotation, p.x, p.y + 1)) {
      this.lockTicks++;
      if (this.lockTicks >= LOCK_TICKS) this.lock();
    } else {
      this.lockTicks = 0;
    }
  }

  // --- moves ---------------------------------------------------------------

  private fits(kind: PieceKind, rotation: number, x: number, y: number): boolean {
    for (const [cx, cy] of pieceCells(kind, rotation)) {
      const bx = x + cx;
      const by = y + cy;
      if (bx < 0 || bx >= COLS || by < 0 || by >= TOTAL_ROWS) return false;
      if (this.board[by * COLS + bx] !== 0) return false;
    }
    return true;
  }

  private grounded(): boolean {
    const p = this.piece!;
    return !this.fits(p.kind, p.rotation, p.x, p.y + 1);
  }

  /** A successful move on the ground restarts the lock timer, a limited number of times. */
  private moved() {
    if (this.grounded() && this.lockResets < MAX_LOCK_RESETS) {
      this.lockTicks = 0;
      this.lockResets++;
    }
  }

  private shift(dx: number) {
    const p = this.piece!;
    if (this.fits(p.kind, p.rotation, p.x + dx, p.y)) {
      p.x += dx;
      this.moved();
    }
  }

  private rotate(dir: 1 | -1) {
    const p = this.piece!;
    if (p.kind === 2) return; // the O piece looks the same in every rotation
    const from = p.rotation;
    const to = (from + dir + 4) & 3;
    const kicks = (p.kind === 1 ? KICKS_I : KICKS_JLSTZ)[`${from}>${to}`];
    for (const [kx, ky] of kicks) {
      if (this.fits(p.kind, to, p.x + kx, p.y - ky)) {
        p.x += kx;
        p.y -= ky;
        p.rotation = to;
        if (p.y > this.lowestY) { this.lowestY = p.y; this.lockResets = 0; }
        this.moved();
        return;
      }
    }
  }

  private hardDrop() {
    const p = this.piece!;
    const y = this.ghostY;
    this.score += 2 * (y - p.y);
    p.y = y;
    this.lock();
  }

  private holdPiece() {
    if (this.holdUsed) return;
    const current = this.piece!.kind;
    const swap = this.holdKind;
    this.holdKind = current;
    this.holdUsed = true;
    this.spawn(swap ?? this.queue.shift()!);
    this.fillQueue();
  }

  // --- locking, clearing, spawning -------------------------------------------

  private lock() {
    const p = this.piece!;
    let allHidden = true;
    for (const [cx, cy] of pieceCells(p.kind, p.rotation)) {
      const y = p.y + cy;
      this.board[y * COLS + p.x + cx] = p.kind;
      if (y >= HIDDEN) allHidden = false;
    }
    this.piece = null;
    this.piecesPlaced++;
    this.events.push({ type: "lock" });
    if (allHidden) { this.finish("topOut"); return; }

    // Clear full rows
    const full: number[] = [];
    for (let y = 0; y < TOTAL_ROWS; y++) {
      let complete = true;
      for (let x = 0; x < COLS; x++) if (this.board[y * COLS + x] === 0) { complete = false; break; }
      if (complete) full.push(y);
    }
    const n = full.length;
    if (n > 0) {
      for (const row of full) {
        this.board.copyWithin(COLS, 0, row * COLS);
        this.board.fill(0, 0, COLS);
      }
      let points = CLEAR_POINTS[n] * this.level;
      if (n === 4) {
        if (this.backToBack) points = (points * 3) / 2;
        this.backToBack = true;
        this.supernovas++;
      } else {
        this.backToBack = false;
      }
      this.combo++;
      points += 50 * this.combo * this.level;
      this.score += points;
      this.lines += n;
      this.events.push({ type: "clear", rows: full.map((r) => r - HIDDEN), count: n, points });
      const level = 1 + Math.floor(this.lines / LINES_PER_LEVEL);
      if (level !== this.level) {
        this.level = level;
        this.events.push({ type: "level", level });
      }
    } else {
      this.combo = -1;
    }

    this.holdUsed = false;
    this.spawn(this.queue.shift()!);
    this.fillQueue();
  }

  private spawn(kind: PieceKind) {
    const x = kind === 2 ? 4 : 3;
    if (!this.fits(kind, 0, x, 0)) {
      this.piece = null;
      this.finish("topOut");
      return;
    }
    this.piece = { kind, rotation: 0, x, y: 0 };
    // Drop straight into view, like the first gravity step.
    if (this.fits(kind, 0, x, 1)) this.piece.y = 1;
    this.gravityTicks = 0;
    this.lockTicks = 0;
    this.lockResets = 0;
    this.lowestY = this.piece.y;
  }

  /** Keeps at least one full bag of pieces queued ("7-bag": every piece once per 7). */
  private fillQueue() {
    while (this.queue.length < 7) {
      const bag: PieceKind[] = [1, 2, 3, 4, 5, 6, 7];
      for (let i = bag.length - 1; i > 0; i--) {
        const j = this.next() % (i + 1);
        [bag[i], bag[j]] = [bag[j], bag[i]];
      }
      this.queue.push(...bag);
    }
  }

  private finish(reason: "topOut" | "time" | "ended") {
    if (this.over) return;
    this.over = true;
    this.overReason = reason;
    this.events.push({ type: "over", reason });
  }
}

// ---------------------------------------------------------------------------
// Input log: what the browser records and the server replays.
//
// Format: one entry per input, "<letter><ticks since previous input, base 36>",
// e.g. "A0G1kH3" = left at tick 0, hard drop at tick 56, rotate at tick 59.
// About 3 characters per input keeps an hour of play well under the server's
// 100 KB request limit.
// ---------------------------------------------------------------------------

/** Longest log the server accepts (characters). */
export const MAX_LOG_LENGTH = 90_000;
const LOG_PATTERN = /^(?:[A-JZ][0-9a-z]{1,6})*$/;

export class InputRecorder {
  private parts: string[] = [];
  private lastTick = 0;
  length = 0;

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
  lines: number;
  level: number;
  ticks: number;
  supernovas: number;
  pieces: number;
  reason: "topOut" | "time" | "ended";
};

export class InvalidLogError extends Error {}

/**
 * Re-plays a recorded game from its seed and input log and returns the result
 * as the engine computes it. The log must end with exactly one "end" entry
 * ("Z") at the tick where the game ended: either the player quit there, or the
 * game was already over at that exact tick. Throws InvalidLogError otherwise.
 */
export function replay(seed: number, log: string): ReplayResult {
  if (log.length > MAX_LOG_LENGTH) throw new InvalidLogError("The input log is too long.");
  if (!LOG_PATTERN.test(log)) throw new InvalidLogError("The input log isn't in the expected format.");

  const game = new Starfall(seed);
  const entry = /([A-JZ])([0-9a-z]+)/g;
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
    lines: game.lines,
    level: game.level,
    ticks: game.tick,
    supernovas: game.supernovas,
    pieces: game.piecesPlaced,
    reason: game.overReason!,
  };
}
