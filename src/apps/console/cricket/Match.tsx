// A whole match, England v Australia (phase 4, parts E and F): the setup screen, then play ball by ball
// with the original's rules (engine/match.ts through engine/matchGame.ts): both views drawn with the
// original art, the score strip, banners between balls, the captain's questions (bowlers, follow-on,
// playing on), the pause menu (scorecard, declare, change bowler, auto play, abandon) and the match kept
// in the browser. No Wasp imports here, like Nets.tsx.
import { useCallback, useEffect, useRef, useState } from "react";
import { MatchGame, DEFAULT_MATCH, scorecard, playerName, TEAM_NAMES } from "./engine/matchGame";
import type { MatchSettings, SavedMatch, Team, InningsCard, Question } from "./engine/matchGame";
import { MATCH, inningsNo } from "./engine/match";
import type { MatchEvent, MatchResult } from "./engine/match";
import { PAD, scene, fieldScene } from "./engine/practice";
import { VENUES, PITCH_NAMES, WEATHER_NAMES, rainChance } from "./engine/venue";
import type { View } from "./engine/practice";
import { drawScene, SCREEN_W, SCREEN_H } from "./render";
import { TouchPad } from "./Nets";
import rainCovers from "./art/rain-covers.png";
import { getArt, matchColours } from "./art";
import { RUNOUT } from "./art/atlas";
import { drawBanner } from "./hud";

const TICK_MS = 1000 / 50;
const LIVE_TICK_MS = 1000 / 41;
const SCALE = 3;
/** the computer's set-up (aim, meters) runs this many ticks per tick time, as in the nets */
const SETUP_SPEED = 4;
const SETUP_PHASES = new Set(["preaim", "aim", "settle", "swing", "meterWait", "meterA", "meterB", "meterC", "paceWait"]);
const STORE = "cc-match-v2";
const KEYS: Record<string, number> = {
  ArrowUp: PAD.U, ArrowDown: PAD.D, ArrowLeft: PAD.L, ArrowRight: PAD.R, KeyZ: PAD.A, KeyX: PAD.B, KeyC: PAD.C,
};
const RAIN_MS = 7000;
const REPLAY_MS = 3800;
const NAMES: readonly string[] = TEAM_NAMES.map((n) => (n === "All Time Xi" ? "All Time XI" : n));
const OVERS = [10, 20, 40, 50, 55, 60, 90, 0];

/** `?cc-match-demo` (screenshots): the computer plays your side; `?cc-seed=N` fixes the random sequence */
function urlOptions(): { seed?: number; demo: boolean } {
  if (typeof location === "undefined") return { demo: false };
  const q = new URLSearchParams(location.search);
  const s = q.get("cc-seed");
  return { seed: s ? Number(s) : undefined, demo: q.has("cc-match-demo") };
}

function loadSaved(): SavedMatch | null {
  try {
    const raw = localStorage.getItem(STORE);
    if (!raw) return null;
    const s = JSON.parse(raw) as SavedMatch;
    return s.v === 1 && typeof s.ram === "string" ? s : null;
  } catch { return null; }
}
function store(s: SavedMatch | null): void {
  try { if (s) localStorage.setItem(STORE, JSON.stringify(s)); else localStorage.removeItem(STORE); } catch { /* private mode: not kept */ }
}

export function Match() {
  const opts = useRef(urlOptions()).current;
  const [saved, setSaved] = useState<SavedMatch | null>(null);
  const [game, setGame] = useState<MatchGame | null>(null);
  const [id, setId] = useState(0);
  useEffect(() => { setSaved(loadSaved()); }, []);

  const start = (s: MatchSettings) => { store(null); setSaved(null); setGame(new MatchGame(s, undefined, opts.demo)); setId((i) => i + 1); };
  const resume = () => { if (saved) { setGame(new MatchGame(saved.settings, saved, opts.demo)); setId((i) => i + 1); } };
  const quit = () => { store(null); setSaved(null); setGame(null); };
  const backToSetup = () => { setSaved(loadSaved()); setGame(null); };

  if (game) return <MatchPlay key={id} game={game} onQuit={quit} onNew={backToSetup} demo={opts.demo} />;
  return <Setup saved={saved} onStart={start} onResume={resume} onDiscard={quit} seed={opts.seed} />;
}

// ---------------------------------------------------------------- setup

