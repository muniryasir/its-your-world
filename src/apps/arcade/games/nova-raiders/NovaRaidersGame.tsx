import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import { finishRun, startRun } from "wasp/client/operations";
import type { RunResult } from "../../operations";
import { formatDuration, formatScore } from "../../format";
import {
  DIFFICULTIES,
  DIFFICULTY_NAMES,
  ENEMY_TYPES,
  InputRecorder,
  LEVELS,
  NovaRaiders,
  TICKS_PER_SECOND,
  WAVES_PER_LEVEL,
  type Difficulty,
  type EnemyType,
  type GameEvent,
  type Input,
  type OverReason,
} from "./engine";
import { CANVAS_HEIGHT, CANVAS_WIDTH, NovaRenderer } from "./render";
import "./nova-raiders.css";

const STEP_MS = 1000 / TICKS_PER_SECOND;
const MAX_STEPS_PER_FRAME = 8;
const DIFFICULTY_KEY = "nova-raiders:difficulty";

type Hud = { score: number; level: number; wave: number; lives: number };
type Phase =
  | { name: "idle" }
  | { name: "starting" }
  | { name: "countdown"; count: number }
  | { name: "playing" }
  | { name: "paused" }
  | { name: "saving"; won: boolean }
  | { name: "result"; result: RunResult; reason: OverReason }
  | { name: "error"; message: string };

type Control = "left" | "right" | "up" | "down" | "fire";
const CONTROL_INPUTS: Record<Control, [Input, Input]> = {
  left: ["leftDown", "leftUp"],
  right: ["rightDown", "rightUp"],
  up: ["upDown", "upUp"],
  down: ["downDown", "downUp"],
  fire: ["fireDown", "fireUp"],
};
const KEYS: Record<string, Control> = {
  ArrowLeft: "left",
  KeyA: "left",
  ArrowRight: "right",
  KeyD: "right",
  ArrowUp: "up",
  KeyW: "up",
  ArrowDown: "down",
  KeyS: "down",
  Space: "fire",
  KeyJ: "fire",
  KeyX: "fire",
};

/**
 * Runs one game: fixed 60 ticks per second, every input recorded with the
 * tick it happened on, exactly as the server will replay it.
 */
class Controller {
  readonly game: NovaRaiders;
  readonly recorder: InputRecorder;
  private held = new Set<Control>();
  private raf = 0;
  private last = 0;
  private acc = 0;
  running = false;
  /** Events since the last frame callback (for banners). */
  events: GameEvent[] = [];

  constructor(
    seed: number,
    difficulty: Difficulty,
    private renderer: NovaRenderer,
    private onFrame: (game: NovaRaiders) => void,
    private onOver: (game: NovaRaiders) => void,
  ) {
    this.game = new NovaRaiders(seed, difficulty);
    this.recorder = new InputRecorder(difficulty);
  }

  private send(input: Input) {
    if (this.game.over) return;
    this.recorder.record(this.game.tick, input);
    this.game.input(input);
  }

  press(control: Control) {
    if (!this.running || this.held.has(control)) return;
    this.held.add(control);
    this.send(CONTROL_INPUTS[control][0]);
  }

  release(control: Control) {
    if (!this.held.has(control)) return;
    this.held.delete(control);
    if (this.running) this.send(CONTROL_INPUTS[control][1]);
  }

  /** Sets the four direction keys at once (used by the touch pad). */
  steer(dirs: Record<"left" | "right" | "up" | "down", boolean>) {
    for (const d of ["left", "right", "up", "down"] as const) {
      if (dirs[d]) this.press(d);
      else this.release(d);
    }
  }

  start() {
    if (this.running || this.game.over) return;
    this.running = true;
    this.last = performance.now();
    this.acc = 0;
    this.raf = requestAnimationFrame(this.frame);
  }

