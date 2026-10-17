import { app, page, route } from "@wasp.sh/spec";

// Shell: landing, auth pages and the app-wide layout
import { Layout } from "./src/shell/Layout" with { type: "ref" };
import { LandingPage } from "./src/shell/LandingPage" with { type: "ref" };
import { LoginPage } from "./src/shell/LoginPage" with { type: "ref" };
import { SignupPage } from "./src/shell/SignupPage" with { type: "ref" };

// World hub (app catalog, add/remove apps)
import { worldSpec } from "./src/world/world.wasp";

// Apps. Each app keeps its own spec file; see docs/apps.md.
import { portfolioSpec } from "./src/apps/portfolio/portfolio.wasp";

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
    onAuthSucceededRedirectTo: "/world",
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

    worldSpec,
    portfolioSpec,
  ],
});
