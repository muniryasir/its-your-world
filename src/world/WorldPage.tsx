import { useRef, useState } from "react";
import { Link as RouterLink } from "react-router";
import { useAuth } from "wasp/client/auth";
import { getMyApps, removeApp, useQuery } from "wasp/client/operations";
import { Starfield } from "../shell/art/Starfield";
import { APPS } from "./catalog";
import { CLIENT_PARTS, FallbackPlanet } from "./clientRegistry";
import type { AppManifest } from "./types";
import { WorldOrbit } from "./WorldOrbit";
import { AppCatalog, type AppCatalogHandle } from "./AppCatalog";
import "./world.css";

export function WorldPage() {
  const { data: user } = useAuth();
  const { data: myApps, isLoading, error } = useQuery(getMyApps);
  const catalog = useRef<AppCatalogHandle>(null);
  const openCatalog = () => catalog.current?.open();

  const username = user?.getFirstProviderUserId() ?? "";
  const addedIds = new Set((myApps ?? []).map((a) => a.appId));
  const added = (myApps ?? [])
    .map((a) => APPS.find((m) => m.id === a.appId))
    .filter((m): m is AppManifest => Boolean(m));
  const empty = !isLoading && added.length === 0;

  return (
    <div className="world-hub">
      <Starfield className="space-stars" seed={11} count={120} />

      <section className="world-hero">
        <div className="world-hero-copy">
          <h1>Welcome to your world, {username}.</h1>
          <p className="world-lede">
            {isLoading
              ? "Loading your apps…"
              : empty
                ? "Your world is empty. Add your first app to get started."
                : "Pick up where you left off, or add another app."}
          </p>
          <button className="home-btn home-btn--primary" onClick={openCatalog}>Add an app</button>
          {error && <p className="world-error" role="alert">Couldn't load your apps: {error.message}</p>}
        </div>
        <div className="world-hero-art">
          <WorldOrbit
            planets={added.map((a) => ({ id: a.id, Planet: CLIENT_PARTS[a.id]?.Planet ?? FallbackPlanet }))}
            onAddClick={openCatalog}
          />
        </div>
      </section>

      <section className="world-apps" aria-label="Your apps">
        {added.length > 0 && <h2>Your apps</h2>}
        <div className="world-grid">
          {added.map((app) => (
            <AppTile key={app.id} app={app} />
          ))}
          <button className={empty ? "add-tile add-tile--big" : "add-tile"} onClick={openCatalog}>
            <span className="add-tile-plus" aria-hidden="true">+</span>
            <span className="add-tile-title">{empty ? "Add your first app" : "Add an app"}</span>
            <span className="add-tile-text">
              {empty ? "Portfolio is ready to add. More apps are on the way." : "See what else you can add to your world."}
            </span>
          </button>
        </div>
      </section>

      <AppCatalog ref={catalog} addedIds={addedIds} />
    </div>
  );
}

function AppTile({ app }: { app: AppManifest }) {
  const parts = CLIENT_PARTS[app.id];
  const Planet = parts?.Planet ?? FallbackPlanet;
  const Tile = parts?.Tile;
  const [confirming, setConfirming] = useState(false);
  const [removing, setRemoving] = useState(false);

  async function remove() {
    setRemoving(true);
    try {
      await removeApp({ appId: app.id });
    } finally {
      setRemoving(false);
      setConfirming(false);
    }
  }

  return (
    <article className="app-tile" style={{ ["--app-color" as any]: app.color }}>
      <header className="app-tile-head">
        <svg className="app-tile-planet" viewBox="-75 -65 150 130" aria-hidden="true">
          <Planet r={44} id={`tile-${app.id}`} />
        </svg>
        <div>
          <h3>{app.name}</h3>
          <p>{app.tagline}</p>
        </div>
      </header>

      <div className="app-tile-body">{Tile ? <Tile /> : null}</div>

      <footer className="app-tile-foot">
        {confirming ? (
          <div className="app-tile-confirm" role="group" aria-label={`Remove ${app.name}?`}>
            <span>Remove {app.name}? Your data is kept.</span>
            <button className="tile-link" onClick={() => setConfirming(false)}>Cancel</button>
            <button className="tile-link tile-link--danger" onClick={remove} disabled={removing}>
              {removing ? "Removing…" : "Remove"}
            </button>
          </div>
        ) : (
          <>
            <RouterLink to={app.basePath} className="home-btn home-btn--teal home-btn--sm">Open {app.name}</RouterLink>
            <button className="tile-link" onClick={() => setConfirming(true)}>Remove</button>
          </>
        )}
      </footer>
    </article>
  );
}
