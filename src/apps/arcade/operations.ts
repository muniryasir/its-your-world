import { HttpError, type prisma } from "wasp/server";
import type {
  GetArcade,
  GetGame,
  AddGame,
  RemoveGame,
  SetNickname,
  StartRun,
  FinishRun,
} from "wasp/server/operations";
import { randomInt } from "node:crypto";
import { requireAppAdded } from "../../world/requireApp";
import { findGame, GAMES, type GameManifest } from "./games/catalog";
import { GAME_SERVERS, InvalidLogError } from "./games/server";
import { isValidNickname, nicknameKey, NICKNAME_RULES, randomNickname } from "./nicknames";

const APP_ID = "arcade";
/** A run can be finished up to this long after it started (the longest run is 1 hour). */
const RUN_EXPIRES_MS = 2 * 60 * 60 * 1000;
/** Allowance for network delay when comparing game time with real time. */
const CLOCK_SLACK_MS = 3_000;
/** At most this many runs per user per minute. */
const RUNS_PER_MINUTE = 20;
const LEADERBOARD_SIZE = 10;

// ---------------------------------------------------------------------------
// Shapes sent to the client
// ---------------------------------------------------------------------------

export type RunStats = Record<string, number | string>;

export type RunView = {
  id: number;
  score: number;
  stats: RunStats;
  durationMs: number;
  finishedAt: string;
};

export type LeaderboardEntry = {
  rank: number;
  nickname: string;
  score: number;
  stats: RunStats;
  finishedAt: string;
  /** True for the logged-in user's own entry. */
  you: boolean;
};

export type GameCard = GameManifest & {
  added: boolean;
  best: number | null;
  rank: number | null;
  runs: number;
};

export type ArcadeOverview = {
  nickname: string;
  games: GameCard[];
};

export type GameDetail = {
  game: GameManifest;
  added: boolean;
  nickname: string;
  best: RunView | null;
  rank: number | null;
  players: number;
  recent: RunView[];
  leaderboard: LeaderboardEntry[];
};

