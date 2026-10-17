import { action, app, page, query, route } from "@wasp.sh/spec";

// Shell: landing, auth pages and the app-wide layout
import { Layout } from "./src/shell/Layout" with { type: "ref" };
import { LandingPage } from "./src/shell/LandingPage" with { type: "ref" };
import { LoginPage } from "./src/shell/LoginPage" with { type: "ref" };
import { SignupPage } from "./src/shell/SignupPage" with { type: "ref" };

// Portfolio module
import { DashboardPage } from "./src/portfolio/DashboardPage" with { type: "ref" };
import { PortfolioPage } from "./src/portfolio/PortfolioPage" with { type: "ref" };
import {
  getPortfolios,
  getPortfolio,
  createPortfolio,
  createInvestment,
} from "./src/portfolio/operations" with { type: "ref" };

// Database seed (demo account + sample data)
import { seedDemoData } from "./src/db/seed" with { type: "ref" };

export default app({
  name: "itsYourWorld",
  wasp: { version: "^0.26.0" },
  title: "It's Your World",
  head: ["<link rel='icon' href='/favicon.ico' />"],

  auth: {
    userEntity: "User",
    methods: {
      usernameAndPassword: {},
    },
    onAuthFailedRedirectTo: "/login",
    onAuthSucceededRedirectTo: "/dashboard",
  },

  client: {
    rootComponent: Layout,
  },

  db: {
    seeds: [seedDemoData],
  },

  spec: [
    // Public
    route("LandingRoute", "/", page(LandingPage)),
    route("LoginRoute", "/login", page(LoginPage)),
    route("SignupRoute", "/signup", page(SignupPage)),

    // Portfolio module (login required)
    route("DashboardRoute", "/dashboard", page(DashboardPage, { authRequired: true })),
    route("PortfolioRoute", "/portfolio/:id", page(PortfolioPage, { authRequired: true })),

    query(getPortfolios, { entities: ["Portfolio", "Investment"] }),
    query(getPortfolio, { entities: ["Portfolio", "Investment"] }),
    action(createPortfolio, { entities: ["Portfolio"] }),
    action(createInvestment, { entities: ["Portfolio", "Investment"] }),

    // Arcade module (phase 2) will add its own routes here,
    // e.g. route("ArcadeRoute", "/arcade", page(ArcadePage, { authRequired: true })).
  ],
});
