import { HttpError, prisma } from "wasp/server";
import { Prisma } from "@prisma/client";
import type {
  GetMarket,
  GetAsset,
  GetPortfolios,
  GetPortfolio,
  CreatePortfolio,
  BuyAsset,
  SellAsset,
} from "wasp/server/operations";
import type { Holding, Portfolio, Trade } from "wasp/entities";
import { requireAppAdded } from "../../world/requireApp";
import { isAssetClass, type AssetClassId } from "./assetClasses";
import { ASSETS, findAsset, type AssetDef } from "./market/catalog";
import { history, quote, type PricePoint } from "./market/prices";

const APP_ID = "portfolio";
const D = Prisma.Decimal;
type Dec = Prisma.Decimal;

// ---------------------------------------------------------------------------
// Shapes sent to the client. Money is stored and calculated as Decimal on the
// server; numbers are only used for display.
// ---------------------------------------------------------------------------

type AssetInfo = {
  symbol: string;
  name: string;
  assetClass: AssetClassId;
  unit: string;
  decimals: number;
};

export type QuoteView = AssetInfo & {
  price: number;
  change: number;
  changePct: number;
  /** Last 30 daily closes, oldest first. */
  sparkline: number[];
};

export type PositionView = {
  portfolioId: number;
  portfolioName: string;
  quantity: number;
  avgCost: number;
  costBasis: number;
  marketValue: number;
  gain: number;
  gainPct: number;
};

export type AssetDetail = QuoteView & {
  about: string;
  facts: [string, string][];
  supply: { label: string; amount: number } | null;
  marketCap: number | null;
  prevClose: number;
  dayHigh: number;
  dayLow: number;
  low52: number;
  high52: number;
  asOf: string;
  /** Last 365 daily closes, oldest first. */
  history: PricePoint[];
  /** The user's holdings of this asset, per portfolio. */
  positions: PositionView[];
  /** The user's portfolios, for the invest panel. */
  portfolios: { id: number; name: string; cash: number }[];
};

export type HoldingView = AssetInfo & {
  id: number;
  quantity: number;
  avgCost: number;
  price: number;
  changePct: number;
  costBasis: number;
  marketValue: number;
  gain: number;
  gainPct: number;
};

export type AllocationSlice = { key: AssetClassId | "cash"; value: number };

export type PortfolioSummary = {
  id: number;
  name: string;
  description: string | null;
  startingCash: number;
  cash: number;
  holdingsValue: number;
  totalValue: number;
  /** Total value minus starting cash: realized + unrealized. */
  totalReturn: number;
  totalReturnPct: number;
  unrealizedGain: number;
  holdingsCount: number;
  allocation: AllocationSlice[];
};

export type TradeView = {
  id: number;
  symbol: string;
  name: string;
  side: "BUY" | "SELL";
  quantity: number;
  price: number;
  total: number;
  realizedGain: number | null;
  createdAt: string;
};

export type PortfolioDetail = PortfolioSummary & { holdings: HoldingView[]; trades: TradeView[] };

const info = (a: AssetDef): AssetInfo => ({
  symbol: a.symbol, name: a.name, assetClass: a.assetClass, unit: a.unit, decimals: a.decimals,
});

function toQuoteView(a: AssetDef): QuoteView {
  const q = quote(a);
  return {
    ...info(a),
    price: q.price,
    change: q.change,
    changePct: q.changePct,
    sparkline: history(a, 30).map((p) => p.close),
  };
}

function toHolding(h: Holding): HoldingView | null {
  const asset = findAsset(h.symbol);
  if (!asset) return null; // asset removed from the catalog
  const q = quote(asset);
  const quantity = Number(h.quantity);
  const costBasis = Number(h.costBasis);
  const marketValue = quantity * q.price;
  const gain = marketValue - costBasis;
  return {
    ...info(asset),
    id: h.id,
    quantity,
    avgCost: quantity === 0 ? 0 : costBasis / quantity,
    price: q.price,
    changePct: q.changePct,
    costBasis,
    marketValue,
    gain,
    gainPct: costBasis === 0 ? 0 : (gain / costBasis) * 100,
  };
}

const CLASS_ORDER: AssetClassId[] = ["oil", "crypto", "stocks", "metals"];