  /** Stops the clock. Held keys are let go so nothing stays pressed on resume. */
  pause() {
    if (!this.running) return;
    for (const control of [...this.held]) this.release(control);
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  /** The player ends the run early. */
  end() {
    this.send("end");
    this.flushEvents();
    if (this.game.over) this.finish();
  }

  destroy() {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  private frame = (now: number) => {
    if (!this.running) return;
    this.acc += Math.min(now - this.last, 250);
    this.last = now;
    let steps = 0;
    while (this.acc >= STEP_MS && steps < MAX_STEPS_PER_FRAME && !this.game.over) {
      this.game.step();
      this.acc -= STEP_MS;
      steps++;
    }
    if (steps === MAX_STEPS_PER_FRAME) this.acc = 0; // fell behind: slow down rather than skip
    if (this.recorder.nearlyFull && !this.game.over) this.send("end");
    this.flushEvents();
    this.renderer.draw(this.game);
    this.onFrame(this.game);
    if (this.game.over) this.finish();
    else this.raf = requestAnimationFrame(this.frame);
  };

  private flushEvents() {
    this.renderer.addEvents(this.game.events);
    this.events.push(...this.game.events);
    this.game.events = [];
  }

  private finish() {
    if (!this.running) return;
    this.running = false;
    cancelAnimationFrame(this.raf);
    // The log always ends with "end" at the tick where the game stopped.
    if (this.game.overReason !== "ended") this.recorder.record(this.game.tick, "end");
    this.renderer.draw(this.game, false);
    this.onOver(this.game);
  }
}

const END_REASONS: Record<OverReason, string> = {
  won: `All ${LEVELS} levels cleared!`,
  lost: "Your last ship went down.",
  time: "Time's up: a run lasts at most one hour.",
  ended: "You ended the run.",
};

function loadDifficulty(): Difficulty {
  try {
    const v = window.localStorage.getItem(DIFFICULTY_KEY);
    if (v === "easy" || v === "normal" || v === "hard") return v;
  } catch {
    // storage blocked: use the default
  }
  return "normal";
}

function saveDifficulty(d: Difficulty) {
  try {
    window.localStorage.setItem(DIFFICULTY_KEY, d);
  } catch {
    // not important
  }
}

export function NovaRaidersGame({ gameId, canPlay }: { gameId: string; canPlay: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const screenRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<NovaRenderer | null>(null);
  const controllerRef = useRef<Controller | null>(null);
  const runRef = useRef<number | null>(null);
  const idleRaf = useRef(0);
  const [phase, setPhase] = useState<Phase>({ name: "idle" });
  const [difficulty, setDifficulty] = useState<Difficulty>("normal");
  const [hud, setHud] = useState<Hud>({ score: 0, level: 1, wave: 0, lives: 3 });
  const [banner, setBanner] = useState<{ text: string; sub?: string; id: number } | null>(null);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const difficultyRef = useRef(difficulty);
  difficultyRef.current = difficulty;
  const aliveRef = useRef(true);

  useEffect(() => setDifficulty(loadDifficulty()), []);

  // Size the screen to its container and keep the starfield moving when no game runs.
  useEffect(() => {
    const renderer = new NovaRenderer(canvasRef.current!);
    rendererRef.current = renderer;
    const fit = () => {
      const width = (screenRef.current?.parentElement?.clientWidth ?? CANVAS_WIDTH * 2) - 24;
      const height = Math.max(320, window.innerHeight - 190);
      let scale = Math.min(width / CANVAS_WIDTH, height / CANVAS_HEIGHT, 4);
      // Whole-number scales keep every pixel the same size.
      scale = scale >= 2 ? Math.floor(scale) : Math.max(1, Math.floor(scale * 4) / 4);
      renderer.resize(scale);
    };
    fit();
    const ro = new ResizeObserver(fit);
    if (screenRef.current?.parentElement) ro.observe(screenRef.current.parentElement);
    window.addEventListener("resize", fit);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const idle = () => {
      // While a run is going, the controller draws every frame itself.
      const c = controllerRef.current;
      if (!c) renderer.draw(null, !reduce);
      else if (!c.running) renderer.draw(c.game, !reduce && c.game.over);
      idleRaf.current = requestAnimationFrame(idle);
    };
    idleRaf.current = requestAnimationFrame(idle);
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      cancelAnimationFrame(idleRaf.current);
      ro.disconnect();
      window.removeEventListener("resize", fit);
      controllerRef.current?.destroy();
    };
  }, []);

  const onFrame = useCallback((game: NovaRaiders) => {
    setHud((h) =>
      h.score === game.score && h.level === game.level && h.wave === game.wave && h.lives === game.lives
        ? h
        : { score: game.score, level: game.level, wave: game.wave, lives: game.lives },
    );
    const c = controllerRef.current;
    if (!c || c.events.length === 0) return;
    for (const e of c.events) {
      if (e.type === "level") {
        setBanner({ text: `Level ${e.level}`, sub: `New: ${ENEMY_TYPES[e.level as EnemyType].name}`, id: Date.now() });
      } else if (e.type === "wave" && e.wave > 1) {
        setBanner({ text: `Wave ${e.wave}/${WAVES_PER_LEVEL}`, id: Date.now() });
      } else if (e.type === "levelClear") {
        setBanner({ text: "Level clear", sub: `+${formatScore(e.bonus)}`, id: Date.now() });
      } else if (e.type === "extraLife") {
        setBanner({ text: "Extra ship!", id: Date.now() });
      } else if (e.type === "victory") {
        setBanner({ text: "Victory!", sub: `Ship bonus +${formatScore(e.bonus)}`, id: Date.now() });
      }
    }
    c.events = [];
  }, []);

  const onOver = useCallback(async (game: NovaRaiders) => {
    const runId = runRef.current;
    const c = controllerRef.current;
    if (runId === null || !c || !aliveRef.current) return;
    setBanner(null);
    setPhase({ name: "saving", won: game.overReason === "won" });
    try {
      const result = await finishRun({ runId, log: c.recorder.toString() });
      setPhase({ name: "result", result, reason: game.overReason ?? "ended" });
    } catch (e: any) {
      setPhase({ name: "error", message: e?.message ?? "Couldn't save the run." });
    }
  }, []);

  const begin = useCallback(async () => {
    const p = phaseRef.current.name;
    if (!canPlay || (p !== "idle" && p !== "result" && p !== "error")) return;
    const chosen = difficultyRef.current;
    saveDifficulty(chosen);
    setPhase({ name: "starting" });
    try {
      const { runId, seed } = await startRun({ gameId });
      controllerRef.current?.destroy();
      runRef.current = runId;
      rendererRef.current!.clearEffects();
      const controller = new Controller(seed, chosen, rendererRef.current!, onFrame, onOver);
      controllerRef.current = controller;
      setHud({ score: 0, level: 1, wave: 0, lives: controller.game.lives });
      setBanner(null);
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      rootRef.current?.scrollIntoView({ block: "nearest", behavior: reduce ? "auto" : "smooth" });
      for (const count of [3, 2, 1]) {
        setPhase({ name: "countdown", count });
        await new Promise((r) => setTimeout(r, 550));
        if (!aliveRef.current || controllerRef.current !== controller) return; // left the page or restarted
      }
      setPhase({ name: "playing" });
      controller.start();
      canvasRef.current?.focus();
    } catch (e: any) {
      setPhase({ name: "error", message: e?.message ?? "Couldn't start a run." });
    }
  }, [canPlay, gameId, onFrame, onOver]);

  const pause = useCallback(() => {
    if (phaseRef.current.name !== "playing") return;
    controllerRef.current?.pause();
    setPhase({ name: "paused" });
  }, []);

  const resume = useCallback(() => {
    if (phaseRef.current.name !== "paused") return;
    setPhase({ name: "playing" });
    controllerRef.current?.start();
  }, []);

  const endRun = useCallback(() => {
    const p = phaseRef.current.name;
    if (p !== "playing" && p !== "paused") return;
    const c = controllerRef.current!;
    if (p === "paused") c.start(); // the end is recorded at the current tick
    c.end();
  }, []);

  const toMenu = useCallback(() => {
    const p = phaseRef.current.name;
    if (p !== "result" && p !== "error") return;
    controllerRef.current?.destroy();
    controllerRef.current = null;
    rendererRef.current?.clearEffects();
    setHud({ score: 0, level: 1, wave: 0, lives: 3 });
    setPhase({ name: "idle" });
  }, []);

  // Keyboard
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
      const p = phaseRef.current.name;
      if (p === "idle" && (e.code === "Digit1" || e.code === "Digit2" || e.code === "Digit3")) {
        setDifficulty(DIFFICULTIES[Number(e.code.slice(-1)) - 1]);
        return;
      }
      if (e.code === "Enter" || e.code === "NumpadEnter") {
        if (p === "paused") { e.preventDefault(); resume(); }
        else if (p === "idle" || p === "result" || p === "error") {
          if (target?.tagName === "BUTTON" || target?.tagName === "A") return;
          e.preventDefault();
          void begin();
        }
        return;
      }
      if (e.code === "KeyP" || e.code === "Escape") {
        if (p === "playing") { e.preventDefault(); pause(); }
        else if (p === "paused" && e.code === "KeyP") { e.preventDefault(); resume(); }
        return;
      }
      const control = KEYS[e.code];
      if (!control || p !== "playing") return;
      e.preventDefault();
      if (e.repeat) return;
      controllerRef.current?.press(control);
    };
    const up = (e: KeyboardEvent) => {
      const control = KEYS[e.code];
      if (control) controllerRef.current?.release(control);
    };
    const hide = () => { if (document.hidden) pause(); };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", pause);
    document.addEventListener("visibilitychange", hide);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", pause);
      document.removeEventListener("visibilitychange", hide);
    };
  }, [begin, pause, resume]);

  const playing = phase.name === "playing";
  const inRun = playing || phase.name === "paused";

  return (
    <div className="nr" ref={rootRef}>
      <div className="nr-screen" ref={screenRef}>
        <canvas
          ref={canvasRef}
          className="nr-canvas"
          tabIndex={-1}
          role="img"
          aria-label={`Nova Raiders. Score ${hud.score}, level ${hud.level} of ${LEVELS}, ${hud.lives} ships left.`}
        />
        <div className="nr-crt" aria-hidden="true" />
        <span className="nr-sr" data-testid="nr-score">{hud.score}</span>
        {banner && (playing || phase.name === "saving") && (
          <div key={banner.id} className="nr-banner" onAnimationEnd={() => setBanner(null)} aria-hidden="true">
            <span>{banner.text}</span>
            {banner.sub && <small>{banner.sub}</small>}
          </div>
        )}
        <Overlay
          phase={phase}
          canPlay={canPlay}
          difficulty={difficulty}
          onDifficulty={setDifficulty}
          onStart={begin}
          onResume={resume}
          onEnd={endRun}
          onMenu={toMenu}
        />
      </div>

      <div className="nr-bar">
        <span className="nr-chip">{DIFFICULTY_NAMES[controllerRef.current?.game.difficulty ?? difficulty]}</span>
        {inRun && (
          <span className="nr-bar-actions">
            {playing ? (
              <button className="btn btn--ghost btn--sm" onClick={pause}>Pause</button>
            ) : (
              <button className="btn btn--ghost btn--sm" onClick={resume}>Resume</button>
            )}
            <button className="btn btn--ghost btn--sm" onClick={endRun}>End run</button>
          </span>
        )}
      </div>

      <TouchControls controller={controllerRef} active={playing} onPause={pause} />
    </div>
  );
}

