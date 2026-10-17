import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link as RouterLink, useParams } from "react-router";
import { Link } from "wasp/client/router";
import { buyAsset, getAsset, sellAsset, useQuery } from "wasp/client/operations";
import { assetClassName } from "./assetClasses";
import { PriceChart } from "./charts";
import { DemoBadge } from "./MarketsPage";
import type { AssetDetail } from "./operations";
import {
  compactMoney, compactNumber, gainClass, money, perUnit, price, quantity, signedMoney, signedPct,
} from "./format";
import "./portfolio.css";

const RANGES = [
  { label: "1M", days: 30 },
  { label: "3M", days: 90 },
  { label: "6M", days: 180 },
  { label: "1Y", days: 365 },
] as const;

export function AssetPage() {
  const { symbol = "" } = useParams();
  const { data: asset, isLoading, error } = useQuery(getAsset, { symbol }, { retry: false });

  if (error && (error as any).statusCode === 404) {
    return (
      <div className="empty-state">
        <h1>Asset not found</h1>
        <p className="muted">We don't have “{symbol}” in the market list.</p>
        <Link to="/portfolio/markets" className="btn btn--primary">Back to markets</Link>
      </div>
    );
  }
  if (isLoading) return <p className="muted">Loading {symbol}…</p>;
  if (error || !asset) return <p className="error">Couldn't load this asset: {error?.message}</p>;

  return <AssetView asset={asset} />;
}

