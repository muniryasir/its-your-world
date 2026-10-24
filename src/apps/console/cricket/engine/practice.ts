// Batting practice against a bowling machine: the game layer on top of the engine.
// The machine is the original game's computer bowler (its aim, meters, run-up and release), set to a
// bowler type, arm and accuracy. Everything up to the end of the delivery is the original's logic.
// What happens after the ball leaves the batting view (fielding, running between the wickets) comes
// in phase 3; until then runs use the simple rule in `runsFor` below.

import { Ram, ROM } from "./mem";
import { Engine, Input, EndReason } from "./engine";
import { Context } from "./context";
import { BASE_RAM_LEFT, BASE_RAM_RIGHT, BASE_CONTEXT_LEFT, BASE_CONTEXT_RIGHT } from "./baseState";
import { ballStep } from "./ball";
import { projectCam } from "./project";
import { rngNext } from "./rng";
import { bodyScreen } from "./batsman";
import { fielderPtrs, fielderSprite } from "./fielders";
import { MASKS } from "./maskData";
import { w } from "./m68k";

export type BowlerKind = "fast" | "swing" | "spin";
export interface Settings {
  bowler: BowlerKind;
  leftArm: boolean;
  /** 0 (wayward) .. 99 (metronome): the original's bowler rating */
  accuracy: number;
  batsman: "left" | "right";
  /** the original's three skill levels ($8604); 1 = the level of the recorded match */
  difficulty: 0 | 1 | 2;
}
export const DEFAULT_SETTINGS: Settings = { bowler: "fast", leftArm: false, accuracy: 70, batsman: "left", difficulty: 1 };

export type Outcome = "dot" | "runs" | "four" | "six" | "wide" | "bowled" | "lbw" | "caught";
export interface BallResult { outcome: Outcome; runs: number; text: string; reason: EndReason | "flight" }
export interface Score { runs: number; balls: number; wickets: number; fours: number; sixes: number; dots: number; extras: number }

/** pad bits as the original reads them (S A C B R L D U). A = shot along the ground, B = lofted shot */
export const PAD = { U: 1, D: 2, L: 4, R: 8, B: 0x10, C: 0x20, A: 0x40, S: 0x80 } as const;

/** bowler record +$14 magnitude per type (the sign is the bowling arm) */
const BOWLER_TYPE: Record<BowlerKind, number> = { fast: 1, spin: 2, swing: 4 };

/** distance of the rope from the middle of the pitch (placeholder until the fielding phase) */
export const BOUNDARY = 6400;
/** where the striker's popping crease is (world y) */
export const STRIKER_CREASE = 0x370;

export function oversText(balls: number): string {
  return `${Math.floor(balls / 6)}.${balls % 6}`;
}

export class Practice {
  engine: Engine;
  m: Ram;
  settings: Settings;
  score: Score = { runs: 0, balls: 0, wickets: 0, fours: 0, sixes: 0, dots: 0, extras: 0 };
  ballInOver = 0;
  result: BallResult | null = null;
  /** the ball's path over the ground after it was hit (world x, y), for the field map */
  path: [number, number][] = [];
  private flight: { ticks: number } | null = null;
  /** the hit ball touched the ground (decides four or six) */
  private bounced = false;

  constructor(seed: number, settings: Settings = DEFAULT_SETTINGS) {
    this.settings = { ...settings };
    this.m = startRam(this.settings.batsman);
    // seed the original's random generator
    let s = (seed & 0xffff) || 0x5eed;
    for (let i = 0; i < 4; i++) s = rngNext(s) & 0xffff;
    this.m.ww(0xe8e8, s || 0x5eed);
    this.engine = new Engine(this.m, this.context(), { kind: "done", reason: "dead" });
  }

  private context(): Context {
    const st = this.settings;
    const base = st.batsman === "left" ? BASE_CONTEXT_LEFT : BASE_CONTEXT_RIGHT;
    return {
      bowler: { a12: Math.max(0, Math.min(99, Math.round(st.accuracy))), a14: BOWLER_TYPE[st.bowler] * (st.leftArm ? -1 : 1) },
      // the recorded batsmen's ratings; balls faced feeds the original's misjudge rolls
      batsman: { ...base.batsman, s1c: Math.min(this.score.balls, 0x7f) },
      dfda12: base.dfda12,
      dfda18: base.dfda18,
    };
  }

  /** what the player is looking at */
  get phase(): "bowling" | "live" | "flight" | "result" {
    if (this.result) return "result";
    if (this.flight) return "flight";
    const k = this.engine.phase.kind;
    return k === "live" ? "live" : k === "done" ? "result" : "bowling";
  }

