import { Link as RouterLink, Outlet, useLocation } from "react-router";
import { Link } from "wasp/client/router";
import { logout, useAuth } from "wasp/client/auth";
import { getMyApps, useQuery } from "wasp/client/operations";
import { APPS, appForPath } from "../world/catalog";
import { AppGate } from "../world/AppGate";
import "./app.css";
import "./space.css";

// Pages that use the dark "space" look. App pages keep their own style.
const SPACE_PATHS = ["/", "/world"];

export function Layout() {
  const { data: user } = useAuth();
  const { pathname } = useLocation();
  const username = user?.getFirstProviderUserId();
  const isSpace = SPACE_PATHS.includes(pathname);

  const { data: myApps, isLoading: appsLoading } = useQuery(getMyApps, undefined, { enabled: Boolean(user) });
  const addedIds = new Set((myApps ?? []).map((a) => a.appId));
  const addedApps = APPS.filter((a) => addedIds.has(a.id));

  // Block an app's pages until the user has added it. The server enforces
  // the same rule on every request; this just shows a friendly screen.
  const currentApp = appForPath(pathname);
  const checkingAccess = Boolean(user && currentApp && appsLoading);
  const gated = Boolean(user && currentApp && myApps && !addedIds.has(currentApp.id));

  return (
    <div className={isSpace ? "shell shell--space" : "shell"}>
      <header className="topbar">
        <Link to={user ? "/world" : "/"} className="brand">
          <span className="brand-mark" aria-hidden>◐</span>
          <span>It's Your World</span>
        </Link>

        <nav className="topnav" aria-label="Main">
          {user ? (
            <>
              <Link to="/world" className={pathname === "/world" ? "navlink active" : "navlink"}>Your world</Link>
              {addedApps.map((a) => (
                <RouterLink
                  key={a.id}
                  to={a.basePath}
                  className={currentApp?.id === a.id ? "navlink active" : "navlink"}
                >
                  {a.name}
                </RouterLink>
              ))}
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
        {checkingAccess ? null : gated && currentApp ? <AppGate app={currentApp} /> : <Outlet />}
      </main>

      <footer className="footer">
        It's Your World is a demo build. Prices are sample data, not live quotes.
      </footer>
    </div>
  );
}
