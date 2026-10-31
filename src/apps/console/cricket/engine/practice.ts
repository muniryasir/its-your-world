// Practice sessions: the game layer on top of the engine. Two modes:
// - Bat: you bat against a bowling machine, the original game's computer bowler (its aim, meters,
//   run-up and release), set to a bowler type, arm and accuracy.
// - Bowl: you bowl (the original's human aim, swing/spin choice, meters and run-up taps) to the
//   original's computer batsman, and field: yourself (the original's human-fielding option, its
//   default) or with the computer's fielders.
// Everything is the original's logic: the delivery in the batting view, then (when the ball leaves it)
// the fielding view, running between the wickets and run outs. The striker stays on strike (it's the nets).

import { fieldObjects } from "./fieldSprites";
import type { FieldObject } from "./fieldSprites";
import { Ram, ROM, SIN } from "./mem";
import { Engine, Input, EndReason } from "./engine";
import { Context } from "./context";
import { BASE_RAM_LEFT, BASE_RAM_RIGHT, BASE_CONTEXT_LEFT, BASE_CONTEXT_RIGHT } from "./baseState";
import { BASE_RAM_BOWL, BASE_CONTEXT_BOWL } from "./baseBowl";
import { projectCam } from "./project";
import { rngNext } from "./rng";
import { bodyScreen } from "./batsman";
import { fielderPtrs, fielderSprite } from "./fielders";
import { FieldView, ballRuns } from "./fielding";
import { fieldScreen } from "./fieldlib";
import { padFrame, padPresses } from "./pads";
import { setUpField } from "./teams";
import { MASKS } from "./maskData";
import { w } from "./m68k";

export type BowlerKind = "fast" | "swing" | "spin";
export type Mode = "bat" | "bowl";
export interface Settings {
  /** bat against the machine, or bowl to the computer batsman */
  mode: Mode;
  /** bowl mode: you control the fielder (the original's human-fielding option, $695C; on by default) */
  humanField: boolean;
  /** the bowler: the machine (bat mode) or you (bowl mode) */
  bowler: BowlerKind;
  leftArm: boolean;
  /** 0 .. 99: the original's bowler rating (the machine's accuracy; your aim marker's speed when you bowl) */
  accuracy: number;
  batsman: "left" | "right";
  /** the original's three skill levels ($8604); 1 = the level of the recorded match */
  difficulty: 0 | 1 | 2;
}
export const DEFAULT_SETTINGS: Settings = { mode: "bat", humanField: true, bowler: "fast", leftArm: false, accuracy: 70, batsman: "left", difficulty: 1 };

export type Outcome = "dot" | "runs" | "four" | "six" | "wide" | "bowled" | "lbw" | "caught" | "runout";
export interface BallResult { outcome: Outcome; runs: number; text: string; reason: EndReason | "field" }
export interface Score { runs: number; balls: number; wickets: number; fours: number; sixes: number; dots: number; extras: number }

/** pad bits as the original reads them (S A C B R L D U). A = shot along the ground, B = lofted shot */
export const PAD = { U: 1, D: 2, L: 4, R: 8, B: 0x10, C: 0x20, A: 0x40, S: 0x80 } as const;

/** bowler record +$14 magnitude per type (the sign is the bowling arm) */
const BOWLER_TYPE: Record<BowlerKind, number> = { fast: 1, spin: 2, swing: 4 };

