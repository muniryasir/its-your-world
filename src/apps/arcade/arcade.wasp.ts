// Wasp spec for the Arcade app. Imported by main.wasp.ts.
// Every route must live under the manifest's basePath ("/arcade").
// Every query/action must list "UserApp" in entities and call requireAppAdded().
import { action, page, query, route } from "@wasp.sh/spec";
import { ArcadeHomePage } from "./ArcadeHomePage" with { type: "ref" };
import { GamePage } from "./GamePage" with { type: "ref" };
import {
  getArcade,
  getGame,
  addGame,
  removeGame,
  setNickname,
  startRun,
  finishRun,
} from "./operations" with { type: "ref" };

export const arcadeSpec = [
  route("ArcadeHomeRoute", "/arcade", page(ArcadeHomePage, { authRequired: true })),
  route("ArcadeGameRoute", "/arcade/:gameId", page(GamePage, { authRequired: true })),

  query(getArcade, { entities: ["ArcadePlayer", "ArcadeGame", "GameRun", "UserApp"] }),
  query(getGame, { entities: ["ArcadePlayer", "ArcadeGame", "GameRun", "UserApp"] }),
  action(addGame, { entities: ["ArcadeGame", "UserApp"] }),
  action(removeGame, { entities: ["ArcadeGame", "UserApp"] }),
  action(setNickname, { entities: ["ArcadePlayer", "UserApp"] }),
  action(startRun, { entities: ["ArcadeGame", "GameRun", "UserApp"] }),
  action(finishRun, { entities: ["GameRun", "UserApp"] }),
];
