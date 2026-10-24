// A simple autopilot for Nova Raiders: holds fire, lines up under the nearest
// enemy and sidesteps shots that are about to land. Used by the engine tests
// and the screenshot script's demo; it plays through the same inputs a person
// would, so its runs replay and verify like any other.
import { InputRecorder, NovaRaiders, SUB, type Difficulty, type Input } from "./engine";

type Dir = { left: boolean; right: boolean; up: boolean; down: boolean };

export type BotRun = { game: NovaRaiders; log: string };

/** Plays one run to the end (or until `maxTicks`) and returns the game and its log. */
export function playBot(seed: number, difficulty: Difficulty, maxTicks = 60 * 60 * 20, skill = 100): BotRun {
  const game = new NovaRaiders(seed, difficulty);
  const rec = new InputRecorder(difficulty);
  const held: Dir & { fire: boolean } = { left: false, right: false, up: false, down: false, fire: false };
  const set = (key: keyof typeof held, on: boolean) => {
    if (held[key] === on) return;
    held[key] = on;
    const input = `${key}${on ? "Down" : "Up"}` as Input;
    rec.record(game.tick, input);
    game.input(input);
  };
  // A lower skill reacts later, so some runs lose lives.
  const reactEvery = Math.max(1, Math.round(400 / skill) - 2);

  set("fire", true);
  while (!game.over && game.tick < maxTicks) {
    if (game.tick % reactEvery === 0) {
      const want = decide(game, skill);
      set("left", want.left);
      set("right", want.right);
      set("up", want.up);
      set("down", want.down);
    }
    game.step();
  }
  if (!game.over) {
    rec.record(game.tick, "end");
    game.input("end");
  } else if (game.overReason !== "ended") {
    rec.record(game.tick, "end");
  }
  return { game, log: rec.toString() };
}

function decide(g: NovaRaiders, skill: number): Dir {
  const out: Dir = { left: false, right: false, up: false, down: false };
  if (!g.alive) return out;
  const px = g.px;
  const py = g.py;

  // Danger: a shot, mine or diving enemy that will reach the ship soon.
  let threat: { x: number } | null = null;
  const look = Math.round((40 * skill) / 100) * SUB;
  for (const b of g.enemyShots) {
    if (b.y < py && py - b.y < look && Math.abs(b.x + ((b.vx * (py - b.y)) / Math.max(1, b.vy)) - px) < 8 * SUB) {
      threat = { x: b.x };
      break;
    }
  }
  if (!threat) {
    for (const e of g.enemies) {
      if (e.state === "dive" && e.y < py && py - e.y < 50 * SUB && Math.abs(e.x - px) < 12 * SUB) {
        threat = { x: e.x };
        break;
      }
    }
  }
  if (threat) {
    const goLeft = threat.x > px ? px > 20 * SUB : px > 140 * SUB;
    out.left = goLeft;
    out.right = !goLeft;
    out.down = true;
    return out;
  }

  // Line up under the lowest visible enemy.
  let target: number | null = null;
  let best = -Infinity;
  for (const e of g.enemies) {
    if (!e.visible || e.y < 0) continue;
    const score = e.y - Math.abs(e.x - px) / 4;
    if (score > best) {
      best = score;
      target = e.x;
    }
  }
  if (target !== null) {
    if (target < px - 2 * SUB) out.left = true;
    else if (target > px + 2 * SUB) out.right = true;
  }
  out.down = true;
  return out;
}