function Overlay({
  phase,
  canPlay,
  difficulty,
  onDifficulty,
  onStart,
  onResume,
  onEnd,
  onMenu,
}: {
  phase: Phase;
  canPlay: boolean;
  difficulty: Difficulty;
  onDifficulty: (d: Difficulty) => void;
  onStart: () => void;
  onResume: () => void;
  onEnd: () => void;
  onMenu: () => void;
}) {
  switch (phase.name) {
    case "playing":
      return null;
    case "idle":
      return (
        <div className="nr-overlay">
          <p className="nr-title">Nova<br />Raiders</p>
          {canPlay ? (
            <>
              <div className="nr-diff" role="radiogroup" aria-label="Difficulty">
                {DIFFICULTIES.map((d, i) => (
                  <button
                    key={d}
                    role="radio"
                    aria-checked={difficulty === d}
                    className={difficulty === d ? "nr-diff-btn nr-diff-btn--on" : "nr-diff-btn"}
                    onClick={() => onDifficulty(d)}
                  >
                    <span className="nr-diff-key">{i + 1}</span>
                    {DIFFICULTY_NAMES[d]}
                  </button>
                ))}
              </div>
              <button className="btn btn--primary btn--lg" onClick={onStart} autoFocus>Start</button>
              <p className="nr-hint">{LEVELS} levels · 3 ships · press Enter</p>
            </>
          ) : (
            <p className="nr-hint">Add Nova Raiders to your arcade to play.</p>
          )}
        </div>
      );
    case "starting":
      return <div className="nr-overlay"><p className="nr-hint">Opening a run…</p></div>;
    case "countdown":
      return (
        <div className="nr-overlay nr-overlay--clear">
          <p key={phase.count} className="nr-count" aria-live="assertive">{phase.count}</p>
        </div>
      );
    case "paused":
      return (
        <div className="nr-overlay">
          <p className="nr-title nr-title--sm">Paused</p>
          <button className="btn btn--primary btn--lg" onClick={onResume} autoFocus>Resume</button>
          <button className="btn btn--ghost" onClick={onEnd}>End run</button>
        </div>
      );
    case "saving":
      return (
        <div className="nr-overlay nr-overlay--soft" aria-live="polite">
          <p className="nr-title nr-title--sm">{phase.won ? "Victory!" : "Game over"}</p>
          <p className="nr-hint">Checking your run on the server…</p>
        </div>
      );
    case "result": {
      const { result, reason } = phase;
      const s = result.stats;
      const fired = Number(s.shotsFired ?? 0);
      const accuracy = fired > 0 ? Math.round((Number(s.shotsHit ?? 0) * 100) / fired) : 0;
      return (
        <div className="nr-overlay" aria-live="polite">
          <p className={reason === "won" ? "nr-title nr-title--sm nr-title--win" : "nr-title nr-title--sm"}>
            {reason === "won" ? "Victory!" : "Game over"}
          </p>
          <p className="nr-hint">{END_REASONS[reason]}</p>
          <p className="nr-final" data-testid="nr-final">{formatScore(result.score)}</p>
          {result.newBest && result.score > 0 && <p className="nr-newbest">New best!</p>}
          <dl className="nr-result">
            <div><dt>Level</dt><dd>{String(s.level ?? 1)}/{LEVELS}</dd></div>
            <div><dt>Mode</dt><dd>{DIFFICULTY_NAMES[(s.difficulty as Difficulty) ?? "normal"] ?? "–"}</dd></div>
            <div><dt>Kills</dt><dd>{String(s.kills ?? 0)}</dd></div>
            <div><dt>Accuracy</dt><dd>{accuracy}%</dd></div>
            <div><dt>Time</dt><dd>{formatDuration(result.durationMs)}</dd></div>
          </dl>
          <div className="nr-actions">
            <button className="btn btn--primary btn--lg" onClick={onStart} autoFocus>Play again</button>
            <button className="btn btn--ghost btn--sm" onClick={onMenu}>Change difficulty</button>
          </div>
          <p className="nr-verified">✓ Score verified by replay</p>
        </div>
      );
    }
    case "error":
      return (
        <div className="nr-overlay" role="alert">
          <p className="nr-title nr-title--sm">Something went wrong</p>
          <p className="nr-hint">{phase.message}</p>
          {canPlay && <button className="btn btn--primary" onClick={onStart}>Try again</button>}
          {canPlay && <button className="btn btn--ghost btn--sm" onClick={onMenu}>Back</button>}
        </div>
      );
  }
}

