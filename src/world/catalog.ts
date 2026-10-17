// The list of apps in It's Your World, in catalog order.
// To add an app: create src/apps/<id>/manifest.ts and add it here,
// then register its client parts in src/world/clientRegistry.tsx and
// (optionally) its server hooks in src/world/serverHooks.ts.
import type { AppManifest } from "./types";
import { portfolioManifest } from "../apps/portfolio/manifest";
import { arcadeManifest } from "../apps/arcade/manifest";

export const APPS: readonly AppManifest[] = [portfolioManifest, arcadeManifest];

export function getApp(id: string): AppManifest | undefined {
  return APPS.find((a) => a.id === id);
}

/** The app whose pages include this path, if any. */
export function appForPath(pathname: string): AppManifest | undefined {
  return APPS.find((a) => pathname === a.basePath || pathname.startsWith(a.basePath + "/"));
}
