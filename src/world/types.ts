/**
 * The contract every app in It's Your World follows.
 * See docs/apps.md for the full guide.
 *
 * A manifest is plain data (no React, no server imports) so both the
 * server (validation) and the client (catalog, hub) can use it.
 */
export type AppStatus = "live" | "coming-soon";

export type AppManifest = {
  /** Stable id stored in the database. Never change it once released. */
  id: string;
  /** Display name, e.g. "Portfolio". */
  name: string;
  /** One short line for tiles and the catalog. */
  tagline: string;
  /** One or two sentences for the catalog. */
  description: string;
  status: AppStatus;
  /** Accent color used on the hub (hex). */
  color: string;
  /**
   * Every page of the app lives under this path, e.g. "/portfolio".
   * The shell blocks these pages for users who haven't added the app.
   */
  basePath: string;
};