/**
 * On-screen controls for phones and tablets: a pad that steers in eight
 * directions while a finger rests on it, and a fire button to hold.
 */
function TouchControls({
  controller,
  active,
  onPause,
}: {
  controller: RefObject<Controller | null>;
  active: boolean;
  onPause: () => void;
}) {
  const [dir, setDir] = useState({ left: false, right: false, up: false, down: false });
  const [firing, setFiring] = useState(false);

  const steerFrom = (e: ReactPointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const dx = e.clientX - (r.left + r.width / 2);
    const dy = e.clientY - (r.top + r.height / 2);
    const dead = r.width * 0.14;
    const next = {
      left: dx < -dead && Math.abs(dx) > Math.abs(dy) * 0.45,
      right: dx > dead && Math.abs(dx) > Math.abs(dy) * 0.45,
      up: dy < -dead && Math.abs(dy) > Math.abs(dx) * 0.45,
      down: dy > dead && Math.abs(dy) > Math.abs(dx) * 0.45,
    };
    setDir(next);
    controller.current?.steer(next);
  };
  const stop = () => {
    const none = { left: false, right: false, up: false, down: false };
    setDir(none);
    controller.current?.steer(none);
  };
  const fireOn = (e: ReactPointerEvent) => {
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    setFiring(true);
    controller.current?.press("fire");
  };
  const fireOff = () => {
    setFiring(false);
    controller.current?.release("fire");
  };
  const noMenu = (e: ReactMouseEvent) => e.preventDefault();

  return (
    <div className={active ? "nr-touch" : "nr-touch nr-touch--idle"} aria-label="Touch controls">
      <div
        className="nr-pad"
        aria-label="Steering pad"
        onPointerDown={(e) => {
          e.preventDefault();
          e.currentTarget.setPointerCapture?.(e.pointerId);
          steerFrom(e);
        }}
        onPointerMove={(e) => {
          if (e.buttons || e.pointerType === "touch") steerFrom(e);
        }}
        onPointerUp={stop}
        onPointerCancel={stop}
        onLostPointerCapture={stop}
        onContextMenu={noMenu}
      >
        <span className={dir.up ? "nr-pad-arrow nr-pad-up on" : "nr-pad-arrow nr-pad-up"}>▲</span>
        <span className={dir.left ? "nr-pad-arrow nr-pad-left on" : "nr-pad-arrow nr-pad-left"}>◀</span>
        <span className={dir.right ? "nr-pad-arrow nr-pad-right on" : "nr-pad-arrow nr-pad-right"}>▶</span>
        <span className={dir.down ? "nr-pad-arrow nr-pad-down on" : "nr-pad-arrow nr-pad-down"}>▼</span>
      </div>
      <button className="nr-key nr-key--small" aria-label="Pause" onClick={onPause}>❚❚</button>
      <button
        className={firing ? "nr-key nr-key--fire on" : "nr-key nr-key--fire"}
        aria-label="Fire"
        onPointerDown={fireOn}
        onPointerUp={fireOff}
        onPointerCancel={fireOff}
        onLostPointerCapture={fireOff}
        onContextMenu={noMenu}
      >
        Fire
      </button>
    </div>
  );
}
