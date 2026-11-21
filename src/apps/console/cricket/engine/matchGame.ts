// A whole match for the page: the start state from settings, the flow between balls (engine/match.ts)
// driven one pad sample at a time, the scorecard, and the input log a match can be replayed from.

import { Ram } from "./mem";
import { BASE_RAM_MATCH } from "./baseMatch";
import {
  Delivery, MatchEvent, MatchResult, BallSummary, matchFlow, matchStart, pitchAndWeather, canBowl, humanDeclares,
  setNextBowler,
  total, wicketsIdx, MATCH,
} from "./match";
import type { Input } from "./engine";

import { TEAM_DATA, SQUAD_AT, SQUAD_SIZE, RECORDS_AT, RECORDS_SIZE } from "./teamData";

/** a team: its index in the original's list (0 England, 1 Australia, ... 12 All Time XI) */
export type Team = number;
export const TEAM_NAMES = TEAM_DATA.map((t) => t.name);

export interface MatchSettings {
  /** the side the player's pad controls (null: the computer plays both) */
  human: Team | null;
  batFirst: Team;
  /** the two sides (the original's first and second team picked); left out: England v Australia */
  teams?: [Team, Team];
  /** overs a side: 10, 20, 40, 50, 55, 60, 90, or 0 for no limit */
  overs: number;
  /** the original's PERIOD (1..5 days, +$E = days - 1) and INNINGS (1 or 2 a side, +$14 = the last
   *  innings' number: 1 or 3); left out: a one-day, one-innings match */
  days?: number;
  innings?: 1 | 2;
  /** KITS: coloured clothing and a white ball (+$1A); left out: white */
  coloured?: boolean;
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

export const DEFAULT_MATCH: MatchSettings = { human: 0, batFirst: 0, teams: [0, 1], overs: 10, humanField: true, difficulty: 1, seed: 1 };

const decode = (b64: string): Uint8Array =>
  typeof atob === "function" ? Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)) : new Uint8Array(Buffer.from(b64, "base64"));
function encode(u: Uint8Array): string {
  if (typeof btoa !== "function") return Buffer.from(u).toString("base64");
  let s = "";
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
}

/** a match kept in the browser: the RAM at the start of the ball in play (sub_00E13E's entry), the
 *  finished innings' cards and the settings. Play goes on from that ball. */
export interface SavedMatch { v: 1; settings: MatchSettings; ram: string; innings: InningsCard[]; balls: number }

