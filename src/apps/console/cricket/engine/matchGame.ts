// A whole match for the page: the start state from settings, the flow between balls (engine/match.ts)
// driven one pad sample at a time, the scorecard, and the input log a match can be replayed from.

import { Ram } from "./mem";
import { BASE_RAM_MATCH } from "./baseMatch";
import {
  Delivery, MatchEvent, MatchResult, BallSummary, matchFlow, matchStart, pitchAndWeather, canBowl,
  total, wicketsIdx, MATCH,
} from "./match";
import type { Input } from "./engine";

export type Team = "england" | "australia";

export interface MatchSettings {
  /** the side the player's pad controls (null: the computer plays both) */
  human: Team | null;
  batFirst: Team;
  /** overs a side: 10, 20, 40, 50, 55, 60, 90, or 0 for no limit */
  overs: number;
  /** the original's PERIOD (1..5 days, +$E = days - 1) and INNINGS (1 or 2 a side, +$14 = the last
   *  innings' number: 1 or 3); left out: a one-day, one-innings match */
  days?: number;
  innings?: 1 | 2;
  /** the player's fielders are moved by hand (the original's default) */
  humanField: boolean;
  /** 0 easy .. 2 hard ($8604) */
  difficulty: number;
  /** pitch 0..4 and weather 0..7 as the original's venue screens set them; left out: the start state's */
  pitch?: number;
  weather?: number;
  /** start of the random sequence (1..65535) */
  seed: number;
}

export const DEFAULT_MATCH: MatchSettings = { human: "england", batFirst: "england", overs: 10, humanField: true, difficulty: 1, seed: 1 };

const decode = (b64: string): Uint8Array =>
  typeof atob === "function" ? Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)) : new Uint8Array(Buffer.from(b64, "base64"));

/** The RAM of a new match, ready for the innings loop (matchFlow). England is the struct's first side. */
export function newMatch(s: MatchSettings): Ram {
  const buf = new Uint8Array(0x10000);
  for (const [a, b64] of BASE_RAM_MATCH) buf.set(decode(b64), a);
  const m = new Ram(buf);
  const set = (o: number, v: number) => m.ww(MATCH + o, v);
  set(2, s.human === "england" ? 0 : -1);
  set(6, s.human === "australia" ? 0 : -1);
  set(8, s.batFirst === "england" ? 0 : -1);
  set(0x12, s.overs > 0 ? s.overs - 1 : -1);
  set(0xe, (s.days ?? 1) - 1);
  set(0x14, s.innings === 2 ? 3 : 1);
  set(0x18, s.humanField ? -1 : 0);
  if (s.pitch !== undefined) set(0x22, s.pitch);
  if (s.weather !== undefined) set(0x24, s.weather);
  m.ww(0x8604, s.difficulty);
  m.ww(0xe8e8, (s.seed & 0xffff) || 1);
  pitchAndWeather(m);
  m.ww(0xc5e2, -1); // no rain: the rain scene's clock is ported (rainScene), the fielders' walk off is not
  matchStart(m);
  return m;
}

export interface BatLine { name: string; how: "dnb" | "not out" | "bowled" | "caught" | "run out" | "lbw"; bowler?: string; catcher?: string; runs: number; balls: number; fours: number; sixes: number }
export interface BowlLine { name: string; overs: string; maidens: number; runs: number; wickets: number }
export interface InningsCard {
  team: Team; total: number; wickets: number; overs: string;
  extras: { wides: number; legByes: number; byes: number };
  batting: BatLine[]; bowling: BowlLine[]; fallOfWickets: number[];
}

const REC = 0x68;
const HOW = ["dnb", "not out", "not out", "bowled", "caught", "run out", "lbw"] as const;

/** a player's name from his team-table entry */
export function playerName(m: Ram, rec: number): string {
  const a = m.rl(rec + 2) & 0xffff;
  let s = "";
  for (let i = 0; i < 14; i++) { const c = m.rb(a + i) & 0xff; if (c === 0) break; s += String.fromCharCode(c); }
  return s.trim();
}

