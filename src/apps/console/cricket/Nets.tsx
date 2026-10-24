// Batting practice: the canvas, the scoreboard, the bowling-machine settings and the controls.
// No Wasp imports here, so the game can also be mounted on its own (tools/harness).
import { useCallback, useEffect, useRef, useState } from "react";
import { Practice, PAD, DEFAULT_SETTINGS, BOUNDARY, oversText } from "./engine/practice";
import type { Settings, BallResult, Score, BowlerKind } from "./engine/practice";
import { drawScene, fieldMapPath, SCREEN_W, SCREEN_H } from "./render";

/** the original's game logic runs about 42 times a second in the batting view (PAL, with lag frames) */
const TICK_MS = 1000 / 42;
const SCALE = 3;
const AUTO_NEXT_MS = 2600;
/** the machine's set-up (aim, meters) runs this many ticks per tick time: same logic, less waiting */
const SETUP_SPEED = 4;
const SETUP_PHASES = new Set(["preaim", "aim", "settle", "swing", "meterWait", "meterA", "meterB", "meterC", "paceWait"]);

const KEYS: Record<string, number> = {
  ArrowUp: PAD.U, ArrowDown: PAD.D, ArrowLeft: PAD.L, ArrowRight: PAD.R,
  KeyZ: PAD.A, KeyX: PAD.B,
};

interface Hud {
  score: Score;
  result: BallResult | null;
  over: BallResult[];
  phase: Practice["phase"];
  path: [number, number][];
  started: boolean;
}