function Setup({ saved, onStart, onResume, onDiscard, seed }: { saved: SavedMatch | null; onStart: (s: MatchSettings) => void; onResume: () => void; onDiscard: () => void; seed?: number }) {
  const [teams, setTeams] = useState<[Team, Team]>([0, 1]);
  const [side, setSide] = useState<0 | 1 | "watch">(0);
  const [batFirst, setBatFirst] = useState<0 | 1>(0);
  const [overs, setOvers] = useState(10);
  const [days, setDays] = useState(1);
  const [innings, setInnings] = useState<1 | 2>(1);
  const [coloured, setColoured] = useState(false);
  const [difficulty, setDifficulty] = useState(1);
  const [humanField, setHumanField] = useState(true);
  const [venue, setVenue] = useState<number | "home">("home");
  const [pitch, setPitch] = useState<number | "random">("random");
  const [weather, setWeather] = useState<number | "random">("random");
  const test = overs === 0;
  const seg = <T extends string | number | boolean>(name: string, legend: string, value: T, set: (v: T) => void, items: [T, string][]) => (
    <fieldset className="cc-seg">
      <legend>{legend}</legend>
      {items.map(([v, label]) => (
        <label key={String(v)} className={value === v ? "on" : ""}>
          <input type="radio" name={name} checked={value === v} onChange={() => set(v)} />{label}
        </label>
      ))}
    </fieldset>
  );
  const pickTeam = (k: 0 | 1, t: Team) => {
    const next: [Team, Team] = [...teams] as [Team, Team];
    next[k] = t;
    if (next[0] === next[1]) next[1 - k] = teams[k]; // the same team twice: swap them
    setTeams(next);
  };
  const teamSelect = (k: 0 | 1, label: string) => (
    <label className="cc-m-select">
      <span>{label}</span>
      <select value={teams[k]} onChange={(e) => pickTeam(k, Number(e.target.value))}>
        {NAMES.map((n, t) => <option key={t} value={t}>{n}</option>)}
      </select>
    </label>
  );
  return (
    <div className="cc-m-setup">
      {saved && (
        <section className="cc-panel cc-m-saved">
          <h2>Your match in progress</h2>
          <p className="cc-muted">{savedLine(saved)}</p>
          <div className="cc-actions">
            <button className="cc-btn cc-btn--primary" onClick={onResume}>Resume the match</button>
            <button className="cc-btn" onClick={onDiscard}>Abandon it</button>
          </div>
        </section>
      )}
      <section className="cc-panel">
        <h2>New match: {NAMES[teams[0]]} v {NAMES[teams[1]]}</h2>
        <p className="cc-muted">The original's 13 teams of an international match, with their players and ratings, and all its match settings. A one-day match of 10 overs a side takes about 20 minutes; with unlimited overs it's a Test, with a clock, lunch, tea and close of play.</p>
        <div className="cc-m-teams">{teamSelect(0, "First team")}<span className="cc-m-v">v</span>{teamSelect(1, "Second team")}</div>
        <div className="cc-m-grid">
          {seg("cc-side", "You play", side, setSide, [[0, NAMES[teams[0]]], [1, NAMES[teams[1]]], ["watch", "Watch the computer"]])}
          {side === "watch"
            ? seg("cc-first", "Batting first", batFirst, setBatFirst, [[0, NAMES[teams[0]]], [1, NAMES[teams[1]]]])
            : <p className="cc-small cc-m-note">Batting first: decided by the toss.</p>}
          {seg("cc-overs", "Overs a side", overs, setOvers, OVERS.map((o) => [o, o ? String(o) : "Unlimited"] as [number, string]))}
          {seg("cc-days", "Period", days, setDays, [1, 2, 3, 4, 5].map((d) => [d, `${d} day${d > 1 ? "s" : ""}`] as [number, string]))}
          {seg("cc-inn", "Innings", innings, setInnings, [[1, "1 each"], [2, "2 each"]])}
          {seg("cc-kits", "Kits", coloured, setColoured, [[false, "White"], [true, "Coloured"]])}
          {seg("cc-diff", "Level", difficulty, setDifficulty, [[0, "Easy"], [1, "Normal"], [2, "Hard"]])}
          {side !== "watch" && (
            <label className="cc-check cc-check--panel">
              <input type="checkbox" checked={humanField} onChange={(e) => setHumanField(e.target.checked)} /> Field the ball yourself
            </label>
          )}
        </div>
        <div className="cc-m-teams">
          <label className="cc-m-select"><span>Venue</span>
            <select value={venue} onChange={(e) => setVenue(e.target.value === "home" ? "home" : Number(e.target.value))}>
              <option value="home">{NAMES[teams[0]] && teams[0] < VENUES ? `Home: ${NAMES[teams[0]]}` : `Home: ${NAMES[0]}`}</option>
              {NAMES.slice(0, VENUES).map((n, v) => <option key={v} value={v}>{n}</option>)}
            </select></label>
          <label className="cc-m-select"><span>Pitch</span>
            <select value={pitch} onChange={(e) => setPitch(e.target.value === "random" ? "random" : Number(e.target.value))}>
              <option value="random">The venue's chances</option>
              {PITCH_NAMES.map((n, k) => <option key={k} value={k}>{n}</option>)}
            </select></label>
          <label className="cc-m-select"><span>Weather</span>
            <select value={weather} onChange={(e) => setWeather(e.target.value === "random" ? "random" : Number(e.target.value))}>
              <option value="random">The venue's chances</option>
              {WEATHER_NAMES.map((n, k) => <option key={k} value={k}>{n}</option>)}
            </select></label>
        </div>
        {!test && innings === 2 && <p className="cc-small">Two innings each with a limit of overs: as the original allows it.</p>}
        <div className="cc-actions">
          <button className="cc-btn cc-btn--primary" onClick={() => onStart({
            ...DEFAULT_MATCH, teams, human: side === "watch" ? null : teams[side], batFirst: teams[batFirst], overs, days, innings, coloured, difficulty, humanField,
            toss: side !== "watch", venue: venue === "home" ? undefined : venue, pitch: pitch === "random" ? undefined : pitch, weather: weather === "random" ? undefined : weather,
            seed: seed ?? ((Date.now() & 0xffff) || 1),
          })}>Start the match</button>
        </div>
      </section>
    </div>
  );
}

function savedLine(s: SavedMatch): string {
  const st = s.settings;
  const kind = st.overs ? `${st.overs} overs a side` : `${st.days ?? 1}-day Test`;
  const [a, b] = st.teams ?? [0, 1];
  const who = `${NAMES[a]} v ${NAMES[b]}, ${st.human !== null ? `you play ${NAMES[st.human]}` : "watching"}`;
  const done = s.innings.map((c) => `${NAMES[c.team]} ${c.total}/${c.wickets}`).join(", ");
  return `${kind}, ${who}${done ? ` · ${done}` : ""} · ${s.balls} balls bowled`;
}

