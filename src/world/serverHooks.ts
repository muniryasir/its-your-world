// Server-side lifecycle hooks per app. Runs on the server only.
import { onAddPortfolio } from "../apps/portfolio/onAdd";

export type AppHooks = {
  /** Runs once, right after a user adds the app (not on re-adding). */
  onAdd?: (userId: number) => Promise<void>;
};

export const APP_HOOKS: Record<string, AppHooks> = {
  portfolio: { onAdd: onAddPortfolio },
};
