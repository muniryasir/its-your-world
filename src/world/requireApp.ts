import { HttpError } from "wasp/server";
import { getApp } from "./catalog";

type Ctx = {
  user?: { id: number };
  entities: { UserApp: { findUnique: (args: any) => Promise<unknown> } };
};

/**
 * Call at the top of every server operation that belongs to an app.
 * - 401 if nobody is logged in
 * - 403 if the user hasn't added the app to their world
 * Returns the logged-in user.
 *
 * The operation must list "UserApp" in its `entities`.
 */
export async function requireAppAdded<C extends Ctx>(context: C, appId: string) {
  if (!context.user) throw new HttpError(401);
  const user = context.user;
  const added = await context.entities.UserApp.findUnique({
    where: { userId_appId: { userId: user.id, appId } },
  });
  if (!added) {
    const name = getApp(appId)?.name ?? appId;
    throw new HttpError(403, `Add ${name} to your world first.`, { code: "APP_NOT_ADDED", appId });
  }
  return user as NonNullable<C["user"]>;
}