// ---------------------------------------------------------------- play

interface Banner { text: string; sub?: string; tone: "plain" | "good" | "bad" | "big" }
interface Hud {
  card: InningsCard;
  inn: number;
  ballsInOver: number[];
  status: string;
  clock: string;
  striker: string; nonStriker: string; bowler: string;
  banner: Banner | null;
  question: Question | null;
  result: MatchResult | null;
}

const HOW: Record<number, string> = { 3: "Bowled!", 4: "Caught!", 5: "Run out!", 6: "LBW!" };

function MatchPlay({ game: g, onQuit, onNew, demo }: { game: MatchGame; onQuit: () => void; onNew: () => void; demo: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const heldRef = useRef(0);
  const pressedRef = useRef(0);
  const holdUntil = useRef(g.balls === 0 ? performance.now() + 3500 : 0);
  const overBalls = useRef<number[]>([]);
  const lastSave = useRef(0);
  const [paused, setPaused] = useState(false);
  const [menu, setMenu] = useState<"" | "pause" | "card" | "bowler">("");
  const [auto, setAuto] = useState(g.auto);
  const [quick, setQuick] = useState(false);
  const [rain, setRain] = useState<{ from: number; to: number; at: number } | null>(null);
  const [replay, setReplay] = useState<{ out: boolean; at: number; colours: [number, number, boolean] } | null>(null);
  const [hud, setHud] = useState<Hud>(() => readHud(g, g.balls === 0 ? conditionsBanner(g) : null, []));

  const press = useCallback((bits: number) => { pressedRef.current |= bits & ~heldRef.current; heldRef.current |= bits; }, []);
  const release = useCallback((bits: number) => { heldRef.current &= ~bits; }, []);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest?.("input, select, textarea, dialog")) return;
      if (KEYS[e.code] !== undefined) { e.preventDefault(); if (!e.repeat) press(KEYS[e.code]); }
      else if (e.code === "Space" || e.code === "Enter") { e.preventDefault(); holdUntil.current = 0; }
      else if (e.code === "KeyP" || e.code === "Escape") { setMenu((v) => (v ? "" : "pause")); }
    };
    const up = (e: KeyboardEvent) => { if (KEYS[e.code] !== undefined) release(KEYS[e.code]); };
    const blur = () => { heldRef.current = 0; };
    window.addEventListener("keydown", down); window.addEventListener("keyup", up); window.addEventListener("blur", blur);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); window.removeEventListener("blur", blur); };
  }, [press, release]);

  // what happened since the last look: banners, the over's balls, the match kept in the browser
  const settle = useCallback((now: number, quickMode: boolean) => {
    const news = g.news.splice(0);
    let banner: Banner | null = null, hold = 0;
    for (const e of news) {
      const b = bannerFor(g, e);
      if (e.kind === "ball") {
        overBalls.current = [...overBalls.current, e.ball.wide ? -1 : e.ball.wicket ? -2 : e.ball.runs];
        if (!banner) { banner = b; hold = 700; }
      } else if (b) { banner = b; hold = Math.max(hold, e.kind === "wicket" || e.kind === "overEnd" ? 1500 : 2600); }
      if (e.kind === "overEnd" || e.kind === "inningsStart") overBalls.current = [];
      if (e.kind === "replay" && !quickMode && getArt()) {
        setReplay({ out: e.out, at: now, colours: matchColours(g.m) });
        hold = Math.max(hold, REPLAY_MS);
      }
      if (e.kind === "rain" && !quickMode) {
        // the clock has moved on already (rainScene): the scene shows it running from the break
        const to = g.m.rl(0xbf0a) / 65536;
        setRain({ from: to - 0xa08000 / 65536, to, at: now });
        hold = Math.max(hold, RAIN_MS);
      }
    }
    if (!quickMode) holdUntil.current = now + hold;
    if (g.over) store(null);
    else if (g.delivery && (now - lastSave.current > 1500 || !quickMode)) { store(g.save()); lastSave.current = now; }
    setHud((h) => readHud(g, banner ?? (quickMode ? null : h.banner), overBalls.current));
  }, [g]);

  // the questions: answered by the computer in auto play
  useEffect(() => {
    if (g.question && (auto || quick)) { g.answer(); settle(performance.now(), quick); }
  }, [hud.question, auto, quick, g, settle]);

  useEffect(() => {
    let raf = 0, last = performance.now(), acc = 0, balls = g.balls;
    const ctx = canvasRef.current!.getContext("2d")!;
    let lastView: View | null = null;
    const frame = (now: number) => {
      acc += Math.min(250, now - last);
      last = now;
      if (quick) {
        // quick auto play: no drawing, as many balls as fit in a slice of the frame
        const t0 = performance.now();
        while (!g.over && performance.now() - t0 < 24) {
          if (g.question) { g.answer(); continue; }
          g.step({ held: 0, pressed: 0 });
        }
        acc = 0;
        if (g.balls !== balls || g.over) { balls = g.balls; settle(now, true); }
        if (g.over) setQuick(false);
      } else if (!paused && !menu && g.delivery && !g.question && now >= holdUntil.current) {
        const d = g.delivery;
        const human = g.padRole;
        for (;;) {
          const step = d.field ? TICK_MS : d.engine.phase.kind === "live" ? LIVE_TICK_MS : TICK_MS;
          if (acc < step || g.delivery !== d) break;
          acc -= step;
          const fast = !d.field && human !== "bowl";
          for (let i = 0; g.delivery === d && (i === 0 || (fast && i < SETUP_SPEED && SETUP_PHASES.has(d.engine.phase.kind))); i++) {
            let held = heldRef.current, pressed = pressedRef.current;
            // C in the batting view opens the original's in-game menu: here that's the pause button
            if (!d.field) { held &= ~PAD.C; pressed &= ~PAD.C; }
            g.step({ held, pressed });
            pressedRef.current = 0;
          }
        }
        if (acc > LIVE_TICK_MS) acc = 0;
        if (g.balls !== balls || g.question || g.over) { balls = g.balls; settle(now, false); }
      } else acc = 0;
      if (!quick && g.delivery) {
        const d = g.delivery, mode = g.padRole === "bowl" ? "bowl" : "bat";
        const k = d.engine.phase.kind;
        lastView = d.field ? { phase: "field", mode, ...fieldScene(g.m) } : { phase: k === "live" ? "live" : "bowling", mode, hud: true, ...scene(g.m, k, true) } as View;
      }
      if (lastView && !quick) drawScene(ctx, g.m, lastView, SCALE, now);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [g, paused, menu, quick, settle]);

  const toggleAuto = () => { g.auto = !g.auto; setAuto(g.auto); };
  const humanSide = g.settings.human !== null && g.settings.human !== undefined;
  const canDeclare = !!humanSide && g.m.rw(MATCH + 0x12) < 0 && g.m.rw(0xb520) >= 0 && !g.over;
  const canChange = !!humanSide && g.m.rw(0xb526) >= 0 && !g.over;
  const { card, banner, question, result } = hud;
  const bowling = g.padRole === "bowl";

  return (
    <div className="cc-nets">
      <div className="cc-stage">
        <div className="cc-board cc-m-board" aria-live="polite">
          <div className="cc-total">
            <span className="cc-m-team">{NAMES[card.team]}</span>
            <span className="cc-runs">{card.total}/{card.wickets}</span>
            <span className="cc-overs">{card.overs} ov</span>
          </div>
          <ol className="cc-over" aria-label="This over">
            {hud.ballsInOver.slice(-8).map((r, i) => (
              <li key={i} className={`cc-ball ${r === -2 ? "cc-ball--bowled" : r === -1 ? "cc-ball--wide" : r >= 4 ? "cc-ball--four" : r > 0 ? "cc-ball--runs" : ""}`}>{r === -2 ? "W" : r === -1 ? "wd" : r === 0 ? "•" : r}</li>
            ))}
          </ol>
          <div className="cc-m-status">
            <span>{hud.status}</span>
            {hud.clock && <span className="cc-m-clock">{hud.clock}</span>}
          </div>
          <div className="cc-m-players">
            <span>{hud.striker}</span><span>{hud.nonStriker}</span><span className="cc-m-bowler">{hud.bowler}</span>
          </div>
        </div>

        <div className="cc-screen">
          <canvas ref={canvasRef} width={SCREEN_W * SCALE} height={SCREEN_H * SCALE} className="cc-canvas" aria-label="The match: batting view, then the fielding view once the ball is hit" />
          {quick && (
            <div className="cc-overlay">
              <p className="cc-overlay-title">Auto play</p>
              <p className="cc-overlay-text">The computer plays both sides to the end: {NAMES[card.team]} {card.total}/{card.wickets} ({card.overs} overs)</p>
              <button className="cc-btn" onClick={() => setQuick(false)}>Stop and watch</button>
            </div>
          )}
          {rain && !quick && <RainScene rain={rain} onDone={() => setRain(null)} />}
          {replay && !quick && !rain && <ReplayScene replay={replay} onDone={() => setReplay(null)} />}
          {banner && !quick && !result && !rain && !replay && (
            getArt() ? <BannerBox banner={banner} /> : (
            <div className={`cc-result cc-m-banner cc-m-banner--${banner.tone}`} role="status">
              <span className="cc-result-text">{banner.text}</span>
              {banner.sub && <span className="cc-muted">{banner.sub}</span>}
            </div>)
          )}
          {result && (
            <div className="cc-overlay">
              <p className="cc-overlay-title">{resultText(g, result)}</p>
              <p className="cc-overlay-text">{[...g.innings].map((c) => `${NAMES[c.team]} ${c.total}${c.wickets < 10 ? "/" + c.wickets : ""}`).join(" · ")}</p>
              <div className="cc-actions">
                <button className="cc-btn cc-btn--primary" onClick={() => setMenu("card")}>Scorecard</button>
                <button className="cc-btn" onClick={() => { store(null); onNew(); }}>New match</button>
              </div>
            </div>
          )}
          {question && !auto && !quick && <QuestionBox g={g} q={question} onDone={() => settle(performance.now(), false)} />}
          {menu === "pause" && (
            <div className="cc-overlay" role="dialog" aria-label="Pause menu">
              <p className="cc-overlay-title">Paused</p>
              <div className="cc-m-menu">
                <button className="cc-btn cc-btn--primary" onClick={() => setMenu("")}>Resume</button>
                <button className="cc-btn" onClick={() => setMenu("card")}>Scorecard</button>
                {canChange && <button className="cc-btn" onClick={() => setMenu("bowler")}>Change next bowler</button>}
                {canDeclare && <button className="cc-btn" onClick={() => { g.declare(); setMenu(""); }}>Declare (at the end of this over)</button>}
                {humanSide && <button className="cc-btn" onClick={() => { toggleAuto(); setMenu(""); }}>{auto ? "Auto play off: back to you" : "Auto play: watch the computer play for you"}</button>}
                <button className="cc-btn" onClick={() => { g.auto = true; setAuto(true); setQuick(true); setMenu(""); }}>Auto play quick: to the result</button>
                <button className="cc-btn" onClick={() => { if (window.confirm("Abandon this match?")) onQuit(); }}>Abandon the match</button>
              </div>
            </div>
          )}
          {menu === "bowler" && <BowlerPicker g={g} onDone={() => setMenu("")} />}
          {menu === "card" && <Scorecards g={g} onClose={() => setMenu(result ? "" : "pause")} />}
        </div>

        {humanSide && !auto && <TouchPad press={press} release={release} bowling={bowling} />}

        <div className="cc-actions">
          <button className="cc-btn" onClick={() => setMenu("pause")}>Pause menu</button>
          <button className="cc-btn" onClick={() => setMenu("card")}>Scorecard</button>
          {humanSide && <label className="cc-check"><input type="checkbox" checked={auto} onChange={toggleAuto} /> Auto play</label>}
          <label className="cc-check"><input type="checkbox" checked={paused} onChange={(e) => setPaused(e.target.checked)} /> Hold play</label>
          <span className="cc-muted">{!humanSide ? "Watching" : demo ? "Demo: the computer plays for you" : auto ? "The computer is playing for you" : g.padRole === "bat" ? "You're batting" : g.padRole === "bowl" ? "You're bowling and fielding" : ""}</span>
        </div>
      </div>

      <aside className="cc-side">
        <section className="cc-panel">
          <h2>{g.settings.overs ? `${g.settings.overs} overs a side` : `${g.settings.days ?? 1}-day Test`}</h2>
          <p className="cc-muted">{NAMES[(g.settings.teams ?? [0, 1])[0]]} v {NAMES[(g.settings.teams ?? [0, 1])[1]]} · {g.settings.innings === 2 ? "two innings each" : "one innings each"} · {g.settings.coloured ? "coloured kits" : "whites"} · {["easy", "normal", "hard"][g.settings.difficulty]}</p>
          <p className="cc-muted">The match is kept in this browser after every ball.</p>
        </section>
        <section className="cc-panel">
          <h2>Controls</h2>
          <dl className="cc-keys">
            <div><dt><kbd>↑</kbd> <kbd>↓</kbd> <kbd>←</kbd> <kbd>→</kbd></dt><dd>Batting: shot direction (and footwork before the ball). Bowling: aim; fielding: run</dd></div>
            <div><dt><kbd>Z</kbd></dt><dd>Batting: along the ground, then run. Bowling: fix the aim, stop the meter, tap in the run-up. Fielding: throw to the keeper</dd></div>
            <div><dt><kbd>X</kbd></dt><dd>Batting: loft it. Fielding: throw to the bowler's end</dd></div>
            <div><dt><kbd>C</kbd></dt><dd>Fielding: switch fielder</dd></div>
            <div><dt><kbd>Space</kbd></dt><dd>Skip the pause between balls</dd></div>
            <div><dt><kbd>P</kbd> / <kbd>Esc</kbd></dt><dd>Pause menu: scorecard, change bowler, declare, auto play</dd></div>
          </dl>
        </section>
      </aside>
    </div>
  );
}

function readHud(g: MatchGame, banner: Banner | null, ballsInOver: number[]): Hud {
  const m = g.m, card = scorecard(m);
  const rec = (base: number, k: number) => base + 0x68 * k;
  const bat = m.rl(0xb51c) & 0xffff, field = m.rl(0xb522) & 0xffff;
  let striker = "", nonStriker = "", bowler = "";
  for (let k = 0; k < 11; k++) {
    const r = rec(bat, k), role = m.rw(r + 6);
    const line = `${playerName(m, r)} ${m.rw(r + 0x1c)}${role === 1 ? "*" : ""} (${m.rw(r + 0x1a)})`;
    if (role === 1) striker = line; else if (role === 2) nonStriker = line;
    const f = rec(field, k);
    if (m.rw(f + 6) === 1) {
      const ob = m.rw(f + 0x10) & 0xffff;
      bowler = `${playerName(m, f)} ${m.rw(f + 0x16)}-${m.rw(f + 0x14)} (${ob >> 4}${ob & 0xf ? "." + (ob & 0xf) : ""})`;
    }
  }
  return {
    card, inn: inningsNo(m), ballsInOver, banner, question: g.question, result: g.result,
    status: statusLine(g, card), clock: clockLine(g), striker, nonStriker, bowler,
  };
}

/** target, lead or what's left, from the finished innings and this one */
function statusLine(g: MatchGame, card: InningsCard): string {
  const m = g.m, inn = inningsNo(m), last = m.rw(MATCH + 0x14);
  const runs = (t: Team) => g.innings.filter((c) => c.team === t).reduce((a, c) => a + c.total, 0) + (card.team === t ? card.total : 0);
  const [ta, tb] = g.settings.teams ?? [0, 1];
  const other: Team = card.team === ta ? tb : ta;
  const diff = runs(card.team) - runs(other);
  const limit = m.rw(MATCH + 0x12);
  if (inn === 0) return limit >= 0 ? `${limit + 1} overs` : `${inningsName(inn)}`;
  if (inn === last) {
    const need = -diff + 1;
    if (need <= 0) return `${NAMES[card.team]} win`;
    if (limit >= 0) { const left = (limit + 1) * 6 - ballsBowled(card); return `Need ${need} from ${left} ball${left === 1 ? "" : "s"}`; }
    return `Need ${need} to win`;
  }
  return diff >= 0 ? `${inningsName(inn)} · lead by ${diff}` : `${inningsName(inn)} · trail by ${-diff}`;
}
const inningsName = (inn: number) => ["1st innings", "2nd innings", "3rd innings", "4th innings"][inn] ?? "";
function ballsBowled(card: InningsCard): number {
  const [o, b] = card.overs.split(".");
  return Number(o) * 6 + Number(b ?? 0);
}

/** the Test clock: day and time (the original's minutes in $BF0A's high word) */
function clockLine(g: MatchGame): string {
  const m = g.m;
  if (m.rw(MATCH + 0x12) >= 0 && m.rw(MATCH + 0xe) === 0) return "";
  return `Day ${m.rw(MATCH + 0x28) + 1} · ${timeText(m.rw(0xbf0a))}`;
}
function timeText(min: number): string {
  const h = Math.floor(min / 60), mm = String(min % 60).padStart(2, "0");
  return `${h > 12 ? h - 12 : h}:${mm}${h >= 12 ? "pm" : "am"}`;
}

function bannerFor(g: MatchGame, e: MatchEvent): Banner | null {
  const m = g.m;
  switch (e.kind) {
    case "ball":
      if (e.ball.wicket) return null;
      if (e.ball.wide) return { text: "Wide", tone: "plain" };
      return { text: e.ball.runs === 0 ? "No run" : `${e.ball.runs} run${e.ball.runs > 1 ? "s" : ""}`, tone: e.ball.runs >= 4 ? "good" : "plain" };
    case "wicket": { const c = scorecard(m); return { text: HOW[e.how] ?? "Out!", sub: `${NAMES[c.team]} ${c.total}/${c.wickets}`, tone: "bad" }; }
    case "overEnd": { const c = scorecard(m); return { text: "End of the over", sub: `${NAMES[c.team]} ${c.total}/${c.wickets} after ${c.overs}`, tone: "plain" }; }
    case "inningsEnd": { const c = g.innings[g.innings.length - 1]; return c ? { text: c.wickets >= 10 ? `${NAMES[c.team]} all out for ${c.total}` : `${NAMES[c.team]} ${c.total}/${c.wickets}`, sub: `${c.overs} overs`, tone: "big" } : null; }
    case "interval": return { text: e.which === "lunch" ? "Break for lunch" : "Break for tea", sub: `Play will resume at ${timeText(m.rw(0xbf0a))}`, tone: "big" };
    case "dayEnd": return { text: `Close of play, day ${e.day + 1}`, sub: `Play resumes tomorrow at ${timeText(m.rw(0xbf0a))}`, tone: "big" };
    case "rain": return { text: "Rain stops play", sub: `Play resumes at ${timeText(m.rw(0xbf0a))}`, tone: "big" };
    case "declared": { const c = scorecard(m); return { text: `${NAMES[c.team]} declare`, sub: `at ${c.total}/${c.wickets}`, tone: "big" }; }
    case "lastDayEnd": return { text: "Stumps on the last day", sub: "Match drawn, innings incomplete", tone: "big" };
    case "toss": {
      const [ta, tb] = g.settings.teams ?? [0, 1];
      const w = e.winner === 0 ? ta : tb, bats = e.batFirst === 0 ? ta : tb;
      return { text: `${NAMES[w]} win the toss`, sub: `${e.heads ? "Heads" : "Tails"} · ${NAMES[w]} ${bats === w ? "bat" : "bowl"} first`, tone: "big" };
    }
    default: return null;
  }
}

/** the original's weather screen: venue, pitch, weather, the chance of rain */
function conditionsBanner(g: MatchGame): Banner {
  const m = g.m;
  const venue = m.rw(0xbe88);
  return {
    text: `${NAMES[venue] ?? NAMES[0]}: ${PITCH_NAMES[m.rw(MATCH + 0x22)] ?? ""} pitch`,
    sub: `${WEATHER_NAMES[m.rw(MATCH + 0x24)] ?? ""} · ${rainChance(m)} percent chance of rain`, tone: "big",
  };
}

function resultText(g: MatchGame, r: MatchResult): string {
  if (r.kind === "tie") return "The match is a tie";
  if (r.kind === "draw") return "The match is drawn";
  const [ta, tb] = g.settings.teams ?? [0, 1];
  const last = scorecard(g.m).team, first: Team = last === ta ? tb : ta;
  const winner = r.winner === "batting" ? last : first;
  if (r.kind === "innings") return `${NAMES[winner]} win by an innings`;
  return `${NAMES[winner]} win by ${r.margin} ${r.kind === "runs" ? "run" : "wicket"}${r.margin === 1 ? "" : "s"}`;
}

/** a banner in the original's look (phase 6 part F1): drawn on a small canvas over the game screen */
function BannerBox({ banner }: { banner: Banner }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current, art = getArt();
    if (!c || !art) return;
    const ctx = c.getContext("2d")!;
    ctx.imageSmoothingEnabled = false;
    drawBanner(ctx, art.hud, banner.text, banner.sub);
  }, [banner]);
  return (
    <div className={`cc-m-bannerbox${banner.tone === "big" ? " big" : ""}`} role="status" aria-label={banner.sub ? `${banner.text}. ${banner.sub}` : banner.text}>
      <canvas ref={ref} width={208} height={48} />
    </div>
  );
}