function summarize(p: Portfolio, holdings: HoldingView[]): PortfolioSummary {
  const cash = Number(p.cash);
  const startingCash = Number(p.startingCash);
  const holdingsValue = holdings.reduce((s, h) => s + h.marketValue, 0);
  const costBasis = holdings.reduce((s, h) => s + h.costBasis, 0);
  const totalValue = cash + holdingsValue;
  const totalReturn = totalValue - startingCash;

  const byClass = new Map<AssetClassId, number>();
  for (const h of holdings) byClass.set(h.assetClass, (byClass.get(h.assetClass) ?? 0) + h.marketValue);
  const allocation: AllocationSlice[] = CLASS_ORDER.filter((c) => byClass.has(c)).map((c) => ({
    key: c,
    value: byClass.get(c)!,
  }));
  if (cash > 0) allocation.push({ key: "cash", value: cash });

  return {
    id: p.id,
    name: p.name,
    description: p.description,
    startingCash,
    cash,
    holdingsValue,
    totalValue,
    totalReturn,
    totalReturnPct: startingCash === 0 ? 0 : (totalReturn / startingCash) * 100,
    unrealizedGain: holdingsValue - costBasis,
    holdingsCount: holdings.length,
    allocation,
  };
}

function toTrade(t: Trade): TradeView {
  return {
    id: t.id,
    symbol: t.symbol,
    name: findAsset(t.symbol)?.name ?? t.symbol,
    side: t.side === "SELL" ? "SELL" : "BUY",
    quantity: Number(t.quantity),
    price: Number(t.price),
    total: Number(t.total),
    realizedGain: t.realizedGain === null ? null : Number(t.realizedGain),
    createdAt: t.createdAt.toISOString(),
  };
}

const views = (holdings: Holding[]) =>
  holdings.map(toHolding).filter((h): h is HoldingView => h !== null);

// ---------------------------------------------------------------------------
// Market queries (catalog data is shared, but still only for users who added the app)
// ---------------------------------------------------------------------------

export const getMarket: GetMarket<{ assetClass?: string }, QuoteView[]> = async (args, context) => {
  await requireAppAdded(context, APP_ID);
  const assetClass = (args ?? {}).assetClass;
  if (assetClass !== undefined && !isAssetClass(assetClass)) {
    throw new HttpError(400, "Unknown asset class");
  }
  return ASSETS.filter((a) => !assetClass || a.assetClass === assetClass).map(toQuoteView);
};

export const getAsset: GetAsset<{ symbol: string }, AssetDetail> = async ({ symbol }, context) => {
  const user = await requireAppAdded(context, APP_ID);
  const asset = findAsset(symbol);
  if (!asset) throw new HttpError(404, "Asset not found");

  const q = quote(asset);
  const year = history(asset, 365);
  const closes = year.map((p) => p.close);

  const portfolios = await context.entities.Portfolio.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "asc" },
    include: { holdings: { where: { symbol: asset.symbol } } },
  });

  const positions: PositionView[] = [];
  for (const p of portfolios) {
    const h = p.holdings[0] && toHolding(p.holdings[0]);
    if (h) {
      positions.push({
        portfolioId: p.id,
        portfolioName: p.name,
        quantity: h.quantity,
        avgCost: h.avgCost,
        costBasis: h.costBasis,
        marketValue: h.marketValue,
        gain: h.gain,
        gainPct: h.gainPct,
      });
    }
  }

  return {
    ...toQuoteView(asset),
    about: asset.about,
    facts: asset.facts,
    supply: asset.supply ?? null,
    marketCap: asset.supply ? asset.supply.amount * q.price : null,
    prevClose: q.prevClose,
    dayHigh: q.dayHigh,
    dayLow: q.dayLow,
    low52: Math.min(...closes),
    high52: Math.max(...closes),
    asOf: q.asOf,
    history: year,
    positions,
    portfolios: portfolios.map((p) => ({ id: p.id, name: p.name, cash: Number(p.cash) })),
  };
};

// ---------------------------------------------------------------------------
// Portfolio queries
// ---------------------------------------------------------------------------

export const getPortfolios: GetPortfolios<void, PortfolioSummary[]> = async (_args, context) => {
  const user = await requireAppAdded(context, APP_ID);
  const portfolios = await context.entities.Portfolio.findMany({
    where: { userId: user.id },
    include: { holdings: true },
    orderBy: { createdAt: "asc" },
  });
  return portfolios.map((p) => summarize(p, views(p.holdings)));
};

