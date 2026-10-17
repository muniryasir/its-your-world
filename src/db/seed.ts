import type { PrismaClient } from "wasp/server";
import { Prisma } from "@prisma/client";
import { createProviderId, createUser, sanitizeAndSerializeProviderData } from "wasp/server/auth";
import { findAsset } from "../apps/portfolio/market/catalog";
import { closeOn, dayIndex } from "../apps/portfolio/market/prices";

const D = Prisma.Decimal;

// Demo account used by reviewers: demo / demo1234
const DEMO_USERNAME = "demo";
const DEMO_PASSWORD = "demo1234";

// Demo trades, replayed at the simulated price of the day they happened.
// [symbol, daysAgo, "buy" with a dollar amount | "sell" a fraction of the holding]
type DemoTrade = [symbol: string, daysAgo: number, side: "buy" | "sell", amountOrFraction: number];

const DEMO_PORTFOLIOS: { name: string; description: string; startingCash: number; trades: DemoTrade[] }[] = [
  {
    name: "Long-Term Growth",
    description: "Core buy-and-hold: big US tech plus gold.",
    startingCash: 100_000,
    trades: [
      ["XAU", 320, "buy", 15_000],
      ["AAPL", 300, "buy", 15_000],
      ["MSFT", 280, "buy", 15_000],
      ["NVDA", 250, "buy", 12_000],
      ["GOOGL", 200, "buy", 8_000],
      ["NVDA", 60, "sell", 0.5],
    ],
  },
  {
    name: "Crypto Sandbox",
    description: "Small, high-risk experiments.",
    startingCash: 25_000,
    trades: [
      ["BTC", 200, "buy", 8_000],
      ["ETH", 180, "buy", 5_000],
      ["SOL", 120, "buy", 3_000],
      ["DOGE", 60, "buy", 1_000],
    ],
  },
  {
    name: "Commodities",
    description: "Oil, gas and metals as a hedge against inflation.",
    startingCash: 50_000,
    trades: [
      ["XAU", 300, "buy", 8_000],
      ["BRENT", 240, "buy", 10_000],
      ["XAG", 210, "buy", 6_000],
      ["WTI", 150, "buy", 6_000],
      ["CU", 130, "buy", 5_000],
      ["NG", 90, "buy", 4_000],
    ],
  },
];

/**
 * Creates the demo user and sample portfolios.
 * Safe to re-run: it deletes and recreates the demo user's data,
 * which is also how the shared demo account gets reset.
 */
export async function seedDemoData(prisma: PrismaClient) {
  const existing = await prisma.authIdentity.findFirst({
    where: { providerName: "username", providerUserId: DEMO_USERNAME },
    include: { auth: true },
  });

  let userId: number;
  if (existing) {
    userId = existing.auth.userId!;
    await prisma.portfolio.deleteMany({ where: { userId } });
    console.log(`Resetting data for existing "${DEMO_USERNAME}" user.`);
  } else {
    const providerData = await sanitizeAndSerializeProviderData<"username">({
      hashedPassword: DEMO_PASSWORD,
    });
    const user = await createUser(createProviderId("username", DEMO_USERNAME), providerData, {});
    userId = user.id;
    console.log(`Created "${DEMO_USERNAME}" user.`);
  }

  // The demo account has the Portfolio app added, so reviewers see a full world.
  await prisma.userApp.upsert({
    where: { userId_appId: { userId, appId: "portfolio" } },
    update: {},
    create: { userId, appId: "portfolio", position: 0 },
  });

  const today = dayIndex();
  for (const p of DEMO_PORTFOLIOS) {
    const portfolio = await prisma.portfolio.create({
      data: { name: p.name, description: p.description, userId, startingCash: p.startingCash, cash: p.startingCash },
    });
    let cash = new D(p.startingCash);
    const held = new Map<string, { quantity: Prisma.Decimal; costBasis: Prisma.Decimal }>();

    for (const [symbol, daysAgo, side, n] of [...p.trades].sort((a, b) => b[1] - a[1])) {
      const asset = findAsset(symbol);
      if (!asset) throw new Error(`Demo trade uses unknown asset ${symbol}`);
      const day = today - daysAgo;
      const price = new D(closeOn(asset, day).toFixed(asset.decimals));
      const createdAt = new Date(day * 86_400_000 + 15 * 3_600_000);
      const h = held.get(symbol) ?? { quantity: new D(0), costBasis: new D(0) };

      if (side === "buy") {
        const quantity = new D(n).div(price).toDecimalPlaces(8, D.ROUND_DOWN);
        const total = quantity.mul(price).toDecimalPlaces(2, D.ROUND_HALF_UP);
        cash = cash.minus(total);
        held.set(symbol, { quantity: h.quantity.plus(quantity), costBasis: h.costBasis.plus(total) });
        await prisma.trade.create({
          data: { portfolioId: portfolio.id, symbol, side: "BUY", quantity, price, total, createdAt },
        });
      } else {
        const quantity = h.quantity.mul(n).toDecimalPlaces(8, D.ROUND_DOWN);
        const total = quantity.mul(price).toDecimalPlaces(2, D.ROUND_HALF_UP);
        const costSold = h.costBasis.mul(quantity).div(h.quantity).toDecimalPlaces(4, D.ROUND_HALF_UP);
        cash = cash.plus(total);
        held.set(symbol, { quantity: h.quantity.minus(quantity), costBasis: h.costBasis.minus(costSold) });
        await prisma.trade.create({
          data: {
            portfolioId: portfolio.id, symbol, side: "SELL", quantity, price, total,
            realizedGain: total.minus(costSold), createdAt,
          },
        });
      }
    }

    await prisma.holding.createMany({
      data: [...held.entries()]
        .filter(([, h]) => h.quantity.gt(0))
        .map(([symbol, h]) => ({ portfolioId: portfolio.id, symbol, quantity: h.quantity, costBasis: h.costBasis })),
    });
    await prisma.portfolio.update({ where: { id: portfolio.id }, data: { cash } });
  }
  console.log(`Seeded ${DEMO_PORTFOLIOS.length} demo portfolios. Log in with ${DEMO_USERNAME} / ${DEMO_PASSWORD}.`);
}