/** about how far the rope is from the middle of the pitch (for the batting view's drawing; the
 *  fielding view uses the original's own boundary test, sub_035090) */
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
  /** the fielding view, once the ball has left the batting view */
  field: FieldView | null = null;
  private handedOver = false;
  private fieldSteps = 0;

  constructor(seed: number, settings: Settings = DEFAULT_SETTINGS, private start: (s: Settings) => Ram = startRam) {
    this.settings = { ...settings };
    this.m = this.start(this.settings);
    // seed the original's random generator
    let s = (seed & 0xffff) || 0x5eed;
    for (let i = 0; i < 4; i++) s = rngNext(s) & 0xffff;
    this.m.ww(0xe8e8, s || 0x5eed);
    this.engine = new Engine(this.m, this.context(), { kind: "done", reason: "dead" });
  }

  get bowling(): boolean { return this.settings.mode === "bowl"; }

  private context(): Context {
    const st = this.settings;
    const base = st.mode === "bowl" ? BASE_CONTEXT_BOWL : st.batsman === "left" ? BASE_CONTEXT_LEFT : BASE_CONTEXT_RIGHT;
    return {
      bowler: { a12: Math.max(0, Math.min(99, Math.round(st.accuracy))), a14: BOWLER_TYPE[st.bowler] * (st.leftArm ? -1 : 1) },
      // the recorded batsmen's ratings; balls faced feeds the original's misjudge rolls (and the computer
      // batsman's shot choice)
      batsman: { ...base.batsman, s1c: Math.min(this.score.balls, 0x7f) },
      dfda12: base.dfda12,
      dfda18: base.dfda18,
    };
  }

  /** what the player is looking at */
  get phase(): "bowling" | "live" | "field" | "result" {
    if (this.result) return "result";
    if (this.field) return "field";
    const k = this.engine.phase.kind;
    return k === "live" ? "live" : k === "done" ? "result" : "bowling";
  }

  /** set up the next ball (optionally with new settings) */
  nextBall(settings?: Settings): void {
    if (settings) {
      const modeChange = settings.mode !== this.settings.mode;
      if (modeChange || (settings.mode === "bat" && settings.batsman !== this.settings.batsman)) {
        // the other batsman comes in (his start state, field mirrored), or the sides swap for the other
        // mode; the random sequence carries on
        const rng = this.m.rw(0xe8e8);
        this.settings = { ...settings };
        this.m = this.start(this.settings);
        this.m.ww(0xe8e8, rng);
        this.engine = new Engine(this.m, this.context(), { kind: "done", reason: "dead" });
        if (modeChange) { this.score = { runs: 0, balls: 0, wickets: 0, fours: 0, sixes: 0, dots: 0, extras: 0 }; this.ballInOver = 0; }
      }
      this.settings = { ...settings };
    }
    const m = this.m;
    this.result = null;
    this.field = null;
    this.handedOver = false;
    this.fieldSteps = 0;
    this.path = [];
    m.ww(0x8604, this.settings.difficulty);
    // the human-fielding option of controller 0 (yours); the fielding view reads it at its set-up
    if (this.bowling) m.ww(0x695c, this.settings.humanField ? -1 : 0);
    if (this.ballInOver === 0) { m.ww(0xd1fe, 0); m.ww(0xd200, 0); } // a new over: bouncer and yorker counts
    m.ww(0xbe98, this.ballInOver); // balls bowled in the over (the computer bowler's plan reads it)
    m.ww(0xbed8, 0);
    m.ww(0xbe68 + 0x32 + 2 * this.ballInOver, 0); // runs off this ball
    for (const a of [0xbee0, 0xbee2, 0xc7e4]) m.ww(a, 0);
    const ctx = this.context();
    this.engine.ctx = ctx;
    // the machine's attributes in its player record, where the fielding side's code reads them
    const bowler = bowlerEntry(m);
    if (bowler >= 0) { m.ww(bowler + 0x12, ctx.bowler.a12); m.ww(bowler + 0x14, ctx.bowler.a14); }
    this.engine.newDelivery();
    setUpField(m); // sub_046FA2 (from sub_00E13E): the field for this delivery
  }

  /** one game tick (the original runs about 42 a second here) */
  tick(input: Input): void {
    if (this.result) return;
    // C during your aim opens the original's in-game menu (loc_00EAEC), which isn't part of practice:
    // C only counts in the fielding view (switch fielder)
    if (!this.field) input = { held: input.held & ~PAD.C, pressed: input.pressed & ~PAD.C };
    if (this.field) return this.fieldTick(input);
    this.engine.step(input);
    const ph = this.engine.phase;
    if (ph.kind === "done") this.endOfDelivery(ph.reason, input);
  }

  /** one step of the fielding view (one per 50 Hz frame) */
  private fieldTick(input: Input): void {
    const m = this.m, fv = this.field!;
    padFrame(m, input.held); // the VBlank handler, for the batsman's pad
    fv.step();
    if (++this.fieldSteps % 3 === 0 && m.rw(0xe5a2) !== 0) this.path.push([m.rw(0xe5b4), m.rw(0xe5bc)]);
    if (fv.done || this.fieldSteps > 3000) this.endOfField();
  }

  private endOfField(): void {
    const m = this.m, fv = this.field!;
    const end = fv.phase.kind === "done" ? fv.phase.end : "dead";
    this.path.push([m.rw(0xe5b4), m.rw(0xe5bc)]);
    const runs = ballRuns(m);
    const how = m.rw(0xbee2);
    const plural = (n: number) => `${n} run${n === 1 ? "" : "s"}`;
    if (how === 4) return this.finish({ outcome: "caught", runs: 0, text: "Caught!", reason: "field" });
    if (how === 5) return this.finish({ outcome: "runout", runs, text: runs ? `Run out! (${plural(runs)} completed)` : "Run out!", reason: "field" });
    if (end === "boundary") {
      const six = m.rw(0x8606) !== 0 && m.rw(0xc7ca) === 0 && m.rw(0xe580) === 0;
      return this.finish({ outcome: six ? "six" : "four", runs, text: six ? "Six!" : "Four!", reason: "field" });
    }
    this.finish({ outcome: runs ? "runs" : "dot", runs, text: runs ? plural(runs) : "No run", reason: "field" });
  }

  private endOfDelivery(reason: EndReason, input: Input): void {
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
    if (!this.handedOver) {
      // the ball left the batting view: 15 more passes of it, in the same frame as this check
      this.handedOver = true;
      this.path = [[m.rw(0xe5b4), m.rw(0xe5bc)]];
      this.engine.handOver();
      this.engine.step({ held: input.held, pressed: 0 }); // the hand-over drops this frame's presses
      return;
    }
    // then the fielding view takes over (sub_0343E2)
    const fv = new FieldView(m, {
      fielding: (r) => padPresses(r, r.rw(0xb526)),
      batting: (r) => padPresses(r, r.rw(0xb520)),
    });
    fv.setup();
    this.field = fv;
  }

  private finish(r: BallResult): void {
    this.field = null;
    this.result = r;
    const s = this.score;
    if (r.outcome === "wide") { s.extras += 1; s.runs += 1; return; }
    s.balls++;
    this.ballInOver = (this.ballInOver + 1) % 6;
    s.runs += r.runs;
    if (r.outcome === "four") s.fours++;
    if (r.outcome === "six") s.sixes++;
    if (r.runs === 0) s.dots++;
    if (r.outcome === "bowled" || r.outcome === "lbw" || r.outcome === "caught" || r.outcome === "runout") s.wickets++;
  }

  // ---------------------------------------------------------------- what to draw

  view(): View {
    if (this.field) return { phase: "field", mode: this.settings.mode, ...fieldScene(this.m) };
    return { phase: this.phase, mode: this.settings.mode, ...scene(this.m, this.engine.phase.kind, !this.result) };
  }

  /** world point (x, height, y) to screen, through the original's camera */
  project(x: number, height: number, y: number): [number, number] {
    return projectCam(this.m, x, w(-height), y);
  }
}

