import { useState } from "react";
import { Link } from "wasp/client/router";
import { addApp } from "wasp/client/operations";
import type { AppManifest } from "./types";
import { CLIENT_PARTS, FallbackPlanet } from "./clientRegistry";
import "./world.css";

/** Shown instead of an app's page when the user hasn't added that app. */
export function AppGate({ app }: { app: AppManifest }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const Planet = CLIENT_PARTS[app.id]?.Planet ?? FallbackPlanet;
  const live = app.status === "live";

  async function add() {
    setBusy(true);
    setError(null);
    try {
      await addApp({ appId: app.id });
    } catch (e: any) {
      setError(e?.message ?? "Couldn't add the app. Try again.");
      setBusy(false);
    }
  }

  return (
    <div className="app-gate">
      <svg className="app-gate-planet" viewBox="-90 -80 180 160" aria-hidden="true">
        <Planet r={56} id={`gate-${app.id}`} />
      </svg>
      {live ? (
        <>
          <h1>Add {app.name} to your world</h1>
          <p>{app.description}</p>
          <div className="app-gate-actions">
            <button className="btn btn--primary btn--lg" onClick={add} disabled={busy}>
              {busy ? "Adding…" : `Add ${app.name}`}
            </button>
            <Link to="/world" className="btn btn--ghost btn--lg">Back to your world</Link>
          </div>
        </>
      ) : (
        <>
          <h1>{app.name} isn't available yet</h1>
          <p>{app.description} It's coming soon.</p>
          <div className="app-gate-actions">
            <Link to="/world" className="btn btn--primary btn--lg">Back to your world</Link>
          </div>
        </>
      )}
      {error && <p className="error" role="alert">{error}</p>}
    </div>
  );
}
