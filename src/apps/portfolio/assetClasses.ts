// The four asset classes users can invest in. Plain data, safe to import on
// both the client and the server.

export const ASSET_CLASSES = [
  { id: "oil", name: "Oil & Energy", short: "Oil", blurb: "Crude benchmarks, natural gas and refined fuels." },
  { id: "crypto", name: "Crypto", short: "Crypto", blurb: "The ten largest non-stablecoin cryptocurrencies." },
  { id: "stocks", name: "US Stocks", short: "Stocks", blurb: "Ten of the largest companies listed in the US." },
  { id: "metals", name: "Metals", short: "Metals", blurb: "Precious metals and the main industrial metals." },
] as const;

export type AssetClassId = (typeof ASSET_CLASSES)[number]["id"];

export const isAssetClass = (v: unknown): v is AssetClassId =>
  ASSET_CLASSES.some((c) => c.id === v);

export const assetClassName = (id: string) =>
  ASSET_CLASSES.find((c) => c.id === id)?.name ?? id;

// Allocation colors, in a fixed order. The actual values live in
// portfolio.css (--pf-oil, ...), checked for color-blind separation on the
// dark surface. Cash is a deliberate neutral: it's what's left, not a class.
export const CLASS_COLORS: Record<AssetClassId | "cash", string> = {
  oil: "var(--pf-oil)",
  crypto: "var(--pf-crypto)",
  stocks: "var(--pf-stocks)",
  metals: "var(--pf-metals)",
  cash: "var(--pf-cash)",
};