export interface Sprite { kind: "bowler" | "batsman" | "stumps" | "fielder"; x: number; y: number; frame: number; depth: number }
/** the fielding view from above: screen points through the original's field projection (sub_034FA8) */
export interface FieldScene {
  /** players: screen x, y, facing (0..2047, 0 = +x), running frame, team */
  players: { x: number; y: number; facing: number; frame: number; side: "field" | "bat"; ball: boolean; you?: boolean }[];
  ball?: { x: number; y: number; gx: number; gy: number };
  /** camera: world point at the screen's centre (for drawing the ground) */
  cam: [number, number];
  /** human fielding: the original's target marker (sub_0364BC: $C792/$C794 easing to the intercept point) */
  target?: { x: number; y: number };
  /** the original's display objects for this step (fieldSprites.ts), back to front */
  objects: FieldObject[];
  /** the camera's scroll ($8D08, $8D02): screen pixel (x, y) shows ground pixel (x + sx, y + sy) */
  scroll: [number, number];
  /** the pitch overlay with the runners' icons is up ($C7F6) */
  overlay: boolean;
}
export interface View {
  phase: "bowling" | "live" | "field" | "result";
  /** bat: the machine bowls (its meters move the gauges); bowl: you do */
  mode: Mode;
  enginePhase: string;
  /** far to near */
  sprites: Sprite[];
  ball?: { sx: number; sy: number; hx: number; hy: number; r: number; depth: number };
  marker?: [number, number][];
  /** your bowling meters: power (what the needle gives the release, 0..1), pace from the run-up taps
   *  (0..1), swing/spin direction (-1 in, 1 out, 0 = fast bowler), which stage is live */
  meters?: { power: number; pace: number; swing: number; stage: "swing" | "meter" | "runup"; needle: number };
  field?: FieldScene;
  /** batting view: the power needle (sine of the needle angle, ±32767) and the run-up pace */
  gauges?: { needle: number; pace: number };
}

