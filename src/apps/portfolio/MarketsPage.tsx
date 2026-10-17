import { useNavigate, useSearchParams } from "react-router";
import { Link } from "wasp/client/router";
import { getMarket, useQuery } from "wasp/client/operations";
import { ASSET_CLASSES, isAssetClass, type AssetClassId } from "./assetClasses";
import { Sparkline } from "./charts";
import { gainClass, perUnit, price, signedPct } from "./format";
import "./portfolio.css";

export function MarketsPage() {
  return (
    <div className="pf">
      <MarketsPageContent />
    </div>
  );
}

function MarketsPageContent() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const raw = params.get("class");
  const active: AssetClassId = isAssetClass(raw) ? raw : "oil";
  const activeClass = ASSET_CLASSES.find((c) => c.id === active)!;

  const { data: quotes, isLoading, error } = useQuery(getMarket, { assetClass: active });

  return (
    <div className="markets">
      <Link to="/portfolio" className="backlink">← Portfolios</Link>
      <div className="page-head">
        <div>
          <h1>Markets</h1>
          <p className="muted">Pick an asset to see its details and invest your demo cash.</p>
        </div>
        <DemoBadge />
      </div>

      <div className="tabs" role="tablist" aria-label="Asset classes">
        {ASSET_CLASSES.map((c) => (
          <button
            key={c.id}
            role="tab"
            aria-selected={c.id === active}
            className={`tab tab--${c.id}`}
            onClick={() => setParams({ class: c.id }, { replace: true })}
          >
            <span className="tab-dot" aria-hidden />
            {c.name}
          </button>
        ))}
      </div>

      <section className="panel" role="tabpanel" aria-label={activeClass.name}>
        <div className="panel-head">
          <div>
            <h2>Top 10 · {activeClass.name}</h2>
            <p className="muted small panel-sub">{activeClass.blurb}</p>
          </div>
        </div>

        {isLoading && <p className="muted empty-row">Loading prices…</p>}
        {error && <p className="error empty-row">Couldn't load prices: {error.message}</p>}
        {quotes && (
          <div className="table-wrap">
            <table className="data-table market-table">
              <thead>
                <tr>
                  <th className="rank">#</th>
                  <th>Asset</th>
                  <th className="r">Price</th>
                  <th className="r">1 day</th>
                  <th className="r hide-sm">30 days</th>
                </tr>
              </thead>
              <tbody>
                {quotes.map((q, i) => (
                  <tr key={q.symbol} className="row-link" onClick={() => navigate(`/portfolio/markets/${encodeURIComponent(q.symbol)}`)}>
                    <td className="rank muted num">{i + 1}</td>
                    <td>
                      <Link
                        to="/portfolio/markets/:symbol"
                        params={{ symbol: q.symbol }}
                        className="asset-link"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {q.name}
                      </Link>
                      <div className="muted small">{q.symbol}</div>
                    </td>
                    <td className="r num">
                      {price(q.price, q.decimals)}
                      <div className="muted small">{perUnit(q.unit)}</div>
                    </td>
                    <td className={`r num ${gainClass(q.changePct)}`}>{signedPct(q.changePct)}</td>
                    <td className="r hide-sm"><Sparkline values={q.sparkline} /></td>
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

export function DemoBadge() {
  return (
    <span className="demo-badge" title="Prices are simulated for this demo and change once a day. They are not real market data.">
      Demo prices · updated daily
    </span>
  );
}
