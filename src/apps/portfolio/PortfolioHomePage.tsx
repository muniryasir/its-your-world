import { useState, type FormEvent } from "react";
import { Link as RouterLink, useNavigate } from "react-router";
import { Link } from "wasp/client/router";
import { createPortfolio, getPortfolios, useQuery } from "wasp/client/operations";
import { ASSET_CLASSES } from "./assetClasses";
import { AllocationBar } from "./charts";
import type { AllocationSlice } from "./operations";
import { gainClass, money, signedMoney, signedPct } from "./format";
import "./portfolio.css";

export function PortfolioHomePage() {
  return (
    <div className="pf">
      <PortfolioHomePageContent />
    </div>
  );
}

function PortfolioHomePageContent() {
  const { data: portfolios, isLoading, error } = useQuery(getPortfolios);

  if (isLoading) return <p className="muted">Loading your portfolios…</p>;
  if (error) return <p className="error">Couldn't load portfolios: {error.message}</p>;

  const list = portfolios ?? [];
  const totalValue = list.reduce((s, p) => s + p.totalValue, 0);
  const started = list.reduce((s, p) => s + p.startingCash, 0);
  const cash = list.reduce((s, p) => s + p.cash, 0);
  const totalReturn = totalValue - started;

  // Combined allocation across all portfolios, in the same fixed order.
  const merged = new Map<AllocationSlice["key"], number>();
  for (const p of list) for (const s of p.allocation) merged.set(s.key, (merged.get(s.key) ?? 0) + s.value);
  const order: AllocationSlice["key"][] = ["oil", "crypto", "stocks", "metals", "cash"];
  const allocation = order.filter((k) => merged.has(k)).map((k) => ({ key: k, value: merged.get(k)! }));
  const invested = list.some((p) => p.holdingsCount > 0);

  return (
    <div className="dashboard">
      <div className="page-head">
        <div>
          <h1>Portfolios</h1>
          <p className="muted">Invest demo cash in oil, crypto, US stocks and metals, and track how it does.</p>
        </div>
        <Link to="/portfolio/markets" className="btn btn--primary">Explore markets</Link>
      </div>

      <section className="stats">
        <div className="stat">
          <span className="stat-label">Total value</span>
          <span className="stat-value num">{money(totalValue)}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Total return</span>
          <span className={`stat-value num ${gainClass(totalReturn)}`}>
            {signedMoney(totalReturn)} <small>{signedPct(started ? (totalReturn / started) * 100 : 0)}</small>
          </span>
        </div>
        <div className="stat">
          <span className="stat-label">Cash available</span>
          <span className="stat-value num">{money(cash)}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Portfolios</span>
          <span className="stat-value num">{list.length}</span>
        </div>
      </section>

      {invested && (
        <section className="panel alloc-panel">
          <div className="panel-head"><h2>Across all portfolios</h2></div>
          <div className="alloc-body"><AllocationBar slices={allocation} /></div>
        </section>
      )}

      <h2 className="section-title">Your portfolios</h2>
      <section className="card-grid">
        {list.map((p) => (
          <Link key={p.id} to="/portfolio/:id" params={{ id: p.id }} className="pcard">
            <div className="pcard-head">
              <h3>{p.name}</h3>
              <span className="pill">{p.holdingsCount === 1 ? "1 asset" : `${p.holdingsCount} assets`}</span>
            </div>
            {p.description && <p className="pcard-desc">{p.description}</p>}
            <div className="pcard-value num">{money(p.totalValue)}</div>
            <div className={`pcard-gain num ${gainClass(p.totalReturn)}`}>
              {signedMoney(p.totalReturn)} · {signedPct(p.totalReturnPct)}
            </div>
            {p.holdingsCount > 0 ? (
              <AllocationBar slices={p.allocation} compact />
            ) : (
              <span className="muted small">All in cash. Open it to start investing.</span>
            )}
          </Link>
        ))}
        <NewPortfolioCard />
      </section>

      <h2 className="section-title">Markets</h2>
      <section className="class-links">
        {ASSET_CLASSES.map((c) => (
          <RouterLink key={c.id} to={`/portfolio/markets?class=${c.id}`} className={`class-link class-link--${c.id}`}>
            <span className="tab-dot" aria-hidden />
            <strong>{c.name}</strong>
            <span className="muted small">{c.blurb}</span>
          </RouterLink>
        ))}
      </section>
    </div>
  );
}

function NewPortfolioCard() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [startingCash, setStartingCash] = useState("100000");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const { id } = await createPortfolio({ name, description, startingCash: Number(startingCash) });
      navigate(`/portfolio/${id}`);
    } catch (err: any) {
      setError(err?.message ?? "Something went wrong");
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <button className="pcard pcard--new" onClick={() => setOpen(true)}>
        <span className="plus" aria-hidden>+</span>
        New portfolio
      </button>
    );
  }

  return (
    <form className="pcard pcard--form" onSubmit={onSubmit}>
      <h3>New portfolio</h3>
      <label>
        Name
        <input value={name} onChange={(e) => setName(e.target.value)} autoFocus required maxLength={80} />
      </label>
      <label>
        Description <span className="muted">(optional)</span>
        <input value={description} onChange={(e) => setDescription(e.target.value)} maxLength={200} />
      </label>
      <label>
        Starting cash (USD)
        <input type="number" min={1000} max={10000000} step="any" value={startingCash} onChange={(e) => setStartingCash(e.target.value)} required />
        <span className="muted small">Demo money, between $1,000 and $10,000,000.</span>
      </label>
      {error && <p className="error">{error}</p>}
      <div className="form-actions">
        <button type="button" className="btn btn--ghost" onClick={() => setOpen(false)}>Cancel</button>
        <button type="submit" className="btn btn--primary" disabled={saving}>
          {saving ? "Creating…" : "Create"}
        </button>
      </div>
    </form>
  );
}
