// Simulated (DEMO) market prices.
//
// Each asset follows a deterministic, mean-reverting random walk around its
// base price: one new closing price per UTC day. The same day always gives
// the same price, on every server and in every test run, and nothing has to
// be stored. Replace this module with a live data source later.
import type { AssetDef } from "./catalog";

const DAY_MS = 86_400_000;
/** Day 0 of the simulation: 2025-01-01 UTC. */
const ANCHOR_DAY = Math.floor(Date.UTC(2025, 0, 1) / DAY_MS);
/** How strongly prices are pulled back towards the base price each day. */
const REVERSION = 0.015;

export const dayIndex = (date: Date = new Date()) => Math.floor(date.getTime() / DAY_MS);
export const dayToISO = (day: number) => new Date(day * DAY_MS).toISOString().slice(0, 10);

// FNV-1a hash -> uniform number in (0, 1).
function uniform(key: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return ((h >>> 0) + 0.5) / 4294967296;
}

// Standard normal from two hashed uniforms (Box-Muller).
function normal(symbol: string, day: number, k: number): number {
  const u1 = uniform(`${symbol}|${day}|${k}|a`);
  const u2 = uniform(`${symbol}|${day}|${k}|b`);
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

// Log-deviation from the base price, per day since the anchor. Cached per asset.
const walks = new Map<string, number[]>();

function deviation(asset: AssetDef, day: number): number {
  const i = day - ANCHOR_DAY;
  if (i <= 0) return 0;
  let walk = walks.get(asset.symbol);
  if (!walk) {
    walk = [0];
    walks.set(asset.symbol, walk);
  }
  for (let d = walk.length; d <= i; d++) {
    const z = normal(asset.symbol, ANCHOR_DAY + d, 0);
    walk.push(walk[d - 1] * (1 - REVERSION) + asset.volatility * z);
  }
  return walk[i];
}

const round = (n: number, decimals: number) => {
  const f = 10 ** decimals;
  return Math.round(n * f) / f;
};

/** Closing price of an asset on a given day. */
export function closeOn(asset: AssetDef, day: number): number {
  return round(asset.basePrice * Math.exp(deviation(asset, day)), asset.decimals);
}

export type Quote = {
  price: number;
  prevClose: number;
  change: number;
  changePct: number;
  dayHigh: number;
  dayLow: number;
  asOf: string;
};

/** Today's price and move. "Today" is the current UTC day unless given. */
export function quote(asset: AssetDef, day: number = dayIndex()): Quote {
  const price = closeOn(asset, day);
  const prevClose = closeOn(asset, day - 1);
  const wick = (k: number) => Math.abs(normal(asset.symbol, day, k)) * asset.volatility * 0.4;
  const change = price - prevClose;
  return {
    price,
    prevClose,
    change: round(change, asset.decimals),
    changePct: prevClose === 0 ? 0 : (change / prevClose) * 100,
    dayHigh: round(Math.max(price, prevClose) * (1 + wick(1)), asset.decimals),
    dayLow: round(Math.min(price, prevClose) * (1 - wick(2)), asset.decimals),
    asOf: dayToISO(day),
  };
}

export type PricePoint = { date: string; close: number };

/** Daily closes for the last `days` days, oldest first, ending today. */
export function history(asset: AssetDef, days: number, day: number = dayIndex()): PricePoint[] {
  const out: PricePoint[] = [];
  for (let d = day - days + 1; d <= day; d++) out.push({ date: dayToISO(d), close: closeOn(asset, d) });
  return out;
}