export const getPortfolio: GetPortfolio<{ id: number }, PortfolioDetail> = async ({ id }, context) => {
  const user = await requireAppAdded(context, APP_ID);
  // Ownership is part of the WHERE clause. Someone else's portfolio looks
  // exactly like a portfolio that doesn't exist (404, not 403), so we don't
  // leak which IDs exist.
  const portfolio = await context.entities.Portfolio.findFirst({
    where: { id, userId: user.id },
    include: {
      holdings: true,
      trades: { orderBy: { createdAt: "desc" }, take: 25 },
    },
  });
  if (!portfolio) throw new HttpError(404, "Portfolio not found");
  const holdings = views(portfolio.holdings).sort((a, b) => b.marketValue - a.marketValue);
  return { ...summarize(portfolio, holdings), holdings, trades: portfolio.trades.map(toTrade) };
};

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

const MIN_STARTING_CASH = 1_000;
const MAX_STARTING_CASH = 10_000_000;

export const createPortfolio: CreatePortfolio<
  { name: string; description?: string; startingCash?: number },
  { id: number }
> = async ({ name, description, startingCash }, context) => {
  const user = await requireAppAdded(context, APP_ID);
  const trimmed = (name ?? "").trim();
  if (!trimmed) throw new HttpError(400, "Give your portfolio a name.");
  if (trimmed.length > 80) throw new HttpError(400, "Keep the name under 80 characters.");
  const desc = (description ?? "").trim();
  if (desc.length > 200) throw new HttpError(400, "Keep the description under 200 characters.");

  const start = startingCash ?? 100_000;
  if (!Number.isFinite(start) || start < MIN_STARTING_CASH || start > MAX_STARTING_CASH) {
    throw new HttpError(400, "Starting cash must be between $1,000 and $10,000,000.");
  }
  const cash = new D(start).toDecimalPlaces(2);

  const portfolio = await context.entities.Portfolio.create({
    data: {
      name: trimmed,
      description: desc || null,
      startingCash: cash,
      cash,
      user: { connect: { id: user.id } },
    },
  });
  return { id: portfolio.id };
};

export type TradeResult = { tradeId: number; quantity: number; price: number; total: number; cash: number };

const usd = (d: Dec) =>
  d.toNumber().toLocaleString("en-US", { style: "currency", currency: "USD" });

function positive(value: unknown, field: string): Dec {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new HttpError(400, `${field} must be a positive number.`);
  }
  return new D(value);
}

function tradeTarget(args: { portfolioId?: unknown; symbol?: unknown }) {
  if (!Number.isInteger(args.portfolioId)) throw new HttpError(400, "Choose a portfolio.");
  const asset = findAsset(args.symbol);
  if (!asset) throw new HttpError(404, "Asset not found");
  // The price always comes from the server's market data, never from the client.
  const price = new D(quote(asset).price.toFixed(asset.decimals));
  return { portfolioId: args.portfolioId as number, asset, price };
}

type Tx = Prisma.TransactionClient;

/**
 * Locks the portfolio row for the rest of the transaction, so two trades on
 * the same portfolio can't both spend the same cash. Ownership is part of the
 * WHERE clause: someone else's portfolio is "not found".
 */
async function lockOwnPortfolio(tx: Tx, portfolioId: number, userId: number) {
  const rows = await tx.$queryRaw<{ id: number; cash: unknown }[]>`
    SELECT "id", "cash" FROM "Portfolio"
    WHERE "id" = ${portfolioId} AND "userId" = ${userId}
    FOR UPDATE`;
  if (rows.length === 0) throw new HttpError(404, "Portfolio not found");
  return { id: rows[0].id, cash: new D(String(rows[0].cash)) };
}

export const buyAsset: BuyAsset<
  { portfolioId: number; symbol: string; amount?: number; quantity?: number },
  TradeResult
