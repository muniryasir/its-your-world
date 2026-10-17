// Wasp spec for the Portfolio app. Imported by main.wasp.ts.
// Every route must live under the manifest's basePath ("/portfolio").
// Every query/action must list "UserApp" in entities and call requireAppAdded().
import { action, page, query, route } from "@wasp.sh/spec";
import { PortfolioHomePage } from "./PortfolioHomePage" with { type: "ref" };
import { PortfolioDetailPage } from "./PortfolioDetailPage" with { type: "ref" };
import {
  getPortfolios,
  getPortfolio,
  createPortfolio,
  createInvestment,
} from "./operations" with { type: "ref" };

export const portfolioSpec = [
  route("PortfolioHomeRoute", "/portfolio", page(PortfolioHomePage, { authRequired: true })),
  route("PortfolioDetailRoute", "/portfolio/:id", page(PortfolioDetailPage, { authRequired: true })),

  query(getPortfolios, { entities: ["Portfolio", "Investment", "UserApp"] }),
  query(getPortfolio, { entities: ["Portfolio", "Investment", "UserApp"] }),
  action(createPortfolio, { entities: ["Portfolio", "UserApp"] }),
  action(createInvestment, { entities: ["Portfolio", "Investment", "UserApp"] }),
];
