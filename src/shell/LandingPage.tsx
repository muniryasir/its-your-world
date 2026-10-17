import { Link } from "wasp/client/router";
import { useAuth } from "wasp/client/auth";
import { Starfield } from "./art/Starfield";
import { HeroOrbit } from "./art/HeroOrbit";
import { ArcadePlanet, MysteryPlanet, PortfolioPlanet } from "./art/Planets";
import "./landing.css";

export function LandingPage() {
  const { data: user } = useAuth();
  const signedIn = Boolean(user);

  return (
    <div className="home">
      <Starfield className="home-stars" />

      {/* ---------- Hero ---------- */}
      <section className="home-hero">
        <div className="home-hero-copy">
          <h1 className="home-title">It's your world.</h1>
          <p className="home-lede">
            One account for the things you care about. Keep track of your investments today,
            play retro games soon, and pick up new apps as they arrive.
          </p>
          <div className="home-actions">
            {signedIn ? (
              <Link to="/dashboard" className="home-btn home-btn--primary">Open your portfolio</Link>
            ) : (
              <>
                <Link to="/signup" className="home-btn home-btn--primary">Create your account</Link>
                <Link to="/login" className="home-btn home-btn--ghost">Log in</Link>
              </>
            )}
          </div>
          {!signedIn && (
            <p className="home-hint">
              Want a look first? Log in as <code>demo</code> with password <code>demo1234</code>.
            </p>
          )}
        </div>
        <div className="home-hero-art">
          <HeroOrbit />
        </div>
        <div className="home-horizon" aria-hidden="true" />
      </section>

      {/* ---------- Worlds ---------- */}
      <section className="home-worlds" aria-labelledby="worlds-title">
        <header className="home-section-head">
          <h2 id="worlds-title">Explore your world</h2>
          <p>Every app here is its own small world. They all share one account, so there's nothing new to sign up for.</p>
        </header>

        <article className="world world--portfolio">
          <svg className="world-planet" viewBox="-160 -150 320 300" aria-hidden="true">
            <PortfolioPlanet r={100} id="w-pf" />
          </svg>
          <div className="world-body">
            <span className="world-status world-status--live">Live now</span>
            <h3>Manage your portfolio</h3>
            <p>
              Create as many portfolios as you like, add your holdings and see what everything is
              worth at a glance.
            </p>
            <ul className="world-points">
              <li>Separate portfolios for separate goals</li>
              <li>Value, cost and gain or loss for every holding</li>
              <li>How your money is split across stocks, ETFs, crypto and bonds</li>
            </ul>
            <Link to={signedIn ? "/dashboard" : "/signup"} className="home-btn home-btn--teal">
              {signedIn ? "Open your portfolio" : "Start a portfolio"}
            </Link>
          </div>
          <PortfolioPreview />
        </article>

        <article className="world world--arcade">
          <svg className="world-planet" viewBox="-170 -150 340 300" aria-hidden="true">
            <ArcadePlanet r={96} id="w-ar" />
          </svg>
          <div className="world-body">
            <span className="world-status world-status--soon">Coming soon</span>
            <h3>Play retro games</h3>
            <p>
              Modded classics you can play right in your browser, with leaderboards and rewards
              linked to how you manage your portfolio.
            </p>
            <ul className="world-points">
              <li>Classic console games, reworked</li>
              <li>Leaderboards against other players</li>
              <li>Rewards for your portfolio activity</li>
            </ul>
          </div>
          <ArcadePreview />
        </article>

        <article className="world world--more">
          <svg className="world-planet" viewBox="-130 -130 260 260" aria-hidden="true">
            <MysteryPlanet r={100} id="w-mo" />
          </svg>
          <div className="world-body">
            <h3>More worlds on the way</h3>
            <p>New apps will join over time, all under the same login.</p>
          </div>
        </article>
      </section>

      {/* ---------- How it works ---------- */}
      <section className="home-steps" aria-labelledby="steps-title">
        <h2 id="steps-title">How it works</h2>
        <ol>
          <li>
            <h3>Create one account</h3>
            <p>A username and password is all it takes.</p>
          </li>
          <li>
            <h3>Open any world</h3>
            <p>Start with your portfolio. New apps appear here when they launch.</p>
          </li>
          <li>
            <h3>Keep it all together</h3>
            <p>Your data stays with your account and is visible only to you.</p>
          </li>
        </ol>
      </section>

      {/* ---------- Final call ---------- */}
      {!signedIn && (
        <section className="home-final">
          <h2>Start with one account</h2>
          <p>It takes a few seconds, and your portfolio is ready right away.</p>
          <Link to="/signup" className="home-btn home-btn--primary">Create your account</Link>
        </section>
      )}
    </div>
  );
}

/** A small, real-looking slice of the portfolio UI, using the demo account's numbers. */
function PortfolioPreview() {
  const parts = [
    { label: "Stocks", pct: 61.6, color: "#2ed3a0" },
    { label: "ETF", pct: 38.4, color: "#7fb6ff" },
  ];
  return (
    <div className="world-preview pf-preview" aria-label="Example portfolio card">
      <div className="pf-preview-head">
        <strong>Long-Term Growth</strong>
        <span>4 holdings</span>
      </div>
      <div className="pf-preview-value">$24,006.20</div>
      <div className="pf-preview-gain">+$11,071.90 (+85.60%)</div>
      <div className="pf-preview-bar">
        {parts.map((p) => (
          <span key={p.label} style={{ width: `${p.pct}%`, background: p.color }} />
        ))}
      </div>
      <div className="pf-preview-legend">
        {parts.map((p) => (
          <span key={p.label}>
            <i style={{ background: p.color }} /> {p.label} {p.pct}%
          </span>
        ))}
      </div>
    </div>
  );
}

function ArcadePreview() {
  return (
    <div className="world-preview arcade-preview" aria-label="Arcade screen placeholder">
      <div className="arcade-screen">
        <span className="arcade-title">Press start</span>
        <span className="arcade-sub">Arcade opens soon</span>
        <span className="arcade-blink" aria-hidden="true">▮</span>
      </div>
    </div>
  );
}
