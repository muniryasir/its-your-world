// Arcade demo data, called from src/db/seed.ts.
//
// Demo players and their leaderboard runs are produced by a bot actually
// playing Starfall (games/starfall/bot.ts) with real seeds, so every seeded
// score is a genuine run that replays and verifies like a human's.
import type { PrismaClient } from "wasp/server";
import { randomBytes } from "node:crypto";
import { createProviderId, createUser, sanitizeAndSerializeProviderData } from "wasp/server/auth";
import { STARFALL } from "./games/catalog";
import { GAME_SERVERS } from "./games/server";
import { playBot, type BotOptions } from "./games/starfall/bot";
import { nicknameKey } from "./nicknames";

type DemoRun = [seed: number, daysAgo: number, bot: BotOptions];

// Bot accounts that only exist to fill the leaderboard. They get a random
// password nobody knows, so nobody can log in as them.
const DEMO_PLAYERS: { username: string; nickname: string; runs: DemoRun[] }[] = [
  { username: "arcade-bot-quasar", nickname: "Quasar-77", runs: [[12, 3, { maxPieces: 300, pace: 12, sloppiness: 0.08 }], [31, 9, { maxPieces: 160, pace: 12, sloppiness: 0.1 }]] },
  { username: "arcade-bot-nebula", nickname: "Nebula-12", runs: [[11, 1, { maxPieces: 400, pace: 10, sloppiness: 0.05 }]] },
  { username: "arcade-bot-orion", nickname: "Orion-08", runs: [[13, 5, { maxPieces: 240, pace: 12, sloppiness: 0.1 }], [32, 11, { maxPieces: 90, pace: 16, sloppiness: 0.2 }]] },
  { username: "arcade-bot-vega", nickname: "Vega-31", runs: [[14, 2, { maxPieces: 200, pace: 14, sloppiness: 0.12 }]] },
  { username: "arcade-bot-lyra", nickname: "Lyra-55", runs: [[15, 6, { maxPieces: 150, pace: 14, sloppiness: 0.15 }]] },
  { username: "arcade-bot-comet", nickname: "Comet-90", runs: [[16, 4, { maxPieces: 110, pace: 16, sloppiness: 0.2 }]] },
  { username: "arcade-bot-photon", nickname: "Photon-23", runs: [[19, 8, { maxPieces: 60, pace: 16, sloppiness: 0.3 }]] },
];

// The demo account's own runs: a decent best in the middle of the table.
const DEMO_NICKNAME = "DemoPilot";
const DEMO_RUNS: DemoRun[] = [
  [18, 1, { maxPieces: 170, pace: 14, sloppiness: 0.12 }],
  [20, 2, { maxPieces: 130, pace: 15, sloppiness: 0.15 }],
  [17, 7, { maxPieces: 80, pace: 16, sloppiness: 0.25 }],
];

async function resetPlayer(prisma: PrismaClient, userId: number, nickname: string, runs: DemoRun[]) {
  await prisma.gameRun.deleteMany({ where: { userId } });
  await prisma.arcadeGame.deleteMany({ where: { userId } });
  await prisma.arcadePlayer.deleteMany({ where: { userId } });
  // Free the nickname if a real user happens to have taken it.
  await prisma.arcadePlayer.deleteMany({ where: { nicknameKey: nicknameKey(nickname) } });
  await prisma.arcadePlayer.create({ data: { userId, nickname, nicknameKey: nicknameKey(nickname) } });
  await prisma.arcadeGame.create({ data: { userId, gameId: STARFALL.id } });

  for (const [seed, daysAgo, bot] of runs) {
    const verified = GAME_SERVERS[STARFALL.id].verify(seed, playBot(seed, bot));
    const finishedAt = new Date(Date.now() - daysAgo * 86_400_000 - (seed % 9) * 3_600_000);
    await prisma.gameRun.create({
      data: {
        userId,
        gameId: STARFALL.id,
        seed,
        status: "FINISHED",
        score: verified.score,
        stats: verified.stats,
        ticks: verified.ticks,
        startedAt: new Date(finishedAt.getTime() - verified.durationMs),
        finishedAt,
      },
    });
  }
}

async function findOrCreateUser(prisma: PrismaClient, username: string): Promise<number> {
  const existing = await prisma.authIdentity.findFirst({
    where: { providerName: "username", providerUserId: username },
    include: { auth: true },
  });
  if (existing?.auth.userId) return existing.auth.userId;
  const providerData = await sanitizeAndSerializeProviderData<"username">({
    hashedPassword: randomBytes(24).toString("base64url"),
  });
  const user = await createUser(createProviderId("username", username), providerData, {});
  return user.id;
}

/** Adds the Arcade to the demo account and fills the Starfall leaderboard. Safe to re-run. */
export async function seedArcade(prisma: PrismaClient, demoUserId: number) {
  await prisma.userApp.upsert({
    where: { userId_appId: { userId: demoUserId, appId: "arcade" } },
    update: {},
    create: { userId: demoUserId, appId: "arcade", position: 1 },
  });
  await resetPlayer(prisma, demoUserId, DEMO_NICKNAME, DEMO_RUNS);

  for (const p of DEMO_PLAYERS) {
    const userId = await findOrCreateUser(prisma, p.username);
    await resetPlayer(prisma, userId, p.nickname, p.runs);
  }
  console.log(`Seeded the Arcade: ${DEMO_PLAYERS.length} bot players on the Starfall leaderboard, demo plays as ${DEMO_NICKNAME}.`);
}
