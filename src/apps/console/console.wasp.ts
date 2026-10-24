// Wasp spec for the Console app (console/cricket branch). Imported by main.wasp.ts.
// Phase 2: one page, batting practice. The Console app joins the World catalog in phase 5.
import { page, route } from "@wasp.sh/spec";
import { CricketPage } from "./cricket/CricketPage" with { type: "ref" };

export const consoleSpec = [
  route("ConsoleCricketRoute", "/console/cricket", page(CricketPage, { authRequired: true })),
];