  /** set up the next ball (optionally with new settings) */
  nextBall(settings?: Settings): void {
    if (settings) {
      if (settings.batsman !== this.settings.batsman) {
        // the other batsman comes in: his start state (field mirrored), keeping the random sequence
        const rng = this.m.rw(0xe8e8);
        this.m = startRam(settings.batsman);
        this.m.ww(0xe8e8, rng);
        this.engine = new Engine(this.m, this.context(), { kind: "done", reason: "dead" });
      }
      this.settings = { ...settings };
    }
    const m = this.m;
    this.result = null;
    this.flight = null;
    this.bounced = false;
    this.path = [];
    m.ww(0x8604, this.settings.difficulty);
    if (this.ballInOver === 0) { m.ww(0xd1fe, 0); m.ww(0xd200, 0); } // a new over: bouncer and yorker counts
    m.ww(0xbe98, this.ballInOver); // balls bowled in the over (the computer bowler's plan reads it)
    m.ww(0xbed8, 0);
    this.engine.ctx = this.context();
    this.engine.newDelivery();
  }

  /** one game tick (the original runs about 42 a second here) */
  tick(input: Input): void {
    if (this.result) return;
    if (this.flight) return this.flightTick();
    this.engine.step(input);
    const m = this.m;
    if (m.rw(0x8606) !== 0 && m.rw(0xe5a2) !== 0 && m.rl(0xe5b8) === 0) this.bounced = true;
    const ph = this.engine.phase;
    if (ph.kind === "done") this.endOfDelivery(ph.reason);
  }

  private endOfDelivery(reason: EndReason): void {
    const m = this.m;
    const how = m.rw(0xbee2);
    if (how !== 0) {
      const outcome: Outcome = how === 3 ? "bowled" : how === 4 ? "caught" : "lbw";
      const text = outcome === "bowled" ? "Bowled!" : outcome === "lbw" ? "LBW!" : "Caught!";
      return this.finish({ outcome, runs: 0, text, reason });
    }
    if (m.rw(0xbeda) !== 0 && m.rw(0xbed8) > 0) return this.finish({ outcome: "wide", runs: 1, text: "Wide", reason });
    const hit = m.rw(0x8606) !== 0;
    if (!hit || reason === "fielder" || reason === "dead") {
      const text = reason === "fielder" ? (hit ? "Stopped by the keeper" : "Taken by the keeper") : hit ? "Blocked" : "No run";
      return this.finish({ outcome: "dot", runs: 0, text, reason });
    }
    // hit and still moving when the batting view hands over (the original cuts to the fielding view here):
    // follow it until it stops or reaches the rope
    this.flight = { ticks: 0 };
    this.path = [[m.rw(0xe5b4), m.rw(0xe5bc)]];
  }

  private flightTick(): void {
    const m = this.m;
    const f = this.flight!;
    // a few steps per tick: the field map plays the rest of the ball's journey quickly
    for (let i = 0; i < 3; i++) {
      if (m.rw(0xe58c) !== 0) m.ww(0xe58c, 0);
      m.ww(0xe936, m.rw(0xe5a2));
      ballStep(m, () => {});
      if (m.rl(0xe5b8) === 0) this.bounced = true;
      f.ticks++;
      const x = m.rw(0xe5b4), y = m.rw(0xe5bc);
      if (f.ticks % 3 === 0) this.path.push([x, y]);
      if (Math.hypot(x, y) >= BOUNDARY) {
        this.path.push([x, y]);
        const six = !this.bounced;
        return this.finish({ outcome: six ? "six" : "four", runs: six ? 6 : 4, text: six ? "Six!" : "Four!", reason: "flight" });
      }
      const still = m.rl(0xe5a8) === 0 && m.rl(0xe5b0) === 0 && m.rw(0xe5a2) >= 3;
      if (still || f.ticks > 2000) {
        this.path.push([x, y]);
        const runs = runsFor(x, y);
        const text = runs ? `${runs} run${runs > 1 ? "s" : ""}` : "No run";
        return this.finish({ outcome: runs ? "runs" : "dot", runs, text, reason: "flight" });
      }
    }
  }

  private finish(r: BallResult): void {
    this.flight = null;
    this.result = r;
    const s = this.score;
    if (r.outcome === "wide") { s.extras += 1; s.runs += 1; return; }
    s.balls++;
    this.ballInOver = (this.ballInOver + 1) % 6;
    s.runs += r.runs;
    if (r.outcome === "four") s.fours++;
    if (r.outcome === "six") s.sixes++;
    if (r.runs === 0) s.dots++;
    if (r.outcome === "bowled" || r.outcome === "lbw" || r.outcome === "caught") s.wickets++;
  }

  // ---------------------------------------------------------------- what to draw

  view(): View {
    const ball = !this.flight && !this.result;
    return { phase: this.phase, ...scene(this.m, this.engine.phase.kind, ball) };
  }

  /** world point (x, height, y) to screen, through the original's camera */
  project(x: number, height: number, y: number): [number, number] {
    return projectCam(this.m, x, w(-height), y);
  }
}