/** The RAM of a new match, ready for the innings loop (matchFlow). England is the struct's first side. */
export function newMatch(s: MatchSettings): Ram {
  const buf = new Uint8Array(0x10000);
  for (const [a, b64] of BASE_RAM_MATCH) buf.set(decode(b64), a);
  const m = new Ram(buf);
  const set = (o: number, v: number) => m.ww(MATCH + o, v);
  const [ta, tb] = s.teams ?? [0, 1];
  loadTeam(m, ta, 0);
  loadTeam(m, tb, 1);
  set(0, ta); set(4, tb);
  set(2, s.human === ta ? 0 : -1);
  set(6, s.human === tb && s.human !== ta ? 0 : -1);
  set(8, s.batFirst === tb && tb !== ta ? -1 : 0);
  set(0x12, s.overs > 0 ? s.overs - 1 : -1);
  set(0xe, (s.days ?? 1) - 1);
  set(0x14, s.innings === 2 ? 3 : 1);
  set(0x1a, s.coloured ? -1 : 0);
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

/** a side's squad and XI as the original loads them (the second side's block is $8D0 further on, and
 *  its players' records point into it) */
function loadTeam(m: Ram, team: Team, side: 0 | 1): void {
  const t = TEAM_DATA[team];
  const off = side ? SQUAD_SIZE : 0;
  m.buf.set(decode(t.squad), SQUAD_AT + off);
  const rec = side ? 0xb9a0 : RECORDS_AT;
  m.buf.set(decode(t.records), rec);
  if (side) for (let k = 0; k < 11; k++) m.ww(rec + 0x68 * k + 4, m.rw(rec + 0x68 * k + 4) + off);
  // the loaded squads by team ($72EA + 4 x team: the squad's address, 0 when not loaded)
  if (side === 0) for (let k = 0; k < TEAM_DATA.length; k++) m.wl(0x72ea + 4 * k, 0);
  m.wl(0x72ea + 4 * team, 0xff0000 | (SQUAD_AT + off));
}
void RECORDS_SIZE;

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
  const teamOf = (base: number): Team => (base === 0xb528 ? m.rw(MATCH) : m.rw(MATCH + 4));
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
  | { kind: "playOn" }
  /** the human captain may enforce the follow-on: 1 enforces it */
  | { kind: "followOn" };

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
  /** the replay log: pad samples run-length encoded as [held | pressed << 8, count], and the answers
   *  [pad samples so far, value] (-1: nothing given, -2: the human declared) */
  log: { pads: [number, number][]; answers: [number, number][] } = { pads: [], answers: [] };
  private steps = 0;

  /** auto play: the computer plays the human's side's balls (bowling, batting, fielding) and the page
   *  answers the questions; the captain's choices stay the human's */
  auto = false;
  /** balls bowled so far in this match (with wides) */
  balls = 0;
  private snapshot = "";
  private controllers: [number, number] | null = null;

  constructor(readonly settings: MatchSettings, saved?: SavedMatch, auto = false) {
    this.auto = auto;
    if (saved) {
      // the flow resumes after the ball that was in play: its first step is the bookkeeping after it
      this.m = new Ram(decode(saved.ram));
      this.innings = saved.innings;
      this.balls = saved.balls;
      this.flow = matchFlow(this.m, true);
      this.startDelivery();
      return;
    }
    this.m = newMatch(settings);
    this.flow = matchFlow(this.m, false);
    this.pump(undefined);
  }

  /** what to keep in the browser (taken at the start of the ball in play) */
  save(): SavedMatch { return { v: 1, settings: this.settings, ram: this.snapshot, innings: this.innings, balls: this.balls }; }

  private startDelivery(): void {
    this.snapshot = encode(this.m.buf);
    if (this.auto) {
      // the human side's controllers ($B520 batting, $B526 fielding) are the computer's for this ball
      this.controllers = [this.m.rw(0xb520), this.m.rw(0xb526)];
      this.m.ww(0xb520, -1); this.m.ww(0xb526, -1);
    }
    this.delivery = new Delivery(this.m);
  }
  private endDelivery(): void {
    if (this.controllers) { this.m.ww(0xb520, this.controllers[0]); this.m.ww(0xb526, this.controllers[1]); this.controllers = null; }
    this.delivery = null;
    this.balls++;
  }

  /** who the pad plays for in the ball in play: the fielding side (you bowl), the batting side, or nobody */
  get padRole(): "bowl" | "bat" | null {
    if (this.m.rw(0xb526) >= 0) return "bowl";
    if (this.m.rw(0xb520) >= 0) return "bat";
    return null;
  }

  /** the human captain names the bowler of the next over (the in-match menu's "change next bowler") */
  changeNextBowler(idx: number): boolean { return setNextBowler(this.m, idx); }
  /** who may be named for the next over */
  nextBowlerCandidates(): number[] { return this.candidates(false); }

  /** the fielding side's players who may be picked in the open question */
  candidates(forced: boolean): number[] {
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
        case "delivery": this.startDelivery(); return;
        case "chooseBowler": this.question = { kind: "chooseBowler", forced: e.forced, candidates: this.candidates(e.forced) }; return;
        case "chooseOpeningBowlers": this.question = { kind: "chooseOpeningBowlers", candidates: this.candidates(false) }; return;
        case "lastDayEnd": this.news.push(e); this.question = { kind: "playOn" }; return;
        case "followOn": this.question = { kind: "followOn" }; return;
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
    if (d.done) { this.endDelivery(); this.pump(undefined); }
  }

  /** the human captain declares: the innings ends with the over in progress (unlimited overs only) */
  declare(): boolean {
    const ok = humanDeclares(this.m);
    if (ok) this.log.answers.push([this.steps, -2]);
    return ok;
  }

  /** answer the open question: a player's index (chooseBowler), first | second << 8 (chooseOpeningBowlers),
   *  1 to play on (playOn), or nothing to keep what the engine set (playOn: the match ends drawn) */
  answer(value?: number): void {
    if (!this.question) return;
    const q = this.question;
    // a forced change needs a bowler: left alone, the first who may bowl
    if (q.kind === "chooseBowler" && q.forced && (value === undefined || !q.candidates.includes(value))) value = q.candidates[0];
    this.question = null;
    this.log.answers.push([this.steps, value ?? -1]);
    this.pump(value);
  }
}
