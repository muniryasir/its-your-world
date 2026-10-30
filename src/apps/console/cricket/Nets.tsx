// Practice in the nets: the canvas, the scoreboard, the settings and the controls. Two modes: bat
// against the bowling machine, or bowl to the computer batsman (and field).
// No Wasp imports here, so the game can also be mounted on its own (tools/harness).
import { useCallback, useEffect, useRef, useState } from "react";
import { Practice, PAD, DEFAULT_SETTINGS, BOUNDARY, oversText } from "./engine/practice";
import type { Settings, BallResult, Score, BowlerKind, Mode } from "./engine/practice";
import { ROM } from "./engine/mem";
import { drawScene, fieldMapPath, SCREEN_W, SCREEN_H } from "./render";

/** the original runs one game tick per 50 Hz (PAL) frame, except while the ball is live in the batting
 *  view: the extra drawing there drops it to about 41 ticks a second (measured in the emulator). The
 *  fielding view runs one step per frame. */
const TICK_MS = 1000 / 50;
const LIVE_TICK_MS = 1000 / 41;
const SCALE = 3;
const AUTO_NEXT_MS = 2600;
/** the machine's set-up (aim, meters) runs this many ticks per tick time: same logic, less waiting */
const SETUP_SPEED = 4;
const SETUP_PHASES = new Set(["preaim", "aim", "settle", "swing", "meterWait", "meterA", "meterB", "meterC", "paceWait"]);

const KEYS: Record<string, number> = {
  ArrowUp: PAD.U, ArrowDown: PAD.D, ArrowLeft: PAD.L, ArrowRight: PAD.R,
  KeyZ: PAD.A, KeyX: PAD.B, KeyC: PAD.C,
};

interface Hud {
  score: Score;
  result: BallResult | null;
  over: BallResult[];
  phase: Practice["phase"];
  path: [number, number][];
  started: boolean;
}

/** `?cc-seed=N` fixes the random sequence, `?cc-mode=bowl` starts in the bowling mode and `?cc-demo`
 *  plays by itself (for screenshots) */
function urlOptions(): { seed?: number; demo: boolean; mode?: Mode } {
  if (typeof location === "undefined") return { demo: false };
  const q = new URLSearchParams(location.search);
  const s = q.get("cc-seed");
  const mode = q.get("cc-mode");
  return { seed: s ? Number(s) : undefined, demo: q.has("cc-demo"), mode: mode === "bowl" || mode === "bat" ? mode : undefined };
}

/** the demo bowler and fielder: taps A through the aim, swing and meters and during the run-up; in the
 *  field, runs the chaser towards the ball and throws it to the keeper's end */
function demoBowlPad(g: Practice, state: { shot: number; t: number }): number {
  state.t++;
  if (g.phase === "bowling") return state.t % 24 < 2 ? PAD.A : 0;
  if (g.phase !== "field") return 0;
  const m = g.m;
  if (m.rw(0x8602) === 0) return 0; // the computer fields
  const a0 = m.rl(0xc730) & 0xffff;
  if (m.rw(0xe5a2) === 0) return state.t % 8 < 2 ? PAD.A : 0; // he has it: throw to the keeper
  const dx = m.rw(0xe5b4) - m.rw(a0 + 0x3c), dy = m.rw(0xe5bc) - m.rw(a0 + 0x44);
  // the pad direction whose running angle (table $36A58; 2048 per turn, 0 = +x) is nearest the ball
  const want = (Math.round((Math.atan2(dy, dx) / (2 * Math.PI)) * 2048) + 2048) & 0x7ff;
  let best = 0, bestD = 1e9;
  for (const d of [PAD.U, PAD.D, PAD.L, PAD.R, PAD.U | PAD.L, PAD.U | PAD.R, PAD.D | PAD.L, PAD.D | PAD.R]) {
    const a = ROM.rw(0x36a58 + 2 * d) & 0x7ff;
    const diff = Math.min((a - want) & 0x7ff, (want - a) & 0x7ff);
    if (diff < bestD) { best = d; bestD = diff; }
  }
  return best;
}

