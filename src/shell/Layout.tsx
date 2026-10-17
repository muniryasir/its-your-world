import { Outlet } from "react-router";
import { Link } from "wasp/client/router";
import { logout, useAuth } from "wasp/client/auth";
import "./app.css";

export function Layout() {
  const { data: user } = useAuth();
  const username = user?.getFirstProviderUserId();

  return (
    <div className="shell">
      <header className="topbar">
        <Link to="/" className="brand">
          <span className="brand-mark" aria-hidden>◐</span>
          <span>It's Your World</span>
        </Link>

        <nav className="topnav">
          {user ? (
            <>
              <Link to="/dashboard" className="navlink">Portfolios</Link>
              <span className="navlink navlink--soon" title="Coming in phase 2">Arcade</span>
              <span className="whoami">{username}</span>
              <button className="btn btn--ghost" onClick={logout}>Log out</button>
            </>
          ) : (
            <>
              <Link to="/login" className="navlink">Log in</Link>
              <Link to="/signup" className="btn btn--primary">Sign up</Link>
            </>
          )}
        </nav>
      </header>

      <main className="content">
        <Outlet />
      </main>

      <footer className="footer">
        It's Your World · demo build · prices are sample data, not live quotes
      </footer>
    </div>
  );
}