> = async (args, context) => {
  const user = await requireAppAdded(context, APP_ID);
  const { portfolioId, asset, price } = tradeTarget(args);

  if ((args.amount === undefined) === (args.quantity === undefined)) {
    throw new HttpError(400, "Enter either an amount in dollars or a quantity.");
  }
  const quantity =
    args.quantity !== undefined
      ? positive(args.quantity, "Quantity").toDecimalPlaces(8, D.ROUND_DOWN)
      : positive(args.amount, "Amount").div(price).toDecimalPlaces(8, D.ROUND_DOWN);
  const total = quantity.mul(price).toDecimalPlaces(2, D.ROUND_HALF_UP);
  if (quantity.lte(0) || total.lt("0.01")) {
    throw new HttpError(400, "That's too small to buy. Try a larger amount.");
  }

  return prisma.$transaction(async (tx) => {
    const portfolio = await lockOwnPortfolio(tx, portfolioId, user.id);
    if (portfolio.cash.lt(total)) {
      throw new HttpError(400, `Not enough cash. This costs ${usd(total)} and you have ${usd(portfolio.cash)}.`);
    }
    const updated = await tx.portfolio.update({
      where: { id: portfolio.id },
      data: { cash: { decrement: total } },
    });
    await tx.holding.upsert({
      where: { portfolioId_symbol: { portfolioId: portfolio.id, symbol: asset.symbol } },
      create: { portfolioId: portfolio.id, symbol: asset.symbol, quantity, costBasis: total },
      update: { quantity: { increment: quantity }, costBasis: { increment: total } },
    });
    const trade = await tx.trade.create({
      data: { portfolioId: portfolio.id, symbol: asset.symbol, side: "BUY", quantity, price, total },
    });
    return {
      tradeId: trade.id,
      quantity: quantity.toNumber(),
      price: price.toNumber(),
      total: total.toNumber(),
      cash: Number(updated.cash),
    };
  });
};

export const sellAsset: SellAsset<
  { portfolioId: number; symbol: string; quantity?: number; all?: boolean },
  TradeResult & { realizedGain: number }
> = async (args, context) => {
  const user = await requireAppAdded(context, APP_ID);
  const { portfolioId, asset, price } = tradeTarget(args);
  const sellAll = args.all === true;
  if (!sellAll && args.quantity === undefined) throw new HttpError(400, "Enter a quantity to sell.");
  const requested = sellAll ? null : positive(args.quantity, "Quantity").toDecimalPlaces(8, D.ROUND_DOWN);

  return prisma.$transaction(async (tx) => {
    const portfolio = await lockOwnPortfolio(tx, portfolioId, user.id);
    // Scoped to a portfolio we just verified belongs to this user.
    const holding = await tx.holding.findUnique({
      where: { portfolioId_symbol: { portfolioId: portfolio.id, symbol: asset.symbol } },
    });
    if (!holding) throw new HttpError(400, `This portfolio doesn't hold any ${asset.name}.`);

    const held = new D(holding.quantity.toString());
    const costBasis = new D(holding.costBasis.toString());
    const quantity = requested ?? held;
    if (quantity.lte(0)) throw new HttpError(400, "Quantity must be a positive number.");
    if (quantity.gt(held)) {
      throw new HttpError(400, `You only have ${held.toNumber()} ${asset.symbol} to sell.`);
    }
    const total = quantity.mul(price).toDecimalPlaces(2, D.ROUND_HALF_UP);
    if (total.lt("0.01")) throw new HttpError(400, "That's too small to sell. Try a larger quantity.");

    const closing = quantity.eq(held);
    const costSold = closing ? costBasis : costBasis.mul(quantity).div(held).toDecimalPlaces(4, D.ROUND_HALF_UP);
    const realizedGain = total.minus(costSold);

    if (closing) {
      await tx.holding.delete({ where: { id: holding.id } });
    } else {
      await tx.holding.update({
        where: { id: holding.id },
        data: { quantity: held.minus(quantity), costBasis: costBasis.minus(costSold) },
      });
    }
    const updated = await tx.portfolio.update({
      where: { id: portfolio.id },
      data: { cash: { increment: total } },
    });
    const trade = await tx.trade.create({
      data: { portfolioId: portfolio.id, symbol: asset.symbol, side: "SELL", quantity, price, total, realizedGain },
    });
    return {
      tradeId: trade.id,
      quantity: quantity.toNumber(),
      price: price.toNumber(),
      total: total.toNumber(),
      cash: Number(updated.cash),
      realizedGain: realizedGain.toNumber(),
    };
  });
};
