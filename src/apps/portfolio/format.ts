const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const qty = new Intl.NumberFormat("en-US", { maximumFractionDigits: 8 });

export const money = (n: number) => usd.format(n);
export const quantity = (n: number) => qty.format(n);

export const signedMoney = (n: number) => (n >= 0 ? "+" : "−") + usd.format(Math.abs(n));
export const signedPct = (n: number) => (n >= 0 ? "+" : "−") + Math.abs(n).toFixed(2) + "%";

export const gainClass = (n: number) => (n > 0 ? "pos" : n < 0 ? "neg" : "flat");