/** the original's run-out close-up (sub_039F0E): the keeper, the stumps, the bails flying, the bat
 *  coming in (frames captured from the original, in the two teams' colours), then the verdict */
function ReplayScene({ replay, onDone }: { replay: { out: boolean; at: number; colours: [number, number, boolean] }; onDone: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const art = getArt();
    let raf = 0;
    const draw = (now: number) => {
      const c = ref.current;
      if (!c || !art) return;
      const ctx = c.getContext("2d")!;
      ctx.imageSmoothingEnabled = false;
      const k = Math.min(RUNOUT.frames - 1, Math.floor(((now - replay.at) / 1000) * 50));
      ctx.drawImage(art.runout(...replay.colours), k * RUNOUT.w, 0, RUNOUT.w, RUNOUT.h, 0, 0, RUNOUT.w, RUNOUT.h);
      if (now - replay.at < REPLAY_MS) raf = requestAnimationFrame(draw); else onDone();
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [replay, onDone]);
  return (
    <div className="cc-m-replay" role="status" aria-label="Run-out replay">
      <canvas ref={ref} width={RUNOUT.w} height={RUNOUT.h} style={{ left: `${(RUNOUT.x / 320) * 100}%`, top: `${(RUNOUT.y / 224) * 100}%`, width: `${(RUNOUT.w / 320) * 100}%` }} />
      <p className={`cc-m-replay-text${replay.out ? " out" : ""}`}>{replay.out ? "Run out!" : "Not out"}</p>
    </div>
  );
}

/** the original's rain break: the covers on the ground (its background, from the emulator), the rain, and
 *  the clock running until play can resume */
function RainScene({ rain, onDone }: { rain: { from: number; to: number; at: number }; onDone: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const img = new Image();
    img.src = rainCovers;
    const drops = Array.from({ length: 90 }, (_, i) => ({ x: (i * 97) % 320, y: (i * 53) % 224, v: 3 + (i % 4) }));
    let raf = 0;
    const draw = (now: number) => {
      const c = ref.current;
      if (!c) return;
      const ctx = c.getContext("2d")!;
      const t = Math.min(1, (now - rain.at) / (RAIN_MS - 800));
      ctx.imageSmoothingEnabled = false;
      if (img.complete) ctx.drawImage(img, 0, 0); else { ctx.fillStyle = "#3d5a12"; ctx.fillRect(0, 0, 320, 224); }
      ctx.strokeStyle = "rgba(220,230,255,0.75)"; ctx.lineWidth = 1;
      for (const d of drops) {
        d.y += d.v; d.x -= d.v / 4;
        if (d.y > 224) { d.y = -6; d.x = (d.x + 137) % 340; }
        ctx.beginPath(); ctx.moveTo(d.x, d.y); ctx.lineTo(d.x - 1.5, d.y + 6); ctx.stroke();
      }
      // the clock (the original's stands by the covers): hands at the time of day
      const min = rain.from + (rain.to - rain.from) * t;
      const cx = 266, cy = 160, r = 24;
      ctx.fillStyle = "#7a4a2a"; ctx.fillRect(cx - 32, cy - 42, 64, 78);
      ctx.fillStyle = "#c9c9d6"; ctx.fillRect(cx - 26, cy - 52, 52, 14);
      ctx.fillStyle = "#f4f4f4"; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "#a33"; ctx.lineWidth = 2; ctx.stroke();
      ctx.strokeStyle = "#111";
      const hand = (a: number, len: number, wdt: number) => { ctx.lineWidth = wdt; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.sin(a) * len, cy - Math.cos(a) * len); ctx.stroke(); };
      hand(((min / 60) % 12) / 12 * Math.PI * 2, r * 0.55, 2.5);
      hand(((min % 60) / 60) * Math.PI * 2, r * 0.85, 1.5);
      if (now - rain.at < RAIN_MS) raf = requestAnimationFrame(draw); else onDone();
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [rain, onDone]);
  return (
    <div className="cc-m-rain" role="status" aria-label="Rain stops play">
      <canvas ref={ref} width={320} height={224} />
      <p className="cc-m-rain-text">Rain stops play · play resumes at {timeText(Math.floor(rain.to))}</p>
    </div>
  );
}

// ---------------------------------------------------------------- the captain's questions

function fieldName(g: MatchGame, k: number): string {
  const f = (g.m.rl(0xb522) & 0xffff) + 0x68 * k;
  const ob = g.m.rw(f + 0x10) & 0xffff;
  return `${playerName(g.m, f)}${ob || g.m.rw(f + 0x14) ? ` (${ob >> 4}${ob & 0xf ? "." + (ob & 0xf) : ""}-${g.m.rw(f + 0x12)}-${g.m.rw(f + 0x14)}-${g.m.rw(f + 0x16)})` : ""}`;
}

function QuestionBox({ g, q, onDone }: { g: MatchGame; q: Question; onDone: () => void }) {
  const [first, setFirst] = useState(-1);
  const answer = (v?: number) => { g.answer(v); onDone(); };
  if (q.kind === "chooseBowler") return (
    <div className="cc-overlay" role="dialog" aria-label="Choose a bowler">
      <p className="cc-overlay-title">{q.forced ? "Please select a new bowler" : "Who bowls the next over?"}</p>
      <div className="cc-m-pick">{q.candidates.map((k) => <button key={k} className="cc-btn" onClick={() => answer(k)}>{fieldName(g, k)}</button>)}</div>
    </div>
  );
  if (q.kind === "chooseOpeningBowlers") return (
    <div className="cc-overlay" role="dialog" aria-label="Choose your opening bowlers">
      <p className="cc-overlay-title">{first < 0 ? "Who opens the bowling?" : "And from the other end?"}</p>
      <div className="cc-m-pick">
        {q.candidates.filter((k) => k !== first).map((k) => (
          <button key={k} className="cc-btn" onClick={() => (first < 0 ? setFirst(k) : answer(first | (k << 8)))}>{fieldName(g, k)}</button>
        ))}
      </div>
      <button className="cc-btn cc-btn--small" onClick={() => answer()}>Let the captain choose</button>
    </div>
  );
  if (q.kind === "tossCall") return (
    <div className="cc-overlay" role="dialog" aria-label="The toss">
      <p className="cc-overlay-title">The toss: your call</p>
      <div className="cc-actions"><button className="cc-btn cc-btn--primary" onClick={() => answer(0)}>Heads</button><button className="cc-btn cc-btn--primary" onClick={() => answer(1)}>Tails</button></div>
    </div>
  );
  if (q.kind === "tossChoice") return (
    <div className="cc-overlay" role="dialog" aria-label="You won the toss">
      <p className="cc-overlay-title">You won the toss</p>
      <div className="cc-actions"><button className="cc-btn cc-btn--primary" onClick={() => answer(0)}>Bat first</button><button className="cc-btn cc-btn--primary" onClick={() => answer(1)}>Bowl first</button></div>
    </div>
  );
  if (q.kind === "playOn") return (
    <div className="cc-overlay" role="dialog" aria-label="The last day is over">
      <p className="cc-overlay-title">Match drawn, innings incomplete</p>
      <p className="cc-overlay-text">The last day's play is over. Play on until there's a result?</p>
      <div className="cc-actions"><button className="cc-btn cc-btn--primary" onClick={() => answer(1)}>Continue the match</button><button className="cc-btn" onClick={() => answer()}>End the match</button></div>
    </div>
  );
  return (
    <div className="cc-overlay" role="dialog" aria-label="Follow-on">
      <p className="cc-overlay-title">Enforce the follow-on?</p>
      <p className="cc-overlay-text">The side batting second is far enough behind to be asked to bat again straight away.</p>
      <div className="cc-actions"><button className="cc-btn cc-btn--primary" onClick={() => answer(1)}>Enforce it</button><button className="cc-btn" onClick={() => answer()}>No, bat again ourselves</button></div>
    </div>
  );
}

function BowlerPicker({ g, onDone }: { g: MatchGame; onDone: () => void }) {
  const list = g.nextBowlerCandidates();
  return (
    <div className="cc-overlay" role="dialog" aria-label="Change the next bowler">
      <p className="cc-overlay-title">Who bowls the next over?</p>
      <div className="cc-m-pick">{list.map((k) => <button key={k} className="cc-btn" onClick={() => { g.changeNextBowler(k); onDone(); }}>{fieldName(g, k)}</button>)}</div>
      <button className="cc-btn cc-btn--small" onClick={onDone}>Keep the bowler</button>
    </div>
  );
}

function Scorecards({ g, onClose }: { g: MatchGame; onClose: () => void }) {
  const cards = [...g.innings];
  if (!g.over && g.m.rw(MATCH + 0x2c) >= cards.length) cards.push(scorecard(g.m));
  const [tab, setTab] = useState(cards.length - 1);
  const c = cards[Math.max(0, Math.min(tab, cards.length - 1))];
  return (
    <div className="cc-overlay cc-m-card" role="dialog" aria-label="Scorecard">
      <div className="cc-m-tabs">{cards.map((x, i) => <button key={i} className={`cc-btn cc-btn--small${i === tab ? " cc-m-on" : ""}`} onClick={() => setTab(i)}>{NAMES[x.team]} {inningsName(i)}</button>)}</div>
      {c && (
        <div className="cc-m-cardbody">
          <table>
            <thead><tr><th>{NAMES[c.team]}</th><th></th><th>R</th><th>B</th></tr></thead>
            <tbody>
              {c.batting.filter((b) => b.how !== "dnb").map((b, i) => (
                <tr key={i}><td>{b.name}</td><td className="cc-muted">{b.how === "not out" ? "not out" : b.how === "caught" ? `c ${b.catcher} b ${b.bowler}` : b.how === "bowled" ? `b ${b.bowler}` : b.how === "lbw" ? `lbw b ${b.bowler}` : "run out"}</td><td>{b.runs}</td><td>{b.balls}</td></tr>
              ))}
              <tr><td>Extras</td><td className="cc-muted">w {c.extras.wides}, lb {c.extras.legByes}, b {c.extras.byes}</td><td>{c.extras.wides + c.extras.legByes + c.extras.byes}</td><td></td></tr>
              <tr className="cc-m-totalrow"><td>Total</td><td className="cc-muted">{c.wickets >= 10 ? "all out" : `${c.wickets} wickets`}, {c.overs} overs</td><td>{c.total}</td><td></td></tr>
            </tbody>
          </table>
          <table>
            <thead><tr><th>Bowling</th><th>O</th><th>M</th><th>R</th><th>W</th></tr></thead>
            <tbody>{c.bowling.map((b, i) => <tr key={i}><td>{b.name}</td><td>{b.overs}</td><td>{b.maidens}</td><td>{b.runs}</td><td>{b.wickets}</td></tr>)}</tbody>
          </table>
          {c.fallOfWickets.length > 0 && <p className="cc-muted">Fall of wickets: {c.fallOfWickets.map((r, i) => `${r}-${i + 1}`).join(", ")}</p>}
        </div>
      )}
      <button className="cc-btn" onClick={onClose}>Close</button>
    </div>
  );
}
