import { Link } from "wasp/client/router";
import { useAuth } from "wasp/client/auth";

export function LandingPage() {
  const { data: user } = useAuth();

  return (
    <div className="landing">
      <section className="hero">
        <p className="eyebrow">One login. Your whole world.</p>
        <h1>
          Track your investments.<br />
          <span className="hero-accent">Play a little, too.</span>
        </h1>
        <p className="hero-sub">
          It's Your World is a personal hub: keep every portfolio in one dashboard, see what
          each holding is worth and how it's doing. A retro arcade is on the way.
        </p>
        <div className="hero-actions">
          {user ? (
            <Link to="/dashboard" className="btn btn--primary btn--lg">Open my dashboard</Link>
          ) : (
            <>
              <Link to="/signup" className="btn btn--primary btn--lg">Create an account</Link>
              <Link to="/login" className="btn btn--ghost btn--lg">Log in</Link>
            </>
          )}
        </div>
        {!user && (
          <p className="demo-hint">
            Just looking? Log in with <code>demo</code> / <code>demo1234</code>.
          </p>
        )}
      </section>

      <section className="modules">
        <article className="module">
          <span className="module-tag module-tag--live">Live</span>
          <h2>Portfolios</h2>
          <p>Create as many portfolios as you like, add holdings and see value and gain/loss at a glance.</p>
        </article>
        <article className="module module--soon">
          <span className="module-tag">Phase 2</span>
          <h2>Arcade</h2>
          <p>Modded classic games, leaderboards and rewards tied to your portfolio activity.</p>
        </article>
      </section>
    </div>
  );
}
