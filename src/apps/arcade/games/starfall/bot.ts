// A simple Starfall bot, used to create the demo players' runs in the seed
// (and handy for tests). For each piece it tries every rotation and column,
// scores the resulting board, then sends the same inputs a player would.
// Its runs are real: they replay and verify exactly like a human's.
import { COLS, InputRecorder, Starfall, TOTAL_ROWS, pieceCells, type Input, type PieceKind } from "./engine";

function evaluate(board: Uint8Array, kind: PieceKind, rotation: number, x: number): number | null {
  const cells = pieceCells(kind, rotation);
  const fits = (y: number) =>
    cells.every(([cx, cy]) => {
      const bx = x + cx;
      const by = y + cy;
      return bx >= 0 && bx < COLS && by >= 0 && by < TOTAL_ROWS && board[by * COLS + bx] === 0;
    });
  if (!fits(0)) return null;
  let y = 0;
  while (fits(y + 1)) y++;
  const b = board.slice();
  for (const [cx, cy] of cells) b[(y + cy) * COLS + x + cx] = kind;

  let lines = 0;
  for (let r = 0; r < TOTAL_ROWS; r++) {
    let full = true;
    for (let c = 0; c < COLS; c++) if (!b[r * COLS + c]) full = false;
    if (full) lines++;
  }
  let holes = 0;
  let height = 0;
  let bumps = 0;
  let prev = -1;
  for (let c = 0; c < COLS; c++) {
    let top = TOTAL_ROWS;
    for (let r = 0; r < TOTAL_ROWS; r++) if (b[r * COLS + c]) { top = r; break; }
    const h = TOTAL_ROWS - top;
    height += h;
    if (prev >= 0) bumps += Math.abs(h - prev);
    prev = h;
    for (let r = top + 1; r < TOTAL_ROWS; r++) if (!b[r * COLS + c]) holes++;
  }
  return -0.51 * height + 0.76 * lines - 0.36 * holes - 0.18 * bumps;
}

export type BotOptions = {
  /** Stop (end the run) after this many pieces. */
  maxPieces?: number;
  /** Ticks the bot waits between inputs; higher is slower and more human. */
  pace?: number;
  /** Chance (0..1) of picking a random placement instead of the best one. */
  sloppiness?: number;
};

/** Plays one run and returns the recorded input log. */
export function playBot(seed: number, options: BotOptions = {}): string {
  const { maxPieces = Infinity, pace = 8, sloppiness = 0 } = options;
  let r = (seed ^ 0x9e3779b9) >>> 0;
  const random = () => (r = (Math.imul(r, 1664525) + 1013904223) >>> 0) / 2 ** 32;

  const game = new Starfall(seed);
  const recorder = new InputRecorder();
  const send = (input: Input) => { recorder.record(game.tick, input); game.input(input); };
  const wait = (ticks: number) => { for (let i = 0; i < ticks && !game.over; i++) game.step(); };

  while (!game.over && game.piecesPlaced < maxPieces) {
    const p = game.piece!;
    const options: { score: number; x: number; rotation: number }[] = [];
    for (let rotation = 0; rotation < 4; rotation++) {
      for (let x = -2; x < COLS; x++) {
        const score = evaluate(game.board, p.kind, rotation, x);
        if (score !== null) options.push({ score, x, rotation });
      }
    }
    options.sort((a, b) => b.score - a.score);
    const pick = random() < sloppiness ? options[Math.floor(random() * Math.min(6, options.length))] : options[0];

    for (let i = 0; i < pick.rotation && !game.over; i++) { send("rotateCw"); wait(pace); }
    for (let guard = 0; guard < 12 && !game.over && game.piece && game.piece.x !== pick.x; guard++) {
      const left = game.piece.x > pick.x;
      send(left ? "leftDown" : "rightDown");
      wait(1);
      send(left ? "leftUp" : "rightUp");
      wait(pace);
    }
    if (game.over) break;
    send("hardDrop");
    wait(pace);
  }
  if (!game.over) send("end");
  else if (game.overReason !== "ended") recorder.record(game.tick, "end");
  return recorder.toString();
}
