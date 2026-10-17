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
import { COLS, InputRecorder, ROWS, Starfall, TICKS_PER_SECOND, type Input } from "./engine";
import { StarfallRenderer } from "./render";

const STEP_MS = 1000 / TICKS_PER_SECOND;
const MAX_STEPS_PER_FRAME = 8;

type Hud = { score: number; level: number; lines: number };
type Phase =
  | { name: "idle" }
  | { name: "starting" }
  | { name: "countdown"; count: number }
  | { name: "playing" }
  | { name: "paused" }
  | { name: "saving"; score: number }
  | { name: "result"; result: RunResult; reason: string }
  | { name: "error"; message: string };

// Held keys send a "down" and an "up"; the rest act once when pressed.
const HELD: Record<string, [Input, Input]> = {
  left: ["leftDown", "leftUp"],
  right: ["rightDown", "rightUp"],
  soft: ["softDown", "softUp"],
};
type Control = "left" | "right" | "soft" | "hardDrop" | "rotateCw" | "rotateCcw" | "hold";
const KEYS: Record<string, Control> = {
  ArrowLeft: "left",
  ArrowRight: "right",
  ArrowDown: "soft",
  Space: "hardDrop",
  ArrowUp: "rotateCw",
  KeyX: "rotateCw",
  KeyZ: "rotateCcw",
  ControlLeft: "rotateCcw",
  KeyC: "hold",
  ShiftLeft: "hold",
  ShiftRight: "hold",
};

/**
 * Runs one game: fixed 60 ticks per second, every input recorded with the tick
 * it happened on. Inputs are applied straight away at the current tick, which
 * is exactly how the server replays them.
 */
class Controller {
  readonly game: Starfall;
  readonly recorder = new InputRecorder();
  private held = new Set<string>();
  private raf = 0;
  private last = 0;
  private acc = 0;
  running = false;

  constructor(
    seed: number,
    private renderer: StarfallRenderer,
    private onFrame: (game: Starfall) => void,
    private onOver: (game: Starfall) => void,
  ) {
    this.game = new Starfall(seed);
  }

  private send(input: Input) {
    if (this.game.over) return;
    this.recorder.record(this.game.tick, input);
    this.game.input(input);
  }

  press(control: Control) {
    if (!this.running) return;
    const held = HELD[control];
    if (held) {
      if (this.held.has(control)) return;
      this.held.add(control);
      this.send(held[0]);
    } else {
      this.send(control as Input);
    }
    this.afterInput();
  }