/** the demo batsman: one drive along the ground as the ball arrives */
function demoPad(g: Practice, state: { shot: number; t: number }): number {
  state.t++;
  if (state.shot < 0 && g.phase === "live" && g.m.rw(0xe5a2) !== 0 && g.m.rw(0xe5bc) > 0x100) state.shot = state.t;
  return state.shot >= 0 && state.t < state.shot + 3 ? PAD.U | PAD.L | PAD.A : 0;
}

export function Nets({ seed }: { seed?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameRef = useRef<Practice | null>(null);
  const heldRef = useRef(0); // keyboard and touch buttons down now
  const pressedRef = useRef(0); // went down since the last tick
  const pendingSettings = useRef<Settings>(DEFAULT_SETTINGS);
  const [settings, setSettings] = useState<Settings>(() => ({ ...DEFAULT_SETTINGS, mode: urlOptions().mode ?? "bat" }));
  const [paused, setPaused] = useState(false);
  const [autoNext, setAutoNext] = useState(true);
  const [hud, setHud] = useState<Hud>({ score: emptyScore(), result: null, over: [], phase: "result", path: [], started: false });
  const overRef = useRef<BallResult[]>([]);
  const resultAt = useRef(0);
  const [stage, setStage] = useState("");
  const stageRef = useRef("");
  const hudStarted = useRef(false);
  hudStarted.current = hud.started;

  const opts = useRef(urlOptions()).current;
  const demoRef = useRef({ shot: -1, t: 0 });
  const initial = useRef<Settings>({ ...DEFAULT_SETTINGS, mode: opts.mode ?? "bat" }).current;
  if (!gameRef.current) {
    gameRef.current = new Practice(seed ?? opts.seed ?? (Date.now() & 0xffff), initial);
    pendingSettings.current = initial;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (opts.demo && typeof window !== "undefined") (window as any).__ccGame = () => gameRef.current; // for the screenshot scripts

  const bowl = useCallback(() => {
    const g = gameRef.current!;
    if (g.phase !== "result") return;
    if (g.ballInOver === 0 && overRef.current.length >= 6) overRef.current = [];
    g.nextBall(pendingSettings.current);
    demoRef.current = { shot: -1, t: 0 };
    setHud((h) => ({ ...h, started: true, result: null, phase: g.phase, path: [] }));
  }, []);

  const press = useCallback((bits: number) => {
    pressedRef.current |= bits & ~heldRef.current;
    heldRef.current |= bits;
  }, []);
  const release = useCallback((bits: number) => {
    heldRef.current &= ~bits;
  }, []);

  // keyboard
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest?.("input, select, textarea")) return;
      if (KEYS[e.code] !== undefined) {
        e.preventDefault();
        if (!e.repeat) press(KEYS[e.code]);
      } else if (e.code === "Space" || e.code === "Enter") {
        e.preventDefault();
        if (!e.repeat) bowl();
      } else if (e.code === "KeyP") setPaused((p) => !p);
    };
    const up = (e: KeyboardEvent) => {
      if (KEYS[e.code] !== undefined) release(KEYS[e.code]);
    };
    const blur = () => { heldRef.current = 0; };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, [bowl, press, release]);

  // the game loop: fixed ticks, drawn every animation frame
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let acc = 0;
    const ctx = canvasRef.current!.getContext("2d")!;
    const frame = (now: number) => {
      const g = gameRef.current!;
      acc += Math.min(250, now - last);
      last = now;
      let changed = false;
      if (!paused) {
        for (;;) {
          const step = g.phase === "live" ? LIVE_TICK_MS : TICK_MS;
          if (acc < step || g.phase === "result") break;
          acc -= step;
          const before = g.phase;
          // the machine's set-up runs SETUP_SPEED ticks per frame; the run-up and the ball run in real time
          const fast = !g.bowling; // your own set-up (bowl mode) runs in real time
          for (let i = 0; i === 0 || (fast && i < SETUP_SPEED && SETUP_PHASES.has(g.engine.phase.kind)); i++) {
            if (opts.demo) {
              const d = g.bowling ? demoBowlPad(g, demoRef.current) : demoPad(g, demoRef.current);
              pressedRef.current |= d & ~heldRef.current;
              heldRef.current = d;
            }
            g.tick({ held: heldRef.current, pressed: pressedRef.current });
            pressedRef.current = 0;
          }
          if (g.phase !== before) changed = true;
        }
        if (acc > LIVE_TICK_MS) acc = 0;
      } else acc = 0;
      const st = g.phase === "field" ? fieldLabel(g) : g.phase === "bowling" || g.phase === "live" ? stageLabel(g.engine.phase.kind, g.settings) : "";
      if (st !== stageRef.current) { stageRef.current = st; setStage(st); }
      if (changed) {
        if (g.result && resultAt.current === 0) {
          resultAt.current = now;
          overRef.current = [...overRef.current, g.result].slice(-8);
        }
        setHud((h) => ({ ...h, score: { ...g.score }, result: g.result, over: overRef.current, phase: g.phase, path: [...g.path] }));
      }
      if (g.phase === "result" && resultAt.current && autoNext && !paused && hudStarted.current && now - resultAt.current > AUTO_NEXT_MS) {
        resultAt.current = 0;
        bowl();
      }
      if (g.phase !== "result") resultAt.current = 0;
      drawScene(ctx, g.m, g.view(), SCALE, now);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [paused, autoNext, bowl]);

  const change = (patch: Partial<Settings>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    pendingSettings.current = next;
  };
  /** bat or bowl: a fresh session in the other mode, right away */
  const switchMode = (mode: Mode) => {
    if (mode === settings.mode) return;
    const next = { ...settings, mode };
    setSettings(next);
    pendingSettings.current = next;
    gameRef.current = new Practice(seed ?? opts.seed ?? (Date.now() & 0xffff), next);
    overRef.current = [];
    resultAt.current = 0;
    setHud({ score: emptyScore(), result: null, over: [], phase: "result", path: [], started: false });
  };
  const bowlMode = settings.mode === "bowl";

  const { score, result } = hud;
  const g = gameRef.current;
  const ballsLeft = 6 - g.ballInOver;

  return (
    <div className="cc-nets">
      <div className="cc-stage">
        <div className="cc-modes" role="tablist" aria-label="Practice mode">
          {(["bat", "bowl"] as Mode[]).map((md) => (
            <button key={md} role="tab" aria-selected={settings.mode === md} className={`cc-mode${settings.mode === md ? " on" : ""}`} onClick={() => switchMode(md)}>
              {md === "bat" ? "Bat" : "Bowl"}
              <span>{md === "bat" ? "against the bowling machine" : "to the computer batsman"}</span>
            </button>
          ))}
        </div>
        <div className="cc-board" aria-live="polite">
          <div className="cc-total">
            <span className="cc-runs">{score.runs}/{score.wickets}</span>
            <span className="cc-overs">{oversText(score.balls)} ov</span>
          </div>
          <ol className="cc-over" aria-label="This over">
            {hud.over.slice(-6).map((r, i) => (
              <li key={i} className={`cc-ball cc-ball--${r.outcome}`}>{ballMark(r)}</li>
            ))}
          </ol>
          <div className="cc-stats">
            <span>4s <b>{score.fours}</b></span>
            <span>6s <b>{score.sixes}</b></span>
            <span>Dots <b>{score.dots}</b></span>
            <span>Extras <b>{score.extras}</b></span>
          </div>
        </div>

        <div className="cc-screen">
          <canvas
            ref={canvasRef}
            width={SCREEN_W * SCALE}
            height={SCREEN_H * SCALE}
            className="cc-canvas"
            aria-label={bowlMode ? "Bowling view: you bowl to the computer batsman at the far end" : "Batting view: the bowling machine bowls to you from the far end"}
          />
          {!hud.started && (
            <div className="cc-overlay">
              {bowlMode ? (
                <>
                  <p className="cc-overlay-title">Bowling practice</p>
                  <p className="cc-overlay-text">Bowl to the original game's computer batsman: aim with the arrows, <kbd>Z</kbd> to fix it and stop the meter, tap <kbd>Z</kbd> as you run in. Then field it.</p>
                  <button className="cc-btn cc-btn--primary" onClick={bowl}>Bowl the first ball</button>
                  <p className="cc-overlay-hint"><kbd>Space</kbd> starts the next ball</p>
                </>
              ) : (
                <>
                  <p className="cc-overlay-title">Batting practice</p>
                  <p className="cc-overlay-text">The bowling machine bowls the way the original game's computer bowler does. Pick a direction and play your shot as the ball arrives.</p>
                  <button className="cc-btn cc-btn--primary" onClick={bowl}>Face the first ball</button>
                  <p className="cc-overlay-hint"><kbd>Space</kbd> bowls the next ball</p>
                </>
              )}
            </div>
          )}
          {result && (
            <div className={`cc-result cc-result--${result.outcome}`} role="status">
              <span className="cc-result-text">{result.text}</span>
              {hud.path.length > 1 && <FieldMap path={hud.path} />}
              <button className="cc-btn cc-btn--small" onClick={bowl}>Next ball</button>
            </div>
          )}
          {stage && hud.started && <div className="cc-stage-chip">{stage}</div>}
          {paused && <div className="cc-paused">Paused</div>}
        </div>

        <TouchPad press={press} release={release} bowling={bowlMode} />

        <div className="cc-actions">
          <button className="cc-btn" onClick={() => setPaused((p) => !p)}>{paused ? "Resume" : "Pause"}</button>
          <label className="cc-check">
            <input type="checkbox" checked={autoNext} onChange={(e) => setAutoNext(e.target.checked)} /> {bowlMode ? "Start the next ball automatically" : "Bowl the next ball automatically"}
          </label>
          <span className="cc-muted">{hud.started ? `${ballsLeft} ball${ballsLeft === 1 ? "" : "s"} left in the over` : ""}</span>
        </div>

        <section className="cc-panel cc-about">
          <h2>What's rebuilt so far</h2>
          <p className="cc-muted">
            Everything runs on logic rebuilt from the original game's code: how the bowler picks his line and
            length, the ball's swing, bounce and spin, your footwork, timing and where the ball goes off the bat, the
            keeper and slips, bowled, LBW, caught and wides; then, once the ball leaves the batting view, the
            fielders chasing, catching and throwing, running between the wickets, run outs and boundaries. It is
            checked tick by tick against recordings of the original.
          </p>
          <p className="cc-muted">
            When you bowl, it's the original's own bowling controls (aim, swing or spin, the meter, run-up
            pace) and its computer batsman, who picks his shot against the field the way the original does; then
            you field the ball yourself or leave it to the computer's fielders. It's the nets: the batsman
            stays on strike.
          </p>
        </section>
      </div>

      <aside className="cc-side">
        <section className="cc-panel">
          <h2>{bowlMode ? "Your bowler" : "Bowling machine"}</h2>
          <p className="cc-muted">Changes apply from the next ball.</p>
          <fieldset className="cc-seg">
            <legend>Bowler</legend>
            {(["fast", "swing", "spin"] as BowlerKind[]).map((k) => (
              <label key={k} className={settings.bowler === k ? "on" : ""}>
                <input type="radio" name="cc-bowler" checked={settings.bowler === k} onChange={() => change({ bowler: k })} />
                {k[0].toUpperCase() + k.slice(1)}
              </label>
            ))}
          </fieldset>
          <fieldset className="cc-seg">
            <legend>Bowling arm</legend>
            {[false, true].map((left) => (
              <label key={String(left)} className={settings.leftArm === left ? "on" : ""}>
                <input type="radio" name="cc-arm" checked={settings.leftArm === left} onChange={() => change({ leftArm: left })} />
                {left ? "Left" : "Right"}
              </label>
            ))}
          </fieldset>
          <label className="cc-range">
            <span>{bowlMode ? "Rating (aim speed)" : "Accuracy"} <b>{settings.accuracy}</b></span>
            <input type="range" min={0} max={99} value={settings.accuracy} onChange={(e) => change({ accuracy: Number(e.target.value) })} />
          </label>
          <fieldset className="cc-seg">
            <legend>Difficulty</legend>
            {(["Easy", "Normal", "Hard"] as const).map((name, i) => (
              <label key={name} className={settings.difficulty === i ? "on" : ""}>
                <input type="radio" name="cc-diff" checked={settings.difficulty === i} onChange={() => change({ difficulty: i as Settings["difficulty"] })} />
                {name}
              </label>
            ))}
          </fieldset>
          {bowlMode && (
            <label className="cc-check cc-check--panel">
              <input type="checkbox" checked={settings.humanField} onChange={(e) => change({ humanField: e.target.checked })} /> Field the ball yourself
            </label>
          )}
          {!bowlMode && <fieldset className="cc-seg">
            <legend>You bat</legend>
            {(["left", "right"] as const).map((h) => (
              <label key={h} className={settings.batsman === h ? "on" : ""}>
                <input type="radio" name="cc-bat" checked={settings.batsman === h} onChange={() => change({ batsman: h })} />
                {h === "left" ? "Left-handed" : "Right-handed"}
              </label>
            ))}
          </fieldset>}
        </section>

        <section className="cc-panel">
          <h2>Controls</h2>
          {bowlMode ? (
          <dl className="cc-keys">
            <div><dt><kbd>↑</kbd> <kbd>↓</kbd> <kbd>←</kbd> <kbd>→</kbd></dt><dd>Move the aim marker (line and length)</dd></div>
            <div><dt><kbd>Z</kbd></dt><dd>Fix the marker; then stop the meter</dd></div>
            <div><dt><kbd>←</kbd> <kbd>→</kbd></dt><dd>Swing or spin bowlers: which way it moves (then <kbd>Z</kbd>)</dd></div>
            <div><dt><kbd>Z</kbd> <kbd>Z</kbd> <kbd>Z</kbd></dt><dd>Tap during the run-up for pace</dd></div>
            <div><dt><kbd>↑</kbd> <kbd>↓</kbd> <kbd>←</kbd> <kbd>→</kbd></dt><dd>Fielding yourself: run (diagonals too); he catches and picks up by himself</dd></div>
            <div><dt><kbd>Z</kbd> / <kbd>X</kbd></dt><dd>With the ball: throw to the keeper's end / the bowler's end</dd></div>
            <div><dt><kbd>C</kbd></dt><dd>Before anyone has the ball: switch fielder</dd></div>
            <div><dt><kbd>Space</kbd></dt><dd>Next ball</dd></div>
            <div><dt><kbd>P</kbd></dt><dd>Pause</dd></div>
          </dl>
          ) : (
          <dl className="cc-keys">
            <div><dt><kbd>←</kbd> <kbd>→</kbd></dt><dd>Move across the crease before the ball is bowled</dd></div>
            <div><dt><kbd>↑</kbd> <kbd>↓</kbd> <kbd>←</kbd> <kbd>→</kbd></dt><dd>Shot direction (diagonals too): up drives, down plays back, sideways cuts and pulls</dd></div>
            <div><dt><kbd>Z</kbd></dt><dd>With a direction: keep the shot along the ground</dd></div>
            <div><dt><kbd>X</kbd></dt><dd>With a direction: loft it</dd></div>
            <div><dt><kbd>Z</kbd></dt><dd>After the shot: run (and again to turn back for the next run)</dd></div>
            <div><dt><kbd>Space</kbd></dt><dd>Next ball</dd></div>
            <div><dt><kbd>P</kbd></dt><dd>Pause</dd></div>
          </dl>
          )}
        </section>
      </aside>
    </div>
  );
}