/** the fielding view: fielders (records at $B522), the two batsmen running ($C800, $C81E) and the ball */
export function fieldScene(m: Ram): Omit<View, "phase" | "mode"> {
  const players: FieldScene["players"] = [];
  const base = m.rl(0xb522) & 0xffff;
  const holder = m.rl(0xc730) & 0xffff;
  for (let i = 0; i < 11; i++) {
    const a0 = base + 0x68 * i;
    const [x, y] = fieldScreen(m, m.rw(a0 + 0x3c), 0, m.rw(a0 + 0x44));
    const you = m.rw(0x8602) !== 0 && a0 === holder; // the fielder you steer ($C730 while human fielding is on)
    players.push({ x, y, facing: m.rw(a0 + 0x56) & 0x7ff, frame: m.rw(a0 + 0x5e), side: "field", ball: m.rw(0xe5a2) === 0 && a0 === holder, you });
  }
  for (const a0 of [0xc800, 0xc81e]) {
    const [x, y] = fieldScreen(m, m.rw(a0), 0, m.rw(a0 + 4));
    players.push({ x, y, facing: m.rw(a0 + 8) === 0 ? 0x600 : 0x200, frame: m.rw(a0 + 0xe), side: "bat", ball: false });
  }
  let ball: FieldScene["ball"];
  if (m.rw(0xe5a2) !== 0) {
    const [x, y] = fieldScreen(m, m.rw(0xe5b4), w(-m.rw(0xe5b8)), m.rw(0xe5bc));
    const [gx, gy] = fieldScreen(m, m.rw(0xe5b4), 0, m.rw(0xe5bc));
    ball = { x, y, gx, gy };
  }
  let target: FieldScene["target"];
  if (m.rw(0x8602) !== 0 && m.rw(0xc784) !== 0) {
    const [x, y] = fieldScreen(m, m.rw(0xc792), 0, m.rw(0xc794));
    target = { x, y };
  }
  const scroll: [number, number] = [m.rw(0x8d08), m.rw(0x8d02)];
  return { enginePhase: "field", sprites: [], field: { players, ball, cam: scroll, target, objects: fieldObjects(m), scroll, overlay: m.rw(0xc7f6) !== 0 } };
}

/** the batting view for the current RAM: sprites as the original places them, ball, aim marker, meters */
export function scene(m: Ram, ph: string, showBall = true): Omit<View, "phase" | "mode"> {
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
  // the gauges' needles: the original leaves them where the last delivery put them
  const v: Omit<View, "phase" | "mode"> = { enginePhase: ph, sprites, ball, gauges: { needle: SIN(m.rw(0xe956)), pace: m.rw(0xe95a) } };
  if (ph === "aim" || ph === "settle") v.marker = markerQuad(m);
  if (ph.startsWith("meter") || ph === "swing" || ph === "paceWait" || ph === "runup") {
    // sub_044480: the release uses 0x80 - |sin(needle)| / 256
    const power = (0x80 - (Math.abs(SIN(m.rw(0xe956))) >> 8)) / 0x80;
    v.meters = {
      power: Math.max(0, Math.min(1, power)),
      pace: Math.max(0, Math.min(1, m.rw(0xe95a) / 0x7f)),
      swing: m.rw(0xd28e) === 0 ? 0 : m.rw(0xe954) < 0 ? -1 : 1,
      stage: ph === "swing" ? "swing" : ph === "runup" || ph === "paceWait" ? "runup" : "meter",
      needle: SIN(m.rw(0xe956)), // the power gauge's needle follows the sine of the needle angle
    };
  }
  return v;
}

/** the bowler's player entry (fielder record with role 1, its +2 pointer) */
function bowlerEntry(m: Ram): number {
  const base = m.rl(0xb522) & 0xffff;
  for (let i = 0; i < 11; i++) if (m.rw(base + 0x68 * i + 6) === 1) return m.rl(base + 0x68 * i + 2) & 0xffff;
  return -1;
}

/** sub_0438F8: the aim marker's corners on the pitch (x ± size, y ± 3 size) */
function markerQuad(m: Ram): [number, number][] {
  const x = m.rw(0xd1d6), y = m.rw(0xd1da), s = m.rw(0xd1bc), t = 3 * s;
  return ([[x - s, y - t], [x + s, y - t], [x + s, y + t], [x - s, y + t]] as [number, number][]).map(([a, b]) => projectCam(m, a, 0, b));
}

function startRam(s: Settings): Ram {
  const buf = new Uint8Array(0x10000);
  for (const [a, b64] of s.mode === "bowl" ? BASE_RAM_BOWL : s.batsman === "left" ? BASE_RAM_LEFT : BASE_RAM_RIGHT) buf.set(decode(b64), a);
  return new Ram(buf);
}

function decode(b64: string): Uint8Array {
  if (typeof atob === "function") return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new Uint8Array((globalThis as any).Buffer.from(b64, "base64"));
}
