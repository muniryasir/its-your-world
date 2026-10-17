import type { PrismaClient } from "wasp/server";
import { createUser, sanitizeAndSerializeProviderData } from "wasp/server/auth";

// Demo account used by reviewers: demo / demo1234
const DEMO_USERNAME = "demo";
const DEMO_PASSWORD = "demo1234";

type Holding = [symbol: string, name: string, type: string, qty: number, buy: number, current: number];

const DEMO_PORTFOLIOS: { name: string; description: string; holdings: Holding[] }[] = [
  {
    name: "Long-Term Growth",
    description: "Core buy-and-hold positions.",
    holdings: [
      ["AAPL", "Apple Inc.", "Stock", 25, 148.5, 231.2],
      ["MSFT", "Microsoft Corp.", "Stock", 12, 285.0, 428.75],
      ["VOO", "Vanguard S&P 500 ETF", "ETF", 18, 362.1, 512.4],
      ["NVDA", "NVIDIA Corp.", "Stock", 30, 42.8, 128.6],
    ],
  },
  {
    name: "Crypto Sandbox",
    description: "Small, high-risk experiments.",
    holdings: [
      ["BTC", "Bitcoin", "Crypto", 0.15, 41200, 63850],
      ["ETH", "Ethereum", "Crypto", 2.4, 3150, 2480],
      ["SOL", "Solana", "Crypto", 35, 98.4, 142.3],
    ],
  },
  {
    name: "Income",
    description: "Dividend and bond holdings.",
    holdings: [
      ["SCHD", "Schwab US Dividend Equity ETF", "ETF", 60, 74.2, 79.9],
      ["BND", "Vanguard Total Bond Market ETF", "Bond", 40, 73.5, 72.1],
      ["KO", "Coca-Cola Co.", "Stock", 50, 58.9, 66.4],
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
    const user = await createUser(
      { id: "username", providerUserId: DEMO_USERNAME },
      providerData,
      {},
    );
    userId = user.id;
    console.log(`Created "${DEMO_USERNAME}" user.`);
  }

  for (const p of DEMO_PORTFOLIOS) {
    await prisma.portfolio.create({
      data: {
        name: p.name,
        description: p.description,
        userId,
        investments: {
          create: p.holdings.map(([symbol, name, assetType, quantity, buyPrice, currentPrice]) => ({
            symbol,
            name,
            assetType,
            quantity: String(quantity),
            buyPrice: String(buyPrice),
            currentPrice: String(currentPrice),
          })),
        },
      },
    });
  }
  console.log(`Seeded ${DEMO_PORTFOLIOS.length} demo portfolios. Log in with ${DEMO_USERNAME} / ${DEMO_PASSWORD}.`);
}