function stageLabel(kind: string, s: Settings): string {
  if (s.mode === "bowl") {
    if (kind === "preaim") return "Get ready";
    if (kind === "aim") return "Aim: arrows move the marker · Z fixes it";
    if (kind === "settle") return "Marker set";
    if (kind === "swing") return s.bowler === "spin" ? "Spin: ← or → · Z to go on" : "Swing: ← in · → out · Z to go on";
    if (kind.startsWith("meter") || kind === "meterWait") return "Z stops the meter";
    if (kind === "paceWait" || kind === "runup") return "Running in: tap Z for pace";
    return "";
  }
  if (kind === "preaim" || kind === "aim" || kind === "settle") return "The machine picks its line and length";
  if (kind === "swing") return "Setting swing or spin";
  if (kind.startsWith("meter") || kind === "paceWait") return "Setting the pace";
  if (kind === "runup") return "Running in";
  return "";
}

function fieldLabel(g: Practice): string {
  if (!g.bowling) return "Z: run · Z again: turn back";
  const m = g.m;
  if (m.rw(0x8602) === 0) return g.settings.humanField ? "The fielders take it from here" : "The fielders chase it down";
  if (m.rb(0xfd0e) !== 0) return "Throw: Z to the keeper · X to the bowler";
  return "Arrows: run to the ball · C: switch fielder";
}

