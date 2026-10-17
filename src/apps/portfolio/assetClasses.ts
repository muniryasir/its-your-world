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

// Allocation colors, in a fixed order (checked for color-blind separation).
// Cash is a deliberate neutral: it's what's left, not an asset class.
export const CLASS_COLORS: Record<AssetClassId | "cash", string> = {
  oil: "#eb6834",
  crypto: "#1baf7a",
  stocks: "#2a78d6",
  metals: "#eda100",
  cash: "#9aa3b2",
};
