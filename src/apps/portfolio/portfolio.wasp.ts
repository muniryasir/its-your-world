// Wasp spec for the Portfolio app. Imported by main.wasp.ts.
// Every route must live under the manifest's basePath ("/portfolio").
// Every query/action must list "UserApp" in entities and call requireAppAdded().
import { action, page, query, route } from "@wasp.sh/spec";
import { PortfolioHomePage } from "./PortfolioHomePage" with { type: "ref" };
import { PortfolioDetailPage } from "./PortfolioDetailPage" with { type: "ref" };
import { MarketsPage } from "./MarketsPage" with { type: "ref" };
import { AssetPage } from "./AssetPage" with { type: "ref" };
import {
  getMarket,
  getAsset,
  getPortfolios,
  getPortfolio,
  createPortfolio,
  buyAsset,
  sellAsset,
} from "./operations" with { type: "ref" };

export const portfolioSpec = [
  route("PortfolioHomeRoute", "/portfolio", page(PortfolioHomePage, { authRequired: true })),
  route("MarketsRoute", "/portfolio/markets", page(MarketsPage, { authRequired: true })),
  route("AssetRoute", "/portfolio/markets/:symbol", page(AssetPage, { authRequired: true })),
  route("PortfolioDetailRoute", "/portfolio/:id", page(PortfolioDetailPage, { authRequired: true })),

  query(getMarket, { entities: ["UserApp"] }),
  query(getAsset, { entities: ["Portfolio", "Holding", "UserApp"] }),
  query(getPortfolios, { entities: ["Portfolio", "Holding", "UserApp"] }),
  query(getPortfolio, { entities: ["Portfolio", "Holding", "Trade", "UserApp"] }),
  action(createPortfolio, { entities: ["Portfolio", "UserApp"] }),
  action(buyAsset, { entities: ["Portfolio", "Holding", "Trade", "UserApp"] }),
  action(sellAsset, { entities: ["Portfolio", "Holding", "Trade", "UserApp"] }),
];