export type RunResult = {
  score: number;
  stats: RunStats;
  durationMs: number;
  newBest: boolean;
  best: number;
  rank: number;
  players: number;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type PlayerDelegate = typeof prisma.arcadePlayer;
type RunDelegate = typeof prisma.gameRun;

/**
 * Returns the user's nickname, creating a random one the first time.
 * Used by onAdd and, defensively, by every query.
 */
export async function ensurePlayer(players: PlayerDelegate, userId: number): Promise<string> {
  const existing = await players.findUnique({ where: { userId } });
  if (existing) return existing.nickname;
  for (let attempt = 0; attempt < 10; attempt++) {
    const nickname = randomNickname(attempt);
    try {
      const created = await players.create({ data: { userId, nickname, nicknameKey: nicknameKey(nickname) } });
      return created.nickname;
    } catch (e: any) {
      if (e?.code !== "P2002") throw e;
      // Either the nickname is taken (try another) or a parallel request created the player.
      const raced = await players.findUnique({ where: { userId } });
      if (raced) return raced.nickname;
    }
  }
  throw new HttpError(500, "Couldn't pick a nickname. Try again.");
}

function requireGame(gameId: unknown): GameManifest {
  const game = typeof gameId === "string" ? findGame(gameId) : undefined;
  if (!game) throw new HttpError(404, "Game not found");
  return game;
}

const FINISHED = { status: "FINISHED" } as const;

function toRunView(r: { id: number; score: number; stats: unknown; ticks: number; finishedAt: Date | null }): RunView {
  return {
    id: r.id,
    score: r.score,
    stats: (r.stats ?? {}) as RunStats,
    durationMs: Math.round((r.ticks * 1000) / 60),
    finishedAt: (r.finishedAt ?? new Date(0)).toISOString(),
  };
}

/** The user's best score in a game, or null if they haven't finished a run. */
async function bestScore(runs: RunDelegate, userId: number, gameId: string): Promise<number | null> {
  const agg = await runs.aggregate({ where: { userId, gameId, ...FINISHED }, _max: { score: true } });
  return agg._max.score;
}

/** 1 + number of players whose best is higher. */
async function rankFor(runs: RunDelegate, gameId: string, best: number): Promise<number> {
  const higher = await runs.groupBy({
    by: ["userId"],
    where: { gameId, ...FINISHED },
    having: { score: { _max: { gt: best } } },
  });
  return higher.length + 1;
}

async function playerCount(runs: RunDelegate, gameId: string): Promise<number> {
  const players = await runs.groupBy({ by: ["userId"], where: { gameId, ...FINISHED } });
  return players.length;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/** The user's arcade: nickname and every game, with their best scores. */
export const getArcade: GetArcade<void, ArcadeOverview> = async (_args, context) => {
  const user = await requireAppAdded(context, APP_ID);
  const nickname = await ensurePlayer(context.entities.ArcadePlayer, user.id);
  const added = await context.entities.ArcadeGame.findMany({ where: { userId: user.id } });
  const addedIds = new Set(added.map((g) => g.gameId));

  const games: GameCard[] = [];
  for (const game of GAMES) {
    const best = await bestScore(context.entities.GameRun, user.id, game.id);
    const runs = await context.entities.GameRun.count({ where: { userId: user.id, gameId: game.id, ...FINISHED } });
    games.push({
      ...game,
      added: addedIds.has(game.id),
      best,
      rank: best === null ? null : await rankFor(context.entities.GameRun, game.id, best),
      runs,
    });
  }
  return { nickname, games };
};

/**
 * One game's page: the user's best and recent runs, and the leaderboard.
 * The leaderboard is the one place the Arcade reads other users' rows; it
 * only exposes their nickname, score, stats and date.
 */
export const getGame: GetGame<{ gameId: string }, GameDetail> = async ({ gameId }, context) => {
  const user = await requireAppAdded(context, APP_ID);
  const game = requireGame(gameId);
  const runs = context.entities.GameRun;
  const nickname = await ensurePlayer(context.entities.ArcadePlayer, user.id);
  const added = await context.entities.ArcadeGame.findUnique({
    where: { userId_gameId: { userId: user.id, gameId: game.id } },
  });

  const bestRun = await runs.findFirst({
    where: { userId: user.id, gameId: game.id, ...FINISHED },
    orderBy: [{ score: "desc" }, { finishedAt: "asc" }],
  });
  const recent = await runs.findMany({
    where: { userId: user.id, gameId: game.id, ...FINISHED },
    orderBy: { finishedAt: "desc" },
    take: 5,
  });

  // Best score per player, highest first.
  const top = await runs.groupBy({
    by: ["userId"],
    where: { gameId: game.id, ...FINISHED },
    _max: { score: true },
    orderBy: { _max: { score: "desc" } },
    take: LEADERBOARD_SIZE,
  });
  const ids = top.map((t) => t.userId);
  const [players, topRuns] = await Promise.all([
    context.entities.ArcadePlayer.findMany({ where: { userId: { in: ids } } }),
    runs.findMany({
      where: { gameId: game.id, ...FINISHED, userId: { in: ids } },
      orderBy: [{ score: "desc" }, { finishedAt: "asc" }],
      select: { userId: true, score: true, stats: true, finishedAt: true },
    }),
  ]);
  const names = new Map(players.map((p) => [p.userId, p.nickname]));
  const bestOf = new Map<number, (typeof topRuns)[number]>();
  for (const r of topRuns) if (!bestOf.has(r.userId)) bestOf.set(r.userId, r);

  // Players with the same best score share a rank.
  const leaderboard: LeaderboardEntry[] = [];
  top.forEach((t, i) => {
    const run = bestOf.get(t.userId)!;
    const prev = leaderboard[i - 1];
    leaderboard.push({
      rank: prev && prev.score === run.score ? prev.rank : i + 1,
      nickname: names.get(t.userId) ?? "Player",
      score: run.score,
      stats: (run.stats ?? {}) as RunStats,
      finishedAt: (run.finishedAt ?? new Date(0)).toISOString(),
      you: t.userId === user.id,
    });
  });

  return {
    game,
    added: Boolean(added),
    nickname,
    best: bestRun ? toRunView(bestRun) : null,
    rank: bestRun ? await rankFor(runs, game.id, bestRun.score) : null,
    players: await playerCount(runs, game.id),
    recent: recent.map(toRunView),
    leaderboard,
  };
};

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export const addGame: AddGame<{ gameId: string }, { gameId: string }> = async ({ gameId }, context) => {
  const user = await requireAppAdded(context, APP_ID);
  const game = requireGame(gameId);
  if (game.status !== "live") throw new HttpError(400, `${game.name} isn't available yet.`);
  await context.entities.ArcadeGame.upsert({
    where: { userId_gameId: { userId: user.id, gameId: game.id } },
    update: {},
    create: { userId: user.id, gameId: game.id },
  });
  return { gameId: game.id };
};

/** Takes a game off the user's shelf. Their runs and scores are kept. */
export const removeGame: RemoveGame<{ gameId: string }, { gameId: string }> = async ({ gameId }, context) => {
  const user = await requireAppAdded(context, APP_ID);
  const game = requireGame(gameId);
  await context.entities.ArcadeGame.deleteMany({ where: { userId: user.id, gameId: game.id } });
  return { gameId: game.id };
};

export const setNickname: SetNickname<{ nickname: string }, { nickname: string }> = async (
  { nickname },
  context,
) => {
  const user = await requireAppAdded(context, APP_ID);
  const name = typeof nickname === "string" ? nickname.trim() : "";
  if (!isValidNickname(name)) throw new HttpError(400, `Nicknames are ${NICKNAME_RULES}`);
  await ensurePlayer(context.entities.ArcadePlayer, user.id);
  try {
    await context.entities.ArcadePlayer.update({
      where: { userId: user.id },
      data: { nickname: name, nicknameKey: nicknameKey(name) },
    });
  } catch (e: any) {
    if (e?.code === "P2002") throw new HttpError(400, "That nickname is taken. Try another.");
    throw e;
  }
  return { nickname: name };
};

/**
 * Starts a run. The server picks the seed, which decides the order of the
 * pieces, so a player can't choose a lucky game. Any run the user left open
 * in this game is abandoned.
 */
export const startRun: StartRun<{ gameId: string }, { runId: number; seed: number }> = async (
  { gameId },
  context,
) => {
  const user = await requireAppAdded(context, APP_ID);
  const game = requireGame(gameId);
  const onShelf = await context.entities.ArcadeGame.findUnique({
    where: { userId_gameId: { userId: user.id, gameId: game.id } },
  });
  if (!onShelf) throw new HttpError(403, `Add ${game.name} to your arcade first.`);

  const recent = await context.entities.GameRun.count({
    where: { userId: user.id, startedAt: { gt: new Date(Date.now() - 60_000) } },
  });
  if (recent >= RUNS_PER_MINUTE) throw new HttpError(429, "Too many new runs. Wait a minute and try again.");

  await context.entities.GameRun.updateMany({
    where: { userId: user.id, gameId: game.id, status: "PLAYING" },
    data: { status: "ABANDONED" },
  });
  const run = await context.entities.GameRun.create({
    data: { userId: user.id, gameId: game.id, seed: randomInt(0, 2 ** 31 - 1) },
  });
  return { runId: run.id, seed: run.seed };
};

/**
 * Finishes a run. The browser sends the inputs it recorded, never a score:
 * the server replays them with the run's seed and stores the score the
 * replay produces. Each run can be submitted once.
 */
export const finishRun: FinishRun<{ runId: number; log: string }, RunResult> = async ({ runId, log }, context) => {
  const user = await requireAppAdded(context, APP_ID);
  if (!Number.isInteger(runId)) throw new HttpError(400, "Missing run.");
  if (typeof log !== "string") throw new HttpError(400, "Missing input log.");

  const run = await context.entities.GameRun.findFirst({ where: { id: runId, userId: user.id } });
  if (!run) throw new HttpError(404, "Run not found");
  if (run.status !== "PLAYING") throw new HttpError(400, "This run has already ended.");

  const reject = async (status: "ABANDONED" | "REJECTED", message: string) => {
    await context.entities.GameRun.updateMany({
      where: { id: run.id, status: "PLAYING" },
      data: { status, finishedAt: new Date() },
    });
    throw new HttpError(400, message);
  };

  const elapsed = Date.now() - run.startedAt.getTime();
  if (elapsed > RUN_EXPIRES_MS) await reject("ABANDONED", "This run expired. Start a new one.");

  const server = GAME_SERVERS[run.gameId];
  if (!server) throw new HttpError(404, "Game not found");
  let verified;
  try {
    verified = server.verify(run.seed, log);
  } catch (e) {
    if (e instanceof InvalidLogError) await reject("REJECTED", `This run couldn't be verified: ${e.message}`);
    throw e;
  }
  if (verified.durationMs > elapsed + CLOCK_SLACK_MS) {
    await reject("REJECTED", "This run couldn't be verified: it lasted longer than the time since it started.");
  }

  const previousBest = await bestScore(context.entities.GameRun, user.id, run.gameId);
  // Only a run that is still open can be finished (guards double submits).
  const updated = await context.entities.GameRun.updateMany({
    where: { id: run.id, status: "PLAYING" },
    data: {
      status: "FINISHED",
      score: verified.score,
      stats: verified.stats,
      ticks: verified.ticks,
      finishedAt: new Date(),
    },
  });
  if (updated.count === 0) throw new HttpError(400, "This run has already ended.");

  const best = Math.max(previousBest ?? 0, verified.score);
  return {
    score: verified.score,
    stats: verified.stats,
    durationMs: verified.durationMs,
    newBest: previousBest === null || verified.score > previousBest,
    best,
    rank: await rankFor(context.entities.GameRun, run.gameId, best),
    players: await playerCount(context.entities.GameRun, run.gameId),
  };
};
