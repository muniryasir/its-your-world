import { HttpError } from "wasp/server";
import type { GetMyApps, AddApp, RemoveApp } from "wasp/server/operations";
import { APPS, getApp } from "./catalog";
import { APP_HOOKS } from "./serverHooks";

export type MyApp = { appId: string; addedAt: Date };

/** Apps the logged-in user has added, in hub order. */
export const getMyApps: GetMyApps<void, MyApp[]> = async (_args, context) => {
  if (!context.user) throw new HttpError(401);
  const rows = await context.entities.UserApp.findMany({
    where: { userId: context.user.id },
    orderBy: [{ position: "asc" }, { addedAt: "asc" }],
  });
  // Ignore rows for apps that no longer exist in the catalog.
  return rows
    .filter((r) => APPS.some((a) => a.id === r.appId))
    .map((r) => ({ appId: r.appId, addedAt: r.addedAt }));
};

export const addApp: AddApp<{ appId: string }, { appId: string; added: boolean }> = async (
  { appId },
  context,
) => {
  if (!context.user) throw new HttpError(401);
  const app = getApp(appId);
  if (!app) throw new HttpError(400, "Unknown app.");
  if (app.status !== "live") throw new HttpError(400, `${app.name} isn't available yet.`);

  const userId = context.user.id;
  const existing = await context.entities.UserApp.findUnique({
    where: { userId_appId: { userId, appId } },
  });
  if (existing) return { appId, added: false };

  const count = await context.entities.UserApp.count({ where: { userId } });
  await context.entities.UserApp.create({ data: { userId, appId, position: count } });

  // First-time setup for the app (e.g. a starter portfolio).
  await APP_HOOKS[appId]?.onAdd?.(userId);
  return { appId, added: true };
};

/** Removes the app from the user's world. The app's data is kept. */
export const removeApp: RemoveApp<{ appId: string }, { appId: string }> = async ({ appId }, context) => {
  if (!context.user) throw new HttpError(401);
  await context.entities.UserApp.deleteMany({ where: { userId: context.user.id, appId } });
  return { appId };
};

