// Server side of each game: how to check a finished run. Server only.
import { InvalidLogError, replay as replayStarfall, TICKS_PER_SECOND } from "./starfall/engine";
import {
  InvalidLogError as NovaInvalidLogError,
  replay as replayNova,
  TICKS_PER_SECOND as NOVA_TICKS_PER_SECOND,
} from "./nova-raiders/engine";

export { InvalidLogError };

export type VerifiedRun = {
  score: number;
  /** Length of the run in milliseconds of game time. */
  durationMs: number;
  ticks: number;
  /** Game-specific results stored with the run. */
  stats: Record<string, number | string>;
};

export type GameServer = {
  /** Replays a run from its seed and recorded inputs. Throws InvalidLogError. */
  verify: (seed: number, log: string) => VerifiedRun;
};

export const GAME_SERVERS: Record<string, GameServer> = {
  starfall: {
    verify(seed, log) {
      const r = replayStarfall(seed, log);
      return {
        score: r.score,
        ticks: r.ticks,
        durationMs: Math.round((r.ticks * 1000) / TICKS_PER_SECOND),
        stats: { lines: r.lines, level: r.level, supernovas: r.supernovas, pieces: r.pieces, end: r.reason },
      };
    },
  },
  "nova-raiders": {
    verify(seed, log) {
      let r;
      try {
        r = replayNova(seed, log);
      } catch (e) {
        // Report bad logs the same way as every other game.
        if (e instanceof NovaInvalidLogError) throw new InvalidLogError(e.message);
        throw e;
      }
      return {
        score: r.score,
        ticks: r.ticks,
        durationMs: Math.round((r.ticks * 1000) / NOVA_TICKS_PER_SECOND),
        stats: {
          level: r.level, wave: r.wave, difficulty: r.difficulty, kills: r.kills, lives: r.lives,
          shotsFired: r.shotsFired, shotsHit: r.shotsHit, end: r.reason,
        },
      };
    },
  },
};
