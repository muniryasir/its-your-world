import { HttpError } from "wasp/server";
import type {
  GetPortfolios,
  GetPortfolio,
  CreatePortfolio,
  CreateInvestment,
} from "wasp/server/operations";
import type { Investment, Portfolio } from "wasp/entities";

// ---------------------------------------------------------------------------
// Shapes sent to the client. Prisma Decimals are converted to plain numbers
// here (display only); all money is stored as Decimal in the database.
// ---------------------------------------------------------------------------

export type HoldingView = {
  id: number;
  symbol: string;
  name: string;
  assetType: string;
  quantity: number;
  buyPrice: number;
  currentPrice: number;
  costBasis: number;
  marketValue: number;
  gain: number;
  gainPct: number;
};

export type PortfolioSummary = {
  id: number;
  name: string;
  description: string | null;
  holdingsCount: number;
  costBasis: number;
  marketValue: number;
  gain: number;
  gainPct: number;
};

export type PortfolioDetail = PortfolioSummary & { holdings: HoldingView[] };

function toHolding(inv: Investment): HoldingView {
  const quantity = Number(inv.quantity);
  const buyPrice = Number(inv.buyPrice);
  const currentPrice = Number(inv.currentPrice);
  const costBasis = quantity * buyPrice;
  const marketValue = quantity * currentPrice;
  const gain = marketValue - costBasis;
  return {
    id: inv.id,
    symbol: inv.symbol,
    name: inv.name,
    assetType: inv.assetType,
    quantity,
    buyPrice,
    currentPrice,
    costBasis,
    marketValue,
    gain,
    gainPct: costBasis === 0 ? 0 : (gain / costBasis) * 100,
  };
}

function summarize(p: Portfolio, holdings: HoldingView[]): PortfolioSummary {
  const costBasis = holdings.reduce((s, h) => s + h.costBasis, 0);
  const marketValue = holdings.reduce((s, h) => s + h.marketValue, 0);
  const gain = marketValue - costBasis;
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    holdingsCount: holdings.length,
    costBasis,
    marketValue,
    gain,
    gainPct: costBasis === 0 ? 0 : (gain / costBasis) * 100,
  };
}

function requireUser<T extends { user?: { id: number } }>(context: T) {
  if (!context.user) throw new HttpError(401);
  return context.user;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export const getPortfolios: GetPortfolios<void, PortfolioSummary[]> = async (
  _args,
  context,
) => {
  const user = requireUser(context);
  const portfolios = await context.entities.Portfolio.findMany({
    where: { userId: user.id },
    include: { investments: true },
    orderBy: { createdAt: "asc" },
  });
  return portfolios.map((p) => summarize(p, p.investments.map(toHolding)));
};

export const getPortfolio: GetPortfolio<{ id: number }, PortfolioDetail> = async (
  { id },
  context,
) => {
  const user = requireUser(context);
  // Ownership is part of the WHERE clause. Someone else's portfolio looks
  // exactly like a portfolio that doesn't exist (404, not 403), so we don't
  // leak which IDs exist.
  const portfolio = await context.entities.Portfolio.findFirst({
    where: { id, userId: user.id },
    include: { investments: { orderBy: { createdAt: "asc" } } },
  });
  if (!portfolio) throw new HttpError(404, "Portfolio not found");
  const holdings = portfolio.investments.map(toHolding);
  return { ...summarize(portfolio, holdings), holdings };
};

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export const createPortfolio: CreatePortfolio<
  { name: string; description?: string },
  { id: number }
> = async ({ name, description }, context) => {
  const user = requireUser(context);
  const trimmed = (name ?? "").trim();
  if (!trimmed) throw new HttpError(400, "Portfolio name is required");
  if (trimmed.length > 80) throw new HttpError(400, "Portfolio name is too long");

  const portfolio = await context.entities.Portfolio.create({
    data: {
      name: trimmed,
      description: description?.trim() || null,
      user: { connect: { id: user.id } },
    },
  });
  return { id: portfolio.id };
};

type NewInvestment = {
  portfolioId: number;
  symbol: string;
  name: string;
  assetType: string;
  quantity: number;
  buyPrice: number;
  currentPrice: number;
};

export const createInvestment: CreateInvestment<NewInvestment, { id: number }> = async (
  args,
  context,
) => {
  const user = requireUser(context);

  const portfolio = await context.entities.Portfolio.findFirst({
    where: { id: args.portfolioId, userId: user.id },
    select: { id: true },
  });
  if (!portfolio) throw new HttpError(404, "Portfolio not found");

  const symbol = (args.symbol ?? "").trim().toUpperCase();
  const name = (args.name ?? "").trim();
  if (!symbol) throw new HttpError(400, "Symbol is required");
  if (!name) throw new HttpError(400, "Name is required");
  for (const [field, value] of [
    ["Quantity", args.quantity],
    ["Buy price", args.buyPrice],
    ["Current price", args.currentPrice],
  ] as const) {
    if (!Number.isFinite(value) || value <= 0) {
      throw new HttpError(400, `${field} must be a positive number`);
    }
  }

  const investment = await context.entities.Investment.create({
    data: {
      symbol,
      name,
      assetType: (args.assetType ?? "Stock").trim() || "Stock",
      quantity: String(args.quantity),
      buyPrice: String(args.buyPrice),
      currentPrice: String(args.currentPrice),
      portfolio: { connect: { id: portfolio.id } },
    },
  });
  return { id: investment.id };
};
