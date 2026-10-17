# ◐ It's Your World

[![CI](https://github.com/muniryasir/its-your-world/actions/workflows/ci.yml/badge.svg)](https://github.com/muniryasir/its-your-world/actions/workflows/ci.yml)

**One login, your whole world.** It's Your World is a personal hub that brings separate experiences together under a single account. The first module is an **investment portfolio tracker**. A **retro game arcade** comes next.

> Demo login: **`demo` / `demo1234`**

---

## Try it in 2 minutes (no install needed)

The repo is set up for **GitHub Codespaces**, which runs the whole app (database included) in your browser.

1. Click **Code → Codespaces → Create codespace on main**.
2. Wait for setup to finish. The first time takes about 3–5 minutes while it installs Wasp, sets up Postgres and loads demo data.
3. The app starts on its own. When the **"Open in Browser"** popup for port 3000 appears, click it.
   *(Missed it? Open the **Ports** tab and click the globe icon next to port 3000.)*
4. Log in as `demo` / `demo1234`, or sign up for a new account.

When you're done, stop the codespace (**Codespaces → ⋯ → Stop**) so it doesn't use your free hours.

## What works today

| Feature | Status |
|---|---|
| Sign up / log in / log out (username + password) | ✅ |
| Your world hub: add/remove apps, app tiles with summaries | ✅ |
| Portfolio app: portfolios as cards with totals | ✅ |
| Create portfolios | ✅ |
| Holdings table per portfolio, with gain/loss and allocation bar | ✅ |
| Add investments to a portfolio | ✅ |
| Seeded demo account | ✅ |
| App access and ownership enforced on the server (403 / 404) | ✅ (covered by CI smoke test) |
| Arcade module | ⏸ Phase 2 |
| Live market prices | ⏸ Phase 2 (prices are manual / sample data) |
| Charts, export, admin | ⏸ Phase 3 |

## Tech stack

| Layer | Technology |
|---|---|
| Framework | [Wasp](https://wasp.sh) 0.26 (full-stack: React + Node + Prisma) |
| Frontend | React 19 + TypeScript, plain CSS |
| Backend | Node.js, Wasp queries and actions |
| Database | PostgreSQL 16 via Prisma |
| Auth | Wasp built-in username/password, server-side sessions |
| Dev env | GitHub Codespaces (single dev container with Postgres) or WSL2 |
| CI | GitHub Actions: compile, migrate, seed, build, auth/ownership smoke test |

## How it's organized

It's Your World is a **hub of apps** that share one account. After logging in, users land on their world (`/world`) and add the apps they want. Portfolio is live, the Arcade is coming soon.

```
main.wasp.ts              App spec: shell routes, auth, imports each module's spec
schema.prisma             User → UserApp (added apps) and each app's own models
src/
  shell/                  Layout, home page, login/signup, shared "space" styles and art
  world/                  Hub page, app catalog, add/remove apps, access gate
  apps/
    portfolio/            Portfolio app (pages, server operations, hub tile, own spec file)
    arcade/               Arcade manifest (coming soon)
  db/seed.ts              Demo user + sample portfolios
scripts/smoke-test.sh     Server security checks (auth, app access, ownership), run by CI
e2e/                      Real-browser checks and design screenshots, run by CI
docs/apps.md              How apps plug into the world, and the rules they follow
```

### Design notes

- **Apps are modules, not separate deployments.** "Adding an app" creates a `UserApp` row; the code already ships. Each app has a manifest, its own Wasp spec file, a hub tile and optional setup hooks (see `docs/apps.md`).
- **Access is enforced on the server.** Every app operation checks that the user is logged in (401) and has added the app (403). Every record is fetched with the user's id in the query, and other users' records answer exactly like missing ones (404).
- **Removing an app keeps its data**, so adding it back restores everything.
- **Money is stored as `Decimal`**, not floating point. **No live prices yet**: each holding has a manually entered current price.

## Run locally (WSL2 / Linux / macOS)

Requirements: Node.js ≥ 24.14 (npm ≥ 11) and PostgreSQL (or Docker).

```bash
npm install -g @wasp.sh/wasp-cli@0.26.0
cp .env.server.example .env.server
# Postgres: either point DATABASE_URL at your own server,
# or remove DATABASE_URL and run `wasp start db` in a separate terminal (needs Docker).
wasp install
wasp db migrate-dev
wasp db seed          # creates demo / demo1234 (re-run any time to reset the demo data)
wasp start            # http://localhost:3000
```

## Roadmap

- **Phase 2:** Arcade module (modded classic games, leaderboards, rewards tied to portfolio activity) and live market prices
- **Phase 3:** Charts, CSV export, admin panel
- Public deployment