export function Nets({ seed }: { seed?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameRef = useRef<Practice | null>(null);
  const heldRef = useRef(0); // keyboard and touch buttons down now
  const pressedRef = useRef(0); // went down since the last tick
  const pendingSettings = useRef<Settings>(DEFAULT_SETTINGS);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [paused, setPaused] = useState(false);
  const [autoNext, setAutoNext] = useState(true);
  const [hud, setHud] = useState<Hud>({ score: emptyScore(), result: null, over: [], phase: "result", path: [], started: false });
  const overRef = useRef<BallResult[]>([]);
  const resultAt = useRef(0);
  const [stage, setStage] = useState("");
  const stageRef = useRef("");
  const hudStarted = useRef(false);
  hudStarted.current = hud.started;

  if (!gameRef.current) gameRef.current = new Practice(seed ?? (Date.now() & 0xffff), DEFAULT_SETTINGS);

  const bowl = useCallback(() => {
    const g = gameRef.current!;
    if (g.phase !== "result") return;
    if (g.ballInOver === 0 && overRef.current.length >= 6) overRef.current = [];
    g.nextBall(pendingSettings.current);
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
        while (acc >= TICK_MS) {
          acc -= TICK_MS;
          if (g.phase === "result") break;
          const before = g.phase;
          const n = SETUP_PHASES.has(g.engine.phase.kind) ? SETUP_SPEED : 1;
          for (let i = 0; i < n && g.phase === before; i++) {
            g.tick({ held: heldRef.current, pressed: pressedRef.current });
            pressedRef.current = 0;
          }
          if (g.phase !== before) changed = true;
          if (g.phase === "flight" || before === "flight") changed = true;
        }
        if (acc > TICK_MS) acc = 0;
      } else acc = 0;
      const st = g.phase === "bowling" || g.phase === "live" ? stageLabel(g.engine.phase.kind) : "";
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

  const { score, result } = hud;
  const g = gameRef.current;
  const ballsLeft = 6 - g.ballInOver;

  return (
    <div className="cc-nets">
      <div className="cc-stage">
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
            aria-label="Batting view: the bowling machine bowls to you from the far end"
          />
          {!hud.started && (
            <div className="cc-overlay">
              <p className="cc-overlay-title">Batting practice</p>
              <p className="cc-overlay-text">The bowling machine bowls the way the original game's computer bowler does. Pick a direction and play your shot as the ball arrives.</p>
              <button className="cc-btn cc-btn--primary" onClick={bowl}>Face the first ball</button>
              <p className="cc-overlay-hint"><kbd>Space</kbd> bowls the next ball</p>
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

        <TouchPad press={press} release={release} />

        <div className="cc-actions">
          <button className="cc-btn" onClick={() => setPaused((p) => !p)}>{paused ? "Resume" : "Pause"}</button>
          <label className="cc-check">
            <input type="checkbox" checked={autoNext} onChange={(e) => setAutoNext(e.target.checked)} /> Bowl the next ball automatically
          </label>
          <span className="cc-muted">{hud.started ? `${ballsLeft} ball${ballsLeft === 1 ? "" : "s"} left in the over` : ""}</span>
        </div>
      </div>

      <aside className="cc-side">
        <section className="cc-panel">
          <h2>Bowling machine</h2>
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
            <span>Accuracy <b>{settings.accuracy}</b></span>
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
          <fieldset className="cc-seg">
            <legend>You bat</legend>
            {(["left", "right"] as const).map((h) => (
              <label key={h} className={settings.batsman === h ? "on" : ""}>
                <input type="radio" name="cc-bat" checked={settings.batsman === h} onChange={() => change({ batsman: h })} />
                {h === "left" ? "Left-handed" : "Right-handed"}
              </label>
            ))}
          </fieldset>
        </section>

        <section className="cc-panel">
          <h2>Controls</h2>
          <dl className="cc-keys">
            <div><dt><kbd>←</kbd> <kbd>→</kbd></dt><dd>Move across the crease before the ball is bowled</dd></div>
            <div><dt><kbd>↑</kbd> <kbd>↓</kbd> <kbd>←</kbd> <kbd>→</kbd></dt><dd>Shot direction (diagonals too): up drives, down plays back, sideways cuts and pulls</dd></div>
            <div><dt><kbd>Z</kbd></dt><dd>With a direction: keep the shot along the ground</dd></div>
            <div><dt><kbd>X</kbd></dt><dd>With a direction: loft it</dd></div>
            <div><dt><kbd>Space</kbd></dt><dd>Next ball</dd></div>
            <div><dt><kbd>P</kbd></dt><dd>Pause</dd></div>
          </dl>
          <p className="cc-small">
            Everything up to the end of the delivery runs on logic rebuilt from the original game.
            Fielding and running between the wickets come later: for now a hit that stops inside the
            rope scores 0–3 by distance, and one that reaches it scores four, or six on the full.
          </p>
        </section>
      </aside>
    </div>
  );
}

function stageLabel(kind: string): string {
  if (kind === "preaim" || kind === "aim" || kind === "settle") return "The machine picks its line and length";
  if (kind === "swing") return "Setting swing or spin";
  if (kind.startsWith("meter") || kind === "paceWait") return "Setting the pace";
  if (kind === "runup") return "Running in";
  return "";
}

function emptyScore(): Score {
  return { runs: 0, balls: 0, wickets: 0, fours: 0, sixes: 0, dots: 0, extras: 0 };
}

function ballMark(r: BallResult): string {
  switch (r.outcome) {
    case "wide": return "wd";
    case "bowled": case "lbw": case "caught": return "W";
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
function TouchPad({ press, release }: { press: (b: number) => void; release: (b: number) => void }) {
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
        <button className="cc-pad-btn cc-pad-btn--wide" onPointerDown={(e) => { e.preventDefault(); press(PAD.A); }} onPointerUp={() => release(PAD.A)} onPointerCancel={() => release(PAD.A)}>Ground</button>
        <button className="cc-pad-btn cc-pad-btn--wide" onPointerDown={(e) => { e.preventDefault(); press(PAD.B); }} onPointerUp={() => release(PAD.B)} onPointerCancel={() => release(PAD.B)}>Loft</button>
      </div>
    </div>
  );
}
