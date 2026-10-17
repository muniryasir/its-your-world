import { prisma } from "wasp/server";
import { ensurePlayer } from "./operations";
import { STARFALL } from "./games/catalog";

/**
 * Runs when a user adds the Arcade to their world.
 * Gives them a nickname and puts Starfall on their shelf so they can play
 * right away. Safe to run again: an existing nickname is kept, and games are
 * only added when the shelf is empty.
 */
export async function onAddArcade(userId: number) {
  await ensurePlayer(prisma.arcadePlayer, userId);
  const games = await prisma.arcadeGame.count({ where: { userId } });
  if (games === 0) {
    await prisma.arcadeGame.create({ data: { userId, gameId: STARFALL.id } });
  }
}