  release(control: Control) {
    const held = HELD[control];
    if (!held || !this.held.has(control)) return;
    this.held.delete(control);
    if (this.running) this.send(held[1]);
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
    for (const control of [...this.held]) this.release(control as Control);
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  /** The player ends the run early. */
  end() {
    this.send("end");
    this.afterInput();
  }

  destroy() {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  private afterInput() {
    this.flushEvents();
    if (this.game.over) this.finish();
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
    for (const e of this.game.events) if (e.type === "clear") this.renderer.addFlash(e.rows);
    this.events.push(...this.game.events);
    this.game.events = [];
  }

  /** Events since the last call (for banners). */
  events: Starfall["events"] = [];

  private finish() {
    if (!this.running) return;
    this.running = false;
    cancelAnimationFrame(this.raf);
    // The log always ends with "end" at the tick where the game stopped.
    if (this.game.overReason !== "ended") this.recorder.record(this.game.tick, "end");
    this.renderer.draw(this.game);
    this.onOver(this.game);
  }
}

const END_REASONS: Record<string, string> = {
  topOut: "The crystals reached the top.",
  time: "Time's up: a run lasts at most one hour.",
  ended: "You ended the run.",
};

export function StarfallGame({ gameId, canPlay }: { gameId: string; canPlay: boolean }) {
  const boardRef = useRef<HTMLCanvasElement>(null);
  const holdRef = useRef<HTMLCanvasElement>(null);
  const nextRef = useRef<HTMLCanvasElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const fieldRef = useRef<HTMLDivElement>(null);
  const sideRef = useRef<HTMLElement>(null);
  const rendererRef = useRef<StarfallRenderer | null>(null);
  const controllerRef = useRef<Controller | null>(null);
  const runRef = useRef<number | null>(null);
  const [phase, setPhase] = useState<Phase>({ name: "idle" });
  const [hud, setHud] = useState<Hud>({ score: 0, level: 1, lines: 0 });
  const [banner, setBanner] = useState<{ text: string; id: number } | null>(null);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const aliveRef = useRef(true);

  // Size the board to its container and draw an empty field.
  useEffect(() => {
    const renderer = new StarfallRenderer(boardRef.current!, holdRef.current!, nextRef.current!);
    rendererRef.current = renderer;
    const fit = () => {
      // The side columns have a fixed CSS width. The board gets the width
      // that's left between them, and never more height than the window has.
      const field = fieldRef.current!;
      const side = sideRef.current?.offsetWidth ?? 104;
      const gap = parseFloat(getComputedStyle(field).columnGap) || 0;
      const byWidth = Math.floor((field.clientWidth - 2 * side - 2 * gap) / COLS);
      const byHeight = Math.floor((window.innerHeight - 170) / ROWS);
      const cell = Math.max(12, Math.min(34, byWidth, byHeight));
      renderer.resize(cell, Math.max(8, Math.floor((side - 14) / 4.6)));
      renderer.draw(controllerRef.current?.game ?? new Starfall(1));
      if (!controllerRef.current) clearPreview(holdRef.current!, nextRef.current!);
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(fieldRef.current!);
    window.addEventListener("resize", fit);
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      ro.disconnect();
      window.removeEventListener("resize", fit);
      controllerRef.current?.destroy();
    };
  }, []);

  const onFrame = useCallback((game: Starfall) => {
    setHud((h) =>
      h.score === game.score && h.level === game.level && h.lines === game.lines
        ? h
        : { score: game.score, level: game.level, lines: game.lines },
    );
    const c = controllerRef.current;
    if (!c || c.events.length === 0) return;
    for (const e of c.events) {
      if (e.type === "clear" && e.count === 4) setBanner({ text: "Supernova!", id: Date.now() });
      else if (e.type === "level") setBanner({ text: `Level ${e.level}`, id: Date.now() });
    }
    c.events = [];
  }, []);

  const onOver = useCallback(async (game: Starfall) => {
    const runId = runRef.current;
    const c = controllerRef.current;
    if (runId === null || !c || !aliveRef.current) return;
    setPhase({ name: "saving", score: game.score });
    try {
      const result = await finishRun({ runId, log: c.recorder.toString() });
      setPhase({ name: "result", result, reason: END_REASONS[game.overReason ?? "ended"] });
    } catch (e: any) {
      setPhase({ name: "error", message: e?.message ?? "Couldn't save the run." });
    }
  }, []);

  const begin = useCallback(async () => {
    const p = phaseRef.current.name;
    if (!canPlay || (p !== "idle" && p !== "result" && p !== "error")) return;
    setPhase({ name: "starting" });
    try {
      const { runId, seed } = await startRun({ gameId });
      controllerRef.current?.destroy();
      runRef.current = runId;
      const controller = new Controller(seed, rendererRef.current!, onFrame, onOver);
      controllerRef.current = controller;
      rendererRef.current!.draw(controller.game);
      setHud({ score: 0, level: 1, lines: 0 });
      setBanner(null);
      // Bring the whole board into view (the page header sits above it).
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      rootRef.current?.scrollIntoView({ block: "nearest", behavior: reduce ? "auto" : "smooth" });
      for (const count of [3, 2, 1]) {
        setPhase({ name: "countdown", count });
        await new Promise((r) => setTimeout(r, 550));
        if (!aliveRef.current || controllerRef.current !== controller) return; // left the page or restarted
      }
      setPhase({ name: "playing" });
      controller.start();
      boardRef.current?.focus();
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

  // Keyboard
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
      const p = phaseRef.current.name;
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
      if (e.repeat) return; // the game handles auto-repeat itself
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

  return (
    <div className="sf" ref={rootRef}>
      <div className="sf-field" ref={fieldRef}>
        <aside className="sf-side sf-side--left" ref={sideRef}>
          <div className="sf-box">
            <span className="sf-label">Hold</span>
            <canvas ref={holdRef} aria-hidden="true" />
          </div>
          <dl className="sf-hud">
            <div><dt>Score</dt><dd data-testid="sf-score">{formatScore(hud.score)}</dd></div>
            <div><dt>Level</dt><dd>{hud.level}</dd></div>
            <div><dt>Rows</dt><dd>{hud.lines}</dd></div>
          </dl>
        </aside>

        <div className="sf-board-wrap">
          <canvas
            ref={boardRef}
            className="sf-board"
            tabIndex={-1}
            role="img"
            aria-label={`Starfall board. Score ${hud.score}, level ${hud.level}, ${hud.lines} rows cleared.`}
          />
          {banner && playing && (
            <div key={banner.id} className="sf-banner" onAnimationEnd={() => setBanner(null)} aria-hidden="true">
              {banner.text}
            </div>
          )}
          <Overlay phase={phase} canPlay={canPlay} onStart={begin} onResume={resume} onEnd={endRun} />
        </div>

        <aside className="sf-side sf-side--right">
          <div className="sf-box">
            <span className="sf-label">Next</span>
            <canvas ref={nextRef} aria-hidden="true" />
          </div>
          {(playing || phase.name === "paused") && (
            <div className="sf-side-actions">
              {playing ? (
                <button className="btn btn--ghost btn--sm" onClick={pause}>Pause</button>
              ) : (
                <button className="btn btn--ghost btn--sm" onClick={resume}>Resume</button>
              )}
              <button className="btn btn--ghost btn--sm" onClick={endRun}>End run</button>
            </div>
          )}
        </aside>
      </div>

      <TouchControls controller={controllerRef} active={playing} onPause={pause} />
    </div>
  );
}

function clearPreview(...canvases: HTMLCanvasElement[]) {
  for (const cv of canvases) cv.getContext("2d")?.clearRect(0, 0, cv.width, cv.height);
}

function Overlay({
  phase,
  canPlay,
  onStart,
  onResume,
  onEnd,
}: {
  phase: Phase;
  canPlay: boolean;
  onStart: () => void;
  onResume: () => void;
  onEnd: () => void;
}) {
  switch (phase.name) {
    case "playing":
      return null;
    case "idle":
      return (
        <div className="sf-overlay">
          <p className="sf-title">Starfall</p>
          {canPlay ? (
            <>
              <button className="btn btn--primary btn--lg" onClick={onStart} autoFocus>Start</button>
              <p className="sf-hint">or press Enter</p>
            </>
          ) : (
            <p className="sf-hint">Add Starfall to your arcade to play.</p>
          )}
        </div>
      );
    case "starting":
      return <div className="sf-overlay"><p className="sf-hint">Opening a run…</p></div>;
    case "countdown":
      return (
        <div className="sf-overlay sf-overlay--clear">
          <p key={phase.count} className="sf-count" aria-live="assertive">{phase.count}</p>
        </div>
      );
    case "paused":
      return (
        <div className="sf-overlay">
          <p className="sf-title">Paused</p>
          <button className="btn btn--primary btn--lg" onClick={onResume} autoFocus>Resume</button>
          <button className="btn btn--ghost" onClick={onEnd}>End run</button>
        </div>
      );
    case "saving":
      return (
        <div className="sf-overlay" aria-live="polite">
          <p className="sf-title">Game over</p>
          <p className="sf-hint">Checking your run on the server…</p>
        </div>
      );
    case "result": {
      const { result, reason } = phase;
      return (
        <div className="sf-overlay" aria-live="polite">
          <p className="sf-title">Game over</p>
          <p className="sf-hint">{reason}</p>
          <p className="sf-final" data-testid="sf-final">{formatScore(result.score)}</p>
          {result.newBest && result.score > 0 && <p className="sf-newbest">New best!</p>}
          <dl className="sf-result">
            <div><dt>Rank</dt><dd>#{result.rank} of {result.players}</dd></div>
            <div><dt>Rows</dt><dd>{String(result.stats.lines ?? 0)}</dd></div>
            <div><dt>Level</dt><dd>{String(result.stats.level ?? 1)}</dd></div>
            <div><dt>Time</dt><dd>{formatDuration(result.durationMs)}</dd></div>
          </dl>
          <button className="btn btn--primary btn--lg" onClick={onStart} autoFocus>Play again</button>
          <p className="sf-verified">✓ Score verified by replay</p>
        </div>
      );
    }
    case "error":
      return (
        <div className="sf-overlay" role="alert">
          <p className="sf-title sf-title--sm">Something went wrong</p>
          <p className="sf-hint">{phase.message}</p>
          {canPlay && <button className="btn btn--primary" onClick={onStart}>Try again</button>}
        </div>
      );
  }
}

/** On-screen buttons for phones and tablets. */
function TouchControls({
  controller,
  active,
  onPause,
}: {
  controller: RefObject<Controller | null>;
  active: boolean;
  onPause: () => void;
}) {
  const bind = (control: Control) => ({
    onPointerDown: (e: ReactPointerEvent) => {
      e.preventDefault();
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
      controller.current?.press(control);
    },
    onPointerUp: () => controller.current?.release(control),
    onPointerCancel: () => controller.current?.release(control),
    onLostPointerCapture: () => controller.current?.release(control),
    onContextMenu: (e: ReactMouseEvent) => e.preventDefault(),
  });
  return (
    <div className={active ? "sf-touch" : "sf-touch sf-touch--idle"} aria-label="Touch controls">
      <button className="sf-key" aria-label="Hold" {...bind("hold")}>Hold</button>
      <button className="sf-key" aria-label="Rotate counter-clockwise" {...bind("rotateCcw")}>⟲</button>
      <button className="sf-key" aria-label="Rotate clockwise" {...bind("rotateCw")}>⟳</button>
      <button className="sf-key sf-key--small" aria-label="Pause" onClick={onPause}>❚❚</button>
      <button className="sf-key" aria-label="Move left" {...bind("left")}>←</button>
      <button className="sf-key" aria-label="Soft drop" {...bind("soft")}>↓</button>
      <button className="sf-key" aria-label="Move right" {...bind("right")}>→</button>
      <button className="sf-key sf-key--drop" aria-label="Hard drop" {...bind("hardDrop")}>Drop</button>
    </div>
  );
}