export interface Sprite { kind: "bowler" | "batsman" | "stumps" | "fielder"; x: number; y: number; frame: number; depth: number }
export interface View {
  phase: "bowling" | "live" | "flight" | "result";
  enginePhase: string;
  /** far to near */
  sprites: Sprite[];
  ball?: { sx: number; sy: number; hx: number; hy: number; r: number; depth: number };
  marker?: [number, number][];
  meters?: { pace: number; line: number; swing: number };
}

/** the batting view for the current RAM: sprites as the original places them, ball, aim marker, meters */
export function scene(m: Ram, ph: string, showBall = true): Omit<View, "phase"> {
  const sprites: Sprite[] = [];
  // the bowler: sub_044530
  {
    const [sx, sy] = projectCam(m, m.rw(0xd26c), -0xc8, m.rw(0xd270));
    const f = m.rw(0xd278);
    const frame = f + 0xdc;
    if (MASKS[frame]) {
      let dx = ROM.rw(0x546e8 + 4 * f);
      const dy = ROM.rw(0x546ea + 4 * f);
      const flip = m.rw(0xd274) < 0;
      if (flip) dx = -dx + MASKS[frame][0];
      sprites.push({ kind: "bowler", x: sx - dx, y: sy + dy, frame: flip ? -frame : frame, depth: m.rw(0xd270) });
    }
  }
  // the batsman: sub_044E3E
  {
    const f = m.rw(0x8610 + 0xe);
    const [x, y] = bodyScreen(m, m.rw(0x8610), m.rw(0x8614), f);
    const frame = f + 0x8d;
    sprites.push({ kind: "batsman", x, y, frame: (m.rb(0xd2c6) & 0xff) !== 0 ? -frame : frame, depth: m.rw(0x8614) });
  }
  // the stumps (part of sub_00EED6)
  {
    const [x, y] = projectCam(m, 0, 0, 0x400);
    const st = m.rw(0xbf24);
    sprites.push({ kind: "stumps", x: x - ROM.rw(0x537d4 + 4 * st), y: y - ROM.rw(0x537d6 + 4 * st), frame: st + 0x1a5, depth: 0x400 });
  }
  // the keeper and slips, where sub_0471D8 last placed them
  for (const f of fielderPtrs(m)) {
    if (f === 0) continue;
    const s = fielderSprite(m, f);
    if (MASKS[Math.abs(s.frame)]) sprites.push({ kind: "fielder", ...s, depth: m.rw(f + 0x104) });
  }
  let ball: View["ball"];
  if (m.rw(0xe5a2) !== 0 && showBall) {
    const x = m.rw(0xe5b4), z = m.rw(0xe5b8), y = m.rw(0xe5bc);
    const [sx, sy] = projectCam(m, x, w(-z), y);
    const [hx, hy] = projectCam(m, x, 0, y);
    const size = projectCam(m, 8, 0, w(y - 0x900))[0] - projectCam(m, 0, 0, w(y - 0x900))[0];
    ball = { sx, sy, hx, hy, r: Math.max(1, Math.min(8, size / 2)), depth: y };
  }
  sprites.sort((a, b) => a.depth - b.depth);
  const v: Omit<View, "phase"> = { enginePhase: ph, sprites, ball };
  if (ph === "aim" || ph === "settle") v.marker = markerQuad(m);
  if (ph.startsWith("meter") || ph === "swing" || ph === "paceWait" || ph === "runup")
    v.meters = { pace: Math.min(1, m.rw(0xe95a) / 0x7f), line: (m.rw(0xe956) & 0x7ff) / 0x800, swing: m.rw(0xd28e) === 0 ? 0 : m.rw(0xe954) < 0 ? -1 : 1 };
  return v;
}

/** runs for a hit ball that stopped inside the rope (phase 2 placeholder for fielding and running) */
export function runsFor(x: number, y: number): number {
  const d = Math.hypot(x, y - STRIKER_CREASE);
  if (d < 1600) return 0;
  if (d < 3200) return 1;
  if (d < 4800) return 2;
  return 3;
}

/** sub_0438F8: the aim marker's corners on the pitch (x ± size, y ± 3 size) */
function markerQuad(m: Ram): [number, number][] {
  const x = m.rw(0xd1d6), y = m.rw(0xd1da), s = m.rw(0xd1bc), t = 3 * s;
  return ([[x - s, y - t], [x + s, y - t], [x + s, y + t], [x - s, y + t]] as [number, number][]).map(([a, b]) => projectCam(m, a, 0, b));
}

function startRam(batsman: Settings["batsman"]): Ram {
  const buf = new Uint8Array(0x10000);
  for (const [a, b64] of batsman === "left" ? BASE_RAM_LEFT : BASE_RAM_RIGHT) buf.set(decode(b64), a);
  return new Ram(buf);
}

function decode(b64: string): Uint8Array {
  if (typeof atob === "function") return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new Uint8Array((globalThis as any).Buffer.from(b64, "base64"));
}
