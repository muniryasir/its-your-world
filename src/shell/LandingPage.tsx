import { Navigate, useNavigate } from "react-router";
import { Link } from "wasp/client/router";
import { useAuth } from "wasp/client/auth";
import { AuthPanel, type AuthMode } from "./AuthPanel";
import { Starfield } from "./art/Starfield";
import { HeroOrbit } from "./art/HeroOrbit";
import { ArcadePlanet, MysteryPlanet, PortfolioPlanet } from "./art/Planets";
import { StarfallCover } from "../apps/arcade/games/StarfallCover";
import "./landing.css";

/**
 * The public home page. On /login and /signup the same page renders with the
 * auth panel open on top, so those URLs still work (redirects, bookmarks).
 */
export function LandingPage({ authMode }: { authMode?: AuthMode }) {
  const { data: user } = useAuth();
  const navigate = useNavigate();
  const signedIn = Boolean(user);

  // Already logged in: the login/signup URLs go straight to your world.
  if (signedIn && authMode) return <Navigate to="/world" replace />;

  return (
    <div className="home">
      {authMode && (
        <AuthPanel
          key="auth"
          mode={authMode}
          onModeChange={(m) => navigate(m === "login" ? "/login" : "/signup", { replace: true })}
          onClose={() => navigate("/", { replace: true })}
        />
      )}
      <Starfield className="home-stars" />

      {/* ---------- Hero ---------- */}
      <section className="home-hero">
        <div className="home-hero-copy">
          <h1 className="home-title">It's your world.</h1>
          <p className="home-lede">
            One account for the things you care about. Keep track of your investments today,
            play browser games, and pick up new apps as they arrive.
          </p>
          <div className="home-actions">
            {signedIn ? (
              <Link to="/world" className="home-btn home-btn--primary">Open your world</Link>
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
            <h3>Invest without the risk</h3>
            <p>
              Start a portfolio with demo cash and invest it in real assets at simulated prices.
              Learn how markets move without putting real money on the line.
            </p>
            <ul className="world-points">
              <li>40 assets across oil and energy, crypto, US stocks and metals</li>
              <li>Price charts, key stats and a buy and sell panel for every asset</li>
              <li>Value, return and allocation for each portfolio</li>
            </ul>
            <Link to={signedIn ? "/portfolio" : "/signup"} className="home-btn home-btn--teal">
              {signedIn ? "Open your portfolio" : "Start investing"}
            </Link>
          </div>
          <PortfolioPreview />
        </article>

        <article className="world world--arcade">
          <svg className="world-planet" viewBox="-170 -150 340 300" aria-hidden="true">
            <ArcadePlanet r={96} id="w-ar" />
          </svg>
          <div className="world-body">
            <span className="world-status world-status--live">Live now</span>
            <h3>Play in the arcade</h3>
            <p>
              Original games that run right in your browser. Add the ones you like to your arcade
              and climb the leaderboards.
            </p>
            <ul className="world-points">
              <li>Starfall, a falling-crystal puzzle game, with more games to come</li>
              <li>Leaderboards under a nickname you choose</li>
              <li>Every score is replayed and checked by the server</li>
            </ul>
            <Link to={signedIn ? "/arcade" : "/signup"} className="home-btn home-btn--pink">
              {signedIn ? "Open the arcade" : "Start playing"}
            </Link>
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

/** A small example of a portfolio card from the Portfolio app (illustrative numbers). */
function PortfolioPreview() {
  const parts = [
    { label: "US Stocks", pct: 46, color: "#4c8dff" },
    { label: "Metals", pct: 17, color: "#e0a526" },
    { label: "Cash", pct: 37, color: "#8f8bc4" },
  ];
  return (
    <div className="world-preview pf-preview" aria-label="Example portfolio card">
      <div className="pf-preview-head">
        <strong>Long-Term Growth</strong>
        <span>5 assets</span>
      </div>
      <div className="pf-preview-value">$102,207.04</div>
      <div className="pf-preview-gain">+$2,207.04 (+2.21%) since start</div>
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
    <div className="world-preview arcade-preview">
      <div className="arcade-screen">
        <span className="arcade-title">Now playing</span>
        <StarfallCover id="home-sf" />
        <span className="arcade-sub">Starfall</span>
      </div>
    </div>
  );
}