/** the current innings as a scorecard, from the two sides' records */
export function scorecard(m: Ram): InningsCard {
  const bat = m.rl(0xb51c) & 0xffff, field = m.rl(0xb522) & 0xffff;
  const teamOf = (base: number): Team => ((base === 0xb528 ? m.rw(MATCH) : m.rw(MATCH + 4)) === 0 ? "england" : "australia");
  const batting: BatLine[] = [];
  for (let k = 0; k < 11; k++) {
    const r = bat + REC * k, st = m.rw(r + 6);
    const line: BatLine = { name: playerName(m, r), how: HOW[st] ?? "not out", runs: m.rw(r + 0x1c), balls: m.rw(r + 0x1a), fours: m.rw(r + 0x1e), sixes: m.rw(r + 0x20) };
    if (st === 3 || st === 4 || st === 6) line.bowler = playerName(m, field + REC * m.rw(r + 0x22));
    if (st === 4) line.catcher = playerName(m, field + REC * m.rw(r + 0x24));
    batting.push(line);
  }
  const bowling: BowlLine[] = [];
  for (let k = 0; k < 11; k++) {
    const r = field + REC * k, ob = m.rw(r + 0x10) & 0xffff;
    if (ob === 0 && m.rw(r + 0x14) === 0) continue;
    bowling.push({ name: playerName(m, r), overs: `${ob >> 4}${ob & 0xf ? "." + (ob & 0xf) : ""}`, maidens: m.rw(r + 0x12), runs: m.rw(r + 0x14), wickets: m.rw(r + 0x16) });
  }
  const down = wicketsIdx(m) + 1;
  const fallOfWickets: number[] = [];
  for (let k = 0; k < down; k++) fallOfWickets.push(m.rw(MATCH + 0x5c + 2 * k));
  const balls = m.rw(MATCH + 0x30), ov = m.rw(MATCH + 0x2e); // (the sixth ball is counted before the over is)
  return {
    team: teamOf(bat), total: total(m), wickets: down, overs: balls >= 6 ? `${ov + 1}` : `${ov}${balls ? "." + balls : ""}`,
    extras: { wides: m.rw(MATCH + 0x4e), legByes: m.rw(MATCH + 0x50), byes: m.rw(MATCH + 0x52) },
    batting, bowling, fallOfWickets,
  };
}

/** what the page must answer before play goes on */
export type Question =
  | { kind: "chooseBowler"; forced: boolean; candidates: number[] }
  | { kind: "chooseOpeningBowlers"; candidates: number[] }
  /** the last day is over with the match unfinished: 1 plays on to a result, anything else ends it drawn */
  | { kind: "playOn" };

export class MatchGame {
  readonly m: Ram;
  private flow: Generator<MatchEvent, void, number | undefined>;
  /** the ball in play (null between balls: a question is open or the match is over) */
  delivery: Delivery | null = null;
  question: Question | null = null;
  result: MatchResult | null = null;
  over = false;
  /** finished innings' scorecards (the current one: scorecard(m)) */
  innings: InningsCard[] = [];
  /** what happened since the page last looked (banners): cleared by the page */
  news: MatchEvent[] = [];
  lastBall: BallSummary | null = null;
  /** the replay log: pad samples run-length encoded as [held | pressed << 8, count], and the answers */
  log: { pads: [number, number][]; answers: [number, number][] } = { pads: [], answers: [] };
  private steps = 0;

  constructor(readonly settings: MatchSettings) {
    this.m = newMatch(settings);
    this.flow = matchFlow(this.m, false);
    this.pump(undefined);
  }

  /** the fielding side's players who may be picked in the open question */
  private candidates(forced: boolean): number[] {
    const out: number[] = [];
    for (let k = 0; k < 11; k++) if (canBowl(this.m, k, forced)) out.push(k);
    return out;
  }

  private pump(answer: number | undefined): void {
    for (;;) {
      const ev = this.flow.next(answer);
      answer = undefined;
      if (ev.done) { this.over = true; return; }
      const e = ev.value;
      switch (e.kind) {
        case "delivery": this.delivery = new Delivery(this.m); return;
        case "chooseBowler": this.question = { kind: "chooseBowler", forced: e.forced, candidates: this.candidates(e.forced) }; return;
        case "chooseOpeningBowlers": this.question = { kind: "chooseOpeningBowlers", candidates: this.candidates(false) }; return;
        case "lastDayEnd": this.news.push(e); this.question = { kind: "playOn" }; return;
        case "ball": this.lastBall = e.ball; this.news.push(e); break;
        case "inningsEnd": this.innings.push(scorecard(this.m)); this.news.push(e); break;
        case "matchEnd": this.result = e.result; this.news.push(e); break;
        default: this.news.push(e);
      }
    }
  }

  /** one pad sample: a game tick in the batting view, a frame in the fielding view */
  step(input: Input): void {
    const d = this.delivery;
    if (!d) return;
    const v = (input.held & 0xff) | ((input.pressed & 0xff) << 8);
    const last = this.log.pads[this.log.pads.length - 1];
    if (last && last[0] === v) last[1]++; else this.log.pads.push([v, 1]);
    this.steps++;
    d.step(input);
    if (d.done) { this.delivery = null; this.pump(undefined); }
  }

  /** answer the open question: a player's index (chooseBowler), first | second << 8 (chooseOpeningBowlers),
   *  1 to play on (playOn), or nothing to keep what the engine set (playOn: the match ends drawn) */
  answer(value?: number): void {
    if (!this.question) return;
    this.question = null;
    this.log.answers.push([this.steps, value ?? -1]);
    this.pump(value);
  }
}
