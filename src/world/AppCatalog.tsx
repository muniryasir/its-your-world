import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import { Link as RouterLink } from "react-router";
import { addApp } from "wasp/client/operations";
import { APPS } from "./catalog";
import { CLIENT_PARTS, FallbackPlanet } from "./clientRegistry";

export type AppCatalogHandle = { open: () => void };

/** The "Add an app" panel: every app in the catalog with its add button. */
export const AppCatalog = forwardRef<AppCatalogHandle, { addedIds: Set<string> }>(function AppCatalog(
  { addedIds },
  ref,
) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useImperativeHandle(ref, () => ({
    open: () => {
      setError(null);
      dialog.current?.showModal();
    },
  }));

  async function add(appId: string) {
    setBusy(appId);
    setError(null);
    try {
      await addApp({ appId });
      dialog.current?.close();
    } catch (e: any) {
      setError(e?.message ?? "Couldn't add the app. Try again.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <dialog
      ref={dialog}
      className="catalog"
      aria-labelledby="catalog-title"
      onClick={(e) => {
        if (e.target === dialog.current) dialog.current?.close(); // click on backdrop
      }}
    >
      <div className="catalog-inner">
        <header className="catalog-head">
          <h2 id="catalog-title">Add an app</h2>
          <button className="catalog-close" onClick={() => dialog.current?.close()} aria-label="Close">×</button>
        </header>
        <p className="catalog-intro">Apps share your account. Add one and it appears in your world right away.</p>

        <ul className="catalog-list">
          {APPS.map((app) => {
            const Planet = CLIENT_PARTS[app.id]?.Planet ?? FallbackPlanet;
            const added = addedIds.has(app.id);
            const live = app.status === "live";
            return (
              <li key={app.id} className="catalog-item" style={{ ["--app-color" as any]: app.color }}>
                <svg className="catalog-planet" viewBox="-80 -70 160 140" aria-hidden="true">
                  <Planet r={46} id={`cat-${app.id}`} />
                </svg>
                <div className="catalog-text">
                  <h3>{app.name}</h3>
                  <p>{app.description}</p>
                </div>
                <div className="catalog-action">
                  {added ? (
                    <RouterLink to={app.basePath} className="home-btn home-btn--ghost home-btn--sm" onClick={() => dialog.current?.close()}>
                      Open
                    </RouterLink>
                  ) : live ? (
                    <button className="home-btn home-btn--teal home-btn--sm" onClick={() => add(app.id)} disabled={busy !== null}>
                      {busy === app.id ? "Adding…" : `Add ${app.name}`}
                    </button>
                  ) : (
                    <span className="world-status world-status--soon">Coming soon</span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
        {error && <p className="catalog-error" role="alert">{error}</p>}
      </div>
    </dialog>
  );
});
