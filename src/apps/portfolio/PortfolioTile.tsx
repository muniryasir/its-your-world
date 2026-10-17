import { getPortfolios, useQuery } from "wasp/client/operations";
import { gainClass, money, signedMoney, signedPct } from "./format";

/**
 * Summary shown on the user's hub. Keep it small: a few numbers, no actions.
 * Rendered inside the shell's dark tile, so it uses light text.
 */
export function PortfolioTile() {
  const { data, isLoading, error } = useQuery(getPortfolios);
  if (isLoading) return <p className="tile-muted">Loading…</p>;
  if (error || !data) return <p className="tile-muted">Couldn't load your portfolios.</p>;

  const value = data.reduce((s, p) => s + p.totalValue, 0);
  const started = data.reduce((s, p) => s + p.startingCash, 0);
  const gain = value - started;
  const holdings = data.reduce((s, p) => s + p.holdingsCount, 0);

  if (holdings === 0) {
    return (
      <p className="tile-muted">
        {money(data.reduce((s, p) => s + p.cash, 0))} of demo cash, nothing invested yet. Open it to explore the markets.
      </p>
    );
  }

  return (
    <div className="tile-stats">
      <div>
        <span className="tile-label">Total value</span>
        <span className="tile-value">{money(value)}</span>
      </div>
      <div>
        <span className="tile-label">Return</span>
        <span className={`tile-value tile-value--sm tile-${gainClass(gain)}`}>
          {signedMoney(gain)} <small>{signedPct(started === 0 ? 0 : (gain / started) * 100)}</small>
        </span>
      </div>
      <div>
        <span className="tile-label">Portfolios</span>
        <span className="tile-value tile-value--sm">{data.length}</span>
      </div>
    </div>
  );
}
