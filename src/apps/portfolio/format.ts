const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const usdCompact = new Intl.NumberFormat("en-US", {
  style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 2,
});
const qty = new Intl.NumberFormat("en-US", { maximumFractionDigits: 8 });
const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 });

export const money = (n: number) => usd.format(n);
export const compactMoney = (n: number) => usdCompact.format(n);
export const compactNumber = (n: number) => compact.format(n);
export const quantity = (n: number) => qty.format(n);

/** A market price, with the asset's own number of decimals. */
export const price = (n: number, decimals = 2) =>
  new Intl.NumberFormat("en-US", {
    style: "currency", currency: "USD", minimumFractionDigits: decimals, maximumFractionDigits: decimals,
  }).format(n);

export const signedMoney = (n: number) => (n >= 0 ? "+" : "−") + usd.format(Math.abs(n));
export const signedPct = (n: number) => (n >= 0 ? "+" : "−") + Math.abs(n).toFixed(2) + "%";
export const pct = (n: number) => n.toFixed(1) + "%";

export const gainClass = (n: number) => (n > 0 ? "pos" : n < 0 ? "neg" : "flat");

export const perUnit = (unit: string) => `per ${unit}`;

export const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
