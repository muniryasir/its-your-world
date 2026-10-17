import { useState, type FormEvent } from "react";
import { useParams } from "react-router";
import { Link } from "wasp/client/router";
import { createInvestment, getPortfolio, useQuery } from "wasp/client/operations";
import type { HoldingView } from "./operations";
import { gainClass, money, quantity, signedMoney, signedPct } from "./format";

export function PortfolioPage() {
  const params = useParams();
  const id = Number(params.id);
  const { data: portfolio, isLoading, error } = useQuery(
    getPortfolio,
    { id },
    { enabled: Number.isInteger(id), retry: false },
  );

  if (!Number.isInteger(id) || (error && (error as any).statusCode === 404)) {
    return (
      <div className="empty-state">
        <h1>Portfolio not found</h1>
        <p className="muted">It doesn't exist, or it isn't yours.</p>
        <Link to="/dashboard" className="btn btn--primary">Back to portfolios</Link>
      </div>
    );
  }
  if (isLoading) return <p className="muted">Loading portfolio…</p>;
  if (error || !portfolio) return <p className="error">Couldn't load portfolio: {error?.message}</p>;

  return (
    <div className="portfolio">
      <Link to="/dashboard" className="backlink">← All portfolios</Link>

      <div className="page-head">
        <div>
          <p className="eyebrow">Portfolio</p>
          <h1>{portfolio.name}</h1>
          {portfolio.description && <p className="muted">{portfolio.description}</p>}
        </div>
      </div>

      <section className="stats">
        <div className="stat">
          <span className="stat-label">Market value</span>
          <span className="stat-value num">{money(portfolio.marketValue)}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Cost basis</span>
          <span className="stat-value num">{money(portfolio.costBasis)}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Gain / loss</span>
          <span className={`stat-value num ${gainClass(portfolio.gain)}`}>
            {signedMoney(portfolio.gain)} <small>{signedPct(portfolio.gainPct)}</small>
          </span>
        </div>
      </section>

      {portfolio.holdings.length > 0 && <AllocationBar holdings={portfolio.holdings} total={portfolio.marketValue} />}

      <section className="panel">
        <div className="panel-head">
          <h2>Holdings</h2>
          <AddInvestment portfolioId={portfolio.id} />
        </div>

        {portfolio.holdings.length === 0 ? (
          <p className="muted empty-row">No holdings yet. Add your first investment.</p>
        ) : (
          <div className="table-wrap">
            <table className="holdings">
              <thead>
                <tr>
                  <th>Symbol</th>
                  <th>Type</th>
                  <th className="r">Qty</th>
                  <th className="r">Buy price</th>
                  <th className="r">Current</th>
                  <th className="r">Value</th>
                  <th className="r">Gain / loss</th>
                </tr>
              </thead>
              <tbody>
                {portfolio.holdings.map((h) => (
                  <tr key={h.id}>
                    <td>
                      <strong>{h.symbol}</strong>
                      <div className="muted small">{h.name}</div>
                    </td>
                    <td><span className="pill">{h.assetType}</span></td>
                    <td className="r num">{quantity(h.quantity)}</td>
                    <td className="r num">{money(h.buyPrice)}</td>
                    <td className="r num">{money(h.currentPrice)}</td>
                    <td className="r num">{money(h.marketValue)}</td>
                    <td className={`r num ${gainClass(h.gain)}`}>
                      {signedMoney(h.gain)}
                      <div className="small">{signedPct(h.gainPct)}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

const TYPE_COLORS: Record<string, string> = {
  Stock: "var(--c-stock)",
  ETF: "var(--c-etf)",
  Crypto: "var(--c-crypto)",
  Bond: "var(--c-bond)",
};

function AllocationBar({ holdings, total }: { holdings: HoldingView[]; total: number }) {
  const byType = new Map<string, number>();
  for (const h of holdings) byType.set(h.assetType, (byType.get(h.assetType) ?? 0) + h.marketValue);
  const parts = [...byType.entries()].sort((a, b) => b[1] - a[1]);

  return (
    <section className="allocation" aria-label="Allocation by asset type">
      <div className="alloc-bar">
        {parts.map(([type, value]) => (
          <span
            key={type}
            style={{ width: `${(value / total) * 100}%`, background: TYPE_COLORS[type] ?? "var(--c-other)" }}
            title={`${type}: ${money(value)}`}
          />
        ))}
      </div>
      <ul className="alloc-legend">
        {parts.map(([type, value]) => (
          <li key={type}>
            <span className="swatch" style={{ background: TYPE_COLORS[type] ?? "var(--c-other)" }} />
            {type} <span className="muted num">{((value / total) * 100).toFixed(1)}%</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

const EMPTY = { symbol: "", name: "", assetType: "Stock", quantity: "", buyPrice: "", currentPrice: "" };

function AddInvestment({ portfolioId }: { portfolioId: number }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const set = (key: keyof typeof EMPTY) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await createInvestment({
        portfolioId,
        symbol: form.symbol,
        name: form.name,
        assetType: form.assetType,
        quantity: Number(form.quantity),
        buyPrice: Number(form.buyPrice),
        currentPrice: Number(form.currentPrice),
      });
      setForm(EMPTY);
      setOpen(false);
    } catch (err: any) {
      setError(err?.message ?? "Something went wrong");
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return <button className="btn btn--primary" onClick={() => setOpen(true)}>+ Add investment</button>;
  }

  return (
    <form className="invest-form" onSubmit={onSubmit}>
      <label>Symbol<input value={form.symbol} onChange={set("symbol")} required placeholder="AAPL" autoFocus /></label>
      <label>Name<input value={form.name} onChange={set("name")} required placeholder="Apple Inc." /></label>
      <label>
        Type
        <select value={form.assetType} onChange={set("assetType")}>
          <option>Stock</option>
          <option>ETF</option>
          <option>Crypto</option>
          <option>Bond</option>
        </select>
      </label>
      <label>Quantity<input type="number" step="any" min="0" value={form.quantity} onChange={set("quantity")} required /></label>
      <label>Buy price<input type="number" step="any" min="0" value={form.buyPrice} onChange={set("buyPrice")} required /></label>
      <label>Current price<input type="number" step="any" min="0" value={form.currentPrice} onChange={set("currentPrice")} required /></label>
      {error && <p className="error full">{error}</p>}
      <div className="form-actions full">
        <button type="button" className="btn btn--ghost" onClick={() => { setOpen(false); setError(null); }}>Cancel</button>
        <button type="submit" className="btn btn--primary" disabled={saving}>{saving ? "Saving…" : "Add"}</button>
      </div>
    </form>
  );
}
