import { Link as RouterLink, useNavigate, useParams } from "react-router";
import { Link } from "wasp/client/router";
import { getPortfolio, useQuery } from "wasp/client/operations";
import { ASSET_CLASSES, assetClassName } from "./assetClasses";
import { AllocationBar } from "./charts";
import type { PortfolioDetail } from "./operations";
import { gainClass, money, price, quantity, shortDate, signedMoney, signedPct } from "./format";
import "./portfolio.css";

export function PortfolioDetailPage() {
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
        <Link to="/portfolio" className="btn btn--primary">Back to portfolios</Link>
      </div>
    );
  }
  if (isLoading) return <p className="muted">Loading portfolio…</p>;
  if (error || !portfolio) return <p className="error">Couldn't load portfolio: {error?.message}</p>;

  return (
    <div className="portfolio">
      <Link to="/portfolio" className="backlink">← All portfolios</Link>

      <div className="page-head">
        <div>
          <h1>{portfolio.name}</h1>
          {portfolio.description && <p className="muted">{portfolio.description}</p>}
        </div>
        <Link to="/portfolio/markets" className="btn btn--primary">Invest</Link>
      </div>

      <section className="stats">
        <div className="stat">
          <span className="stat-label">Total value</span>
          <span className="stat-value num">{money(portfolio.totalValue)}</span>
          <span className="muted small num">Started with {money(portfolio.startingCash)}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Total return</span>
          <span className={`stat-value num ${gainClass(portfolio.totalReturn)}`}>
            {signedMoney(portfolio.totalReturn)} <small>{signedPct(portfolio.totalReturnPct)}</small>
          </span>
          <span className="muted small">Realized and unrealized</span>
        </div>
        <div className="stat">
          <span className="stat-label">Invested</span>
          <span className="stat-value num">{money(portfolio.holdingsValue)}</span>
          <span className={`small num ${gainClass(portfolio.unrealizedGain)}`}>{signedMoney(portfolio.unrealizedGain)} unrealized</span>
        </div>
        <div className="stat">
          <span className="stat-label">Cash</span>
          <span className="stat-value num">{money(portfolio.cash)}</span>
          <span className="muted small">Demo cash, ready to invest</span>
        </div>
      </section>

      {portfolio.holdings.length > 0 && (
        <section className="panel alloc-panel">
          <div className="panel-head"><h2>Allocation</h2></div>
          <div className="alloc-body"><AllocationBar slices={portfolio.allocation} /></div>
        </section>
      )}

      <section className="panel">
        <div className="panel-head">
          <h2>Holdings</h2>
          {portfolio.holdings.length > 0 && <span className="muted small">{portfolio.holdings.length} assets</span>}
        </div>
        {portfolio.holdings.length === 0 ? <EmptyHoldings portfolio={portfolio} /> : <HoldingsTable portfolio={portfolio} />}
      </section>

      {portfolio.trades.length > 0 && <TradesTable portfolio={portfolio} />}
    </div>
  );
}

function EmptyHoldings({ portfolio }: { portfolio: PortfolioDetail }) {
  return (
    <div className="empty-holdings">
      <p>
        <strong>Nothing invested yet.</strong> You have {money(portfolio.cash)} of demo cash. Pick a market to start:
      </p>
      <div className="class-links">
        {ASSET_CLASSES.map((c) => (
          <RouterLink key={c.id} to={`/portfolio/markets?class=${c.id}`} className={`class-link class-link--${c.id}`}>
            <span className="tab-dot" aria-hidden />
            <strong>{c.name}</strong>
            <span className="muted small">{c.blurb}</span>
          </RouterLink>
        ))}
      </div>
    </div>
  );
}

function HoldingsTable({ portfolio }: { portfolio: PortfolioDetail }) {
  const navigate = useNavigate();
  const total = portfolio.totalValue || 1;
  return (
    <div className="table-wrap">
      <table className="data-table holdings">
        <thead>
          <tr>
            <th>Asset</th>
            <th className="hide-sm">Class</th>
            <th className="r">Quantity</th>
            <th className="r hide-sm">Avg cost</th>
            <th className="r">Price</th>
            <th className="r">Value</th>
            <th className="r">Gain / loss</th>
          </tr>
        </thead>
        <tbody>
          {portfolio.holdings.map((h) => (
            <tr key={h.id} className="row-link" onClick={() => navigate(`/portfolio/markets/${encodeURIComponent(h.symbol)}`)}>
              <td>
                <Link to="/portfolio/markets/:symbol" params={{ symbol: h.symbol }} className="asset-link" onClick={(e) => e.stopPropagation()}>
                  {h.name}
                </Link>
                <div className="muted small">{h.symbol}</div>
              </td>
              <td className="hide-sm"><span className={`pill pill--${h.assetClass}`}>{assetClassName(h.assetClass)}</span></td>
              <td className="r num">{quantity(Number(h.quantity.toFixed(6)))}</td>
              <td className="r num hide-sm">{price(h.avgCost, h.decimals)}</td>
              <td className="r num">
                {price(h.price, h.decimals)}
                <div className={`small ${gainClass(h.changePct)}`}>{signedPct(h.changePct)} today</div>
              </td>
              <td className="r num">
                {money(h.marketValue)}
                <div className="muted small">{((h.marketValue / total) * 100).toFixed(1)}% of total</div>
              </td>
              <td className={`r num ${gainClass(h.gain)}`}>
                {signedMoney(h.gain)}
                <div className="small">{signedPct(h.gainPct)}</div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TradesTable({ portfolio }: { portfolio: PortfolioDetail }) {
  return (
    <section className="panel trades-panel">
      <div className="panel-head"><h2>Recent activity</h2></div>
      <div className="table-wrap">
        <table className="data-table trades">
          <thead>
            <tr>
              <th>Date</th>
              <th>Trade</th>
              <th className="r">Quantity</th>
              <th className="r hide-sm">Price</th>
              <th className="r">Total</th>
              <th className="r hide-sm">Realized</th>
            </tr>
          </thead>
          <tbody>
            {portfolio.trades.map((t) => (
              <tr key={t.id}>
                <td className="muted num">{shortDate(t.createdAt)}</td>
                <td>
                  <span className={`side side--${t.side.toLowerCase()}`}>{t.side === "BUY" ? "Buy" : "Sell"}</span> {t.name}
                </td>
                <td className="r num">{quantity(Number(t.quantity.toFixed(6)))}</td>
                <td className="r num hide-sm">{money(t.price)}</td>
                <td className="r num">{money(t.total)}</td>
                <td className={`r num hide-sm ${t.realizedGain === null ? "muted" : gainClass(t.realizedGain)}`}>
                  {t.realizedGain === null ? "—" : signedMoney(t.realizedGain)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
