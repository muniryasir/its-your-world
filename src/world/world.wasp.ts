// Wasp spec for the world shell's hub. Imported by main.wasp.ts.
import { action, page, query, route } from "@wasp.sh/spec";
import { WorldPage } from "./WorldPage" with { type: "ref" };
import { DashboardRedirect } from "./DashboardRedirect" with { type: "ref" };
import { getMyApps, addApp, removeApp } from "./operations" with { type: "ref" };

export const worldSpec = [
  route("WorldRoute", "/world", page(WorldPage, { authRequired: true })),
  // Old link from before the hub existed.
  route("DashboardRoute", "/dashboard", page(DashboardRedirect)),

  query(getMyApps, { entities: ["UserApp"] }),
  action(addApp, { entities: ["UserApp"] }),
  action(removeApp, { entities: ["UserApp"] }),
];