function emptyScore(): Score {
  return { runs: 0, balls: 0, wickets: 0, fours: 0, sixes: 0, dots: 0, extras: 0 };
}

function ballMark(r: BallResult): string {
  switch (r.outcome) {
    case "wide": return "wd";
    case "bowled": case "lbw": case "caught": case "runout": return "W";
    case "dot": return "•";
    default: return String(r.runs);
  }
}

/** where the ball went, from above: batsman's end at the top */
function FieldMap({ path }: { path: [number, number][] }) {
  const R = BOUNDARY + 300;
  const end = path[path.length - 1];
  return (
    <svg className="cc-map" viewBox={`${-R} ${-R} ${2 * R} ${2 * R}`} aria-label="Where the ball went">
      <circle cx={0} cy={0} r={BOUNDARY} className="cc-map-ground" />
      <rect x={-0xb0} y={-0x4c0} width={0x160} height={0x980} className="cc-map-pitch" />
      <path d={fieldMapPath(path)} className="cc-map-path" />
      <circle cx={end[0]} cy={-end[1]} r={180} className="cc-map-ball" />
    </svg>
  );
}

/** on-screen pad for touch screens */
function TouchPad({ press, release, bowling }: { press: (b: number) => void; release: (b: number) => void; bowling: boolean }) {
  const btn = (label: string, bits: number, cls = "") => (
    <button
      key={label}
      className={`cc-pad-btn ${cls}`}
      aria-label={label}
      onPointerDown={(e) => { e.preventDefault(); (e.target as HTMLElement).setPointerCapture?.(e.pointerId); press(bits); }}
      onPointerUp={() => release(bits)}
      onPointerCancel={() => release(bits)}
      onContextMenu={(e) => e.preventDefault()}
    >
      {label.length <= 2 ? label : ""}
    </button>
  );
  return (
    <div className="cc-touch" aria-label="On-screen controls">
      <div className="cc-dpad">
        {btn("↖", PAD.U | PAD.L)}{btn("↑", PAD.U)}{btn("↗", PAD.U | PAD.R)}
        {btn("←", PAD.L)}<span />{btn("→", PAD.R)}
        {btn("↙", PAD.D | PAD.L)}{btn("↓", PAD.D)}{btn("↘", PAD.D | PAD.R)}
      </div>
      <div className="cc-shotbtns">
        {([[PAD.A, bowling ? "A" : "Ground"], [PAD.B, bowling ? "B" : "Loft"], ...(bowling ? [[PAD.C, "C"]] : [])] as [number, string][]).map(([bits, label]) => (
          <button key={label} className="cc-pad-btn cc-pad-btn--wide" onPointerDown={(e) => { e.preventDefault(); press(bits); }} onPointerUp={() => release(bits)} onPointerCancel={() => release(bits)}>{label}</button>
        ))}
      </div>
    </div>
  );
}
