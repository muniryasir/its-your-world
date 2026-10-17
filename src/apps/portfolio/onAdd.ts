import { prisma } from "wasp/server";

/**
 * Runs once when a user adds Portfolio to their world.
 * Gives them an empty portfolio so they can start adding holdings right away.
 * If they already have portfolios (e.g. they removed and re-added the app), nothing changes.
 */
export async function onAddPortfolio(userId: number) {
  const existing = await prisma.portfolio.count({ where: { userId } });
  if (existing === 0) {
    await prisma.portfolio.create({ data: { name: "My portfolio", userId } });
  }
}
