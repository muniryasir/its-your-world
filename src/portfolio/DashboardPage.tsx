import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { Link } from "wasp/client/router";
import { createPortfolio, getPortfolios, useQuery } from "wasp/client/operations";
import { gainClass, money, signedMoney, signedPct } from "./format";

export function DashboardPage() {
  const { data: portfolios, isLoading, error } = useQuery(getPortfolios);

  if (isLoading) return <p className="muted">Loading your portfolios…</p>;
  if (error) return <p className="error">Couldn't load portfolios: {error.message}</p>;

  const list = portfolios ?? [];
  const totalValue = list.reduce((s, p) => s + p.marketValue, 0);
  const totalCost = list.reduce((s, p) => s + p.costBasis, 0);
  const totalGain = totalValue - totalCost;
  const totalGainPct = totalCost === 0 ? 0 : (totalGain / totalCost) * 100;

  return (
    <div className="dashboard">
      <div className="page-head">
        <div>
          <p className="eyebrow">Your world</p>
          <h1>Portfolios</h1>
        </div>
      </div>

      <section className="stats">
        <div className="stat">
          <span className="stat-label">Total value</span>
          <span className="stat-value num">{money(totalValue)}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Total gain / loss</span>
          <span className={`stat-value num ${gainClass(totalGain)}`}>
            {signedMoney(totalGain)} <small>{signedPct(totalGainPct)}</small>
          </span>
        </div>
        <div className="stat">
          <span className="stat-label">Portfolios</span>
          <span className="stat-value num">{list.length}</span>
        </div>
      </section>

      <section className="card-grid">
        {list.map((p) => (
          <Link key={p.id} to="/portfolio/:id" params={{ id: p.id }} className="pcard">
            <div className="pcard-head">
              <h2>{p.name}</h2>
              <span className="pill">{p.holdingsCount} holdings</span>
            </div>
            {p.description && <p className="pcard-desc">{p.description}</p>}
            <div className="pcard-value num">{money(p.marketValue)}</div>
            <div className={`pcard-gain num ${gainClass(p.gain)}`}>
              {signedMoney(p.gain)} · {signedPct(p.gainPct)}
            </div>
          </Link>
        ))}

        <NewPortfolioCard />

        <div className="pcard pcard--soon" aria-disabled>
          <div className="pcard-head">
            <h2>Arcade</h2>
            <span className="pill">Phase 2</span>
          </div>
          <p className="pcard-desc">Retro games and leaderboards are coming to your world soon.</p>
        </div>
      </section>
    </div>
  );
}

function NewPortfolioCard() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const { id } = await createPortfolio({ name, description });
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
      <h2>New portfolio</h2>
      <label>
        Name
        <input value={name} onChange={(e) => setName(e.target.value)} autoFocus required maxLength={80} />
      </label>
      <label>
        Description <span className="muted">(optional)</span>
        <input value={description} onChange={(e) => setDescription(e.target.value)} />
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