function AssetView({ asset }: { asset: AssetDetail }) {
  const [range, setRange] = useState<(typeof RANGES)[number]>(RANGES[3]);
  const points = asset.history.slice(-range.days);
  const rangeChange = points.length > 1 ? points[points.length - 1].close - points[0].close : 0;
  const rangePct = points.length > 1 ? (rangeChange / points[0].close) * 100 : 0;
  const d = asset.decimals;

  return (
    <div className="asset">
      <RouterLink to={`/portfolio/markets?class=${asset.assetClass}`} className="backlink">← {assetClassName(asset.assetClass)}</RouterLink>

      <header className="asset-head">
        <div>
          <div className="asset-tags">
            <span className={`pill pill--${asset.assetClass}`}>{assetClassName(asset.assetClass)}</span>
            <span className="muted small">{asset.symbol}</span>
          </div>
          <h1>{asset.name}</h1>
        </div>
        <div className="asset-price">
          <span className="asset-price-value num">{price(asset.price, d)}</span>
          <span className="muted small">{perUnit(asset.unit)}</span>
          <span className={`num ${gainClass(asset.change)}`}>
            {asset.change >= 0 ? "+" : "−"}{price(Math.abs(asset.change), d)} ({signedPct(asset.changePct)}) today
          </span>
        </div>
      </header>

      <div className="asset-grid">
        <section className="panel asset-chart">
          <div className="panel-head">
            <div>
              <h2>Price</h2>
              <p className={`small num panel-sub ${gainClass(rangeChange)}`}>
                {signedPct(rangePct)} over {range.label === "1Y" ? "the past year" : `the past ${range.days} days`}
              </p>
            </div>
            <div className="segmented" role="group" aria-label="Chart range">
              {RANGES.map((r) => (
                <button key={r.label} aria-pressed={r.label === range.label} onClick={() => setRange(r)}>
                  {r.label}
                </button>
              ))}
            </div>
          </div>
          <PriceChart points={points} decimals={d} label={`${asset.name} price`} />
          <p className="chart-foot"><DemoBadge /> Last close {asset.asOf} (UTC).</p>
        </section>

        <aside className="asset-side">
          <InvestPanel asset={asset} />
          <PositionsCard asset={asset} />
        </aside>

        <section className="panel asset-stats">
          <div className="panel-head"><h2>Key stats</h2></div>
          <dl className="stat-list">
            <div><dt>Previous close</dt><dd className="num">{price(asset.prevClose, d)}</dd></div>
            <div><dt>Day range</dt><dd className="num">{price(asset.dayLow, d)} – {price(asset.dayHigh, d)}</dd></div>
            <div><dt>52-week range</dt><dd className="num">{price(asset.low52, d)} – {price(asset.high52, d)}</dd></div>
            {asset.marketCap !== null && (
              <div><dt>Market cap</dt><dd className="num">{compactMoney(asset.marketCap)}</dd></div>
            )}
            {asset.supply && (
              <div><dt>{asset.supply.label}</dt><dd className="num">{compactNumber(asset.supply.amount)}</dd></div>
            )}
            <div><dt>Quoted</dt><dd>USD {perUnit(asset.unit)}</dd></div>
            {asset.facts.map(([label, value]) => (
              <div key={label}><dt>{label}</dt><dd>{value}</dd></div>
            ))}
          </dl>
        </section>

        <section className="panel asset-about">
          <div className="panel-head"><h2>About {asset.name}</h2></div>
          <p className="about-text">{asset.about}</p>
        </section>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Your position
// ---------------------------------------------------------------------------
function PositionsCard({ asset }: { asset: AssetDetail }) {
  if (asset.positions.length === 0) return null;
  const total = asset.positions.reduce(
    (s, p) => ({ q: s.q + p.quantity, v: s.v + p.marketValue, c: s.c + p.costBasis }),
    { q: 0, v: 0, c: 0 },
  );
  const gain = total.v - total.c;
  return (
    <section className="panel position-card">
      <div className="panel-head"><h2>Your position</h2></div>
      <div className="position-body">
        <div className="position-main">
          <span className="stat-value num">{money(total.v)}</span>
          <span className="muted small num">{quantity(total.q)} {asset.symbol} · avg cost {price(total.c / total.q, asset.decimals)}</span>
          <span className={`num ${gainClass(gain)}`}>{signedMoney(gain)} ({signedPct(total.c ? (gain / total.c) * 100 : 0)})</span>
        </div>
        {asset.positions.length > 1 && (
          <ul className="position-list">
            {asset.positions.map((p) => (
              <li key={p.portfolioId}>
                <Link to="/portfolio/:id" params={{ id: p.portfolioId }}>{p.portfolioName}</Link>
                <span className="num">{money(p.marketValue)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Invest panel: buy with an amount or a quantity; sell some or all.
// ---------------------------------------------------------------------------
type Side = "buy" | "sell";
type Mode = "amount" | "quantity";

function InvestPanel({ asset }: { asset: AssetDetail }) {
  const held = useMemo(() => new Map(asset.positions.map((p) => [p.portfolioId, p])), [asset.positions]);
  const [side, setSide] = useState<Side>("buy");
  const [portfolioId, setPortfolioId] = useState<number | null>(asset.portfolios[0]?.id ?? null);
  const [mode, setMode] = useState<Mode>("amount");
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Selling only makes sense from a portfolio that holds the asset.
  const sellable = asset.portfolios.filter((p) => held.has(p.id));
  const choices = side === "buy" ? asset.portfolios : sellable;
  useEffect(() => {
    if (!choices.some((p) => p.id === portfolioId)) setPortfolioId(choices[0]?.id ?? null);
  }, [side, choices, portfolioId]);

  const portfolio = asset.portfolios.find((p) => p.id === portfolioId) ?? null;
  const position = portfolioId === null ? undefined : held.get(portfolioId);
  const n = Number(value);
  const valid = value.trim() !== "" && Number.isFinite(n) && n > 0;
  const effectiveMode: Mode = side === "sell" ? "quantity" : mode;
  const units = valid ? (effectiveMode === "amount" ? n / asset.price : n) : 0;
  const cost = valid ? (effectiveMode === "amount" ? n : n * asset.price) : 0;

  async function submit(e: FormEvent, sellAll = false) {
    e.preventDefault();
    if (portfolioId === null) return;
    setError(null);
    setDone(null);
    setSaving(true);
    try {
      if (side === "buy") {
        const r = await buyAsset({
          portfolioId,
          symbol: asset.symbol,
          ...(mode === "amount" ? { amount: n } : { quantity: n }),
        });
        setDone(`Bought ${quantity(r.quantity)} ${asset.symbol} for ${money(r.total)}.`);
      } else {
        const r = await sellAsset({
          portfolioId,
          symbol: asset.symbol,
          ...(sellAll ? { all: true } : { quantity: n }),
        });
        setDone(`Sold ${quantity(r.quantity)} ${asset.symbol} for ${money(r.total)} (${signedMoney(r.realizedGain)}).`);
      }
      setValue("");
    } catch (err: any) {
      setError(err?.message ?? "Something went wrong");
    } finally {
      setSaving(false);
    }
  }

  if (asset.portfolios.length === 0) {
    return (
      <section className="panel invest-panel">
        <div className="panel-head"><h2>Invest</h2></div>
        <p className="muted invest-body">Create a portfolio first, then come back to invest.</p>
      </section>
    );
  }

  return (
    <section className="panel invest-panel" aria-label={`Trade ${asset.name}`}>
      <div className="invest-tabs" role="tablist">
        {(["buy", "sell"] as const).map((s) => (
          <button
            key={s}
            role="tab"
            aria-selected={side === s}
            onClick={() => { setSide(s); setError(null); setDone(null); setValue(""); }}
          >
            {s === "buy" ? "Buy" : "Sell"}
          </button>
        ))}
      </div>

      {side === "sell" && sellable.length === 0 ? (
        <p className="muted invest-body">You don't own any {asset.name} yet. Buy some first.</p>
      ) : (
        <form className="invest-body" onSubmit={(e) => submit(e)}>
          <label>
            Portfolio
            <select value={portfolioId ?? ""} onChange={(e) => setPortfolioId(Number(e.target.value))}>
              {choices.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · {side === "buy" ? `${money(p.cash)} cash` : `${quantity(held.get(p.id)!.quantity)} ${asset.symbol}`}
                </option>
              ))}
            </select>
          </label>

          {side === "buy" && (
            <div className="segmented segmented--full" role="group" aria-label="Buy by">
              <button type="button" aria-pressed={mode === "amount"} onClick={() => { setMode("amount"); setValue(""); }}>Amount ($)</button>
              <button type="button" aria-pressed={mode === "quantity"} onClick={() => { setMode("quantity"); setValue(""); }}>Quantity</button>
            </div>
          )}

          <label>
            {effectiveMode === "amount" ? "Amount in USD" : `Quantity (${asset.unit}s)`}
            <input
              name="trade-value"
              type="number"
              inputMode="decimal"
              step="any"
              min="0"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={effectiveMode === "amount" ? "1000" : "1"}
              required
            />
          </label>

          <dl className="preview">
            <div><dt>Price</dt><dd className="num">{price(asset.price, asset.decimals)}</dd></div>
            {side === "buy" ? (
              <>
                <div><dt>You get</dt><dd className="num">{valid ? `≈ ${quantity(Number(units.toFixed(8)))} ${asset.symbol}` : "—"}</dd></div>
                <div><dt>Cost</dt><dd className="num">{valid ? money(cost) : "—"}</dd></div>
                <div>
                  <dt>Cash after</dt>
                  <dd className={`num ${portfolio && cost > portfolio.cash ? "neg" : ""}`}>
                    {portfolio ? money(portfolio.cash - cost) : "—"}
                  </dd>
                </div>
              </>
            ) : (
              <>
                <div><dt>You own</dt><dd className="num">{position ? `${quantity(position.quantity)} ${asset.symbol}` : "—"}</dd></div>
                <div><dt>You receive</dt><dd className="num">{valid ? `≈ ${money(cost)}` : "—"}</dd></div>
                <div>
                  <dt>Gain on sale</dt>
                  <dd className={`num ${position && valid ? gainClass(cost - position.avgCost * units) : ""}`}>
                    {position && valid ? `≈ ${signedMoney(cost - position.avgCost * units)}` : "—"}
                  </dd>
                </div>
              </>
            )}
          </dl>

          {error && <p className="error" role="alert">{error}</p>}
          {done && <p className="success" role="status">{done}</p>}

          <div className="form-actions">
            {side === "sell" && position && (
              <button type="button" className="btn btn--ghost" disabled={saving} onClick={(e) => submit(e, true)}>
                Sell all
              </button>
            )}
            <button type="submit" className="btn btn--primary" disabled={saving || !valid}>
              {saving ? "Working…" : side === "buy" ? `Buy ${asset.symbol}` : `Sell ${asset.symbol}`}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
