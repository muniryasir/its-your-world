# ◐ It's Your World

[![CI](https://github.com/muniryasir/its-your-world/actions/workflows/ci.yml/badge.svg)](https://github.com/muniryasir/its-your-world/actions/workflows/ci.yml)

**One login, your whole world.** It's Your World is a personal hub that brings separate experiences together under a single account. The first module is an **investment portfolio simulator**: invest demo cash in oil, crypto, US stocks and metals. The second is an **arcade** of browser games with server-verified leaderboards, starting with **Starfall**, an original falling-block puzzle game.

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
| Portfolio app: portfolios with demo cash, total value and return | ✅ |
| Markets: top 10 assets in Oil & Energy, Crypto, US Stocks and Metals | ✅ |
| Asset detail: price chart (1M–1Y), key stats, about, your position | ✅ |
| Buy (by dollar amount or quantity) and sell (some or all) | ✅ |
| Holdings with average cost and gain/loss, allocation by asset class, trade history | ✅ |
| Seeded demo account | ✅ |
| App access and ownership enforced on the server (403 / 404) | ✅ (covered by CI smoke test) |
| Arcade app: game shelf, nicknames, hub tile | ✅ |
| Starfall: falling-block game, keyboard + touch, leaderboard with server-verified scores | ✅ (covered by CI smoke test) |
| Live market prices | ⏸ Phase 2 (prices are simulated demo data) |
| CSV export, admin panel | ⏸ Phase 3 |

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

It's Your World is a **hub of apps** that share one account. After logging in, users land on their world (`/world`) and add the apps they want. Portfolio and the Arcade are live.

```
main.wasp.ts              App spec: shell routes, auth, imports each module's spec
schema.prisma             User → UserApp (added apps) and each app's own models
src/
  shell/                  Layout, home page, login/signup, shared "space" styles and art
  world/                  Hub page, app catalog, add/remove apps, access gate
  apps/
    portfolio/            Portfolio app (pages, server operations, hub tile, own spec file)
    arcade/               Arcade app (shelf, game pages, run verification); games/ holds each game
  db/seed.ts              Demo user + sample portfolios (trades replayed at past demo prices)
scripts/smoke-test.sh     Server security checks (auth, app access, ownership), run by CI
e2e/                      Real-browser checks and design screenshots, run by CI
docs/apps.md              How apps plug into the world, and the rules they follow
```

### Design notes

- **Apps are modules, not separate deployments.** "Adding an app" creates a `UserApp` row; the code already ships. Each app has a manifest, its own Wasp spec file, a hub tile and optional setup hooks (see `docs/apps.md`).
- **Access is enforced on the server.** Every app operation checks that the user is logged in (401) and has added the app (403). Every record is fetched with the user's id in the query, and other users' records answer exactly like missing ones (404).
- **Removing an app keeps its data**, so adding it back restores everything.
- **Money is stored and calculated as `Decimal`**, not floating point. Trades run in a transaction that locks the portfolio row, so two trades can't spend the same cash.
- **Prices are simulated (demo data).** `src/apps/portfolio/market/` holds the catalog of 40 real assets and a deterministic, mean-reverting random walk that gives each one a new closing price every day. The same day always gives the same price, so nothing has to be stored. Trades always use the server's price, never one sent by the browser. Swapping in live data later only touches `market/`.

## Arcade: Starfall

The Arcade is a shelf of games inside your world. Users add games to their arcade the way they add apps to their world, play in the browser and compete on a leaderboard under a nickname (never their login). **Starfall** is the first game: crystals fall into a 10 × 20 field, full rows burn away, four at once is a *supernova*. It plays with the keyboard or on-screen touch buttons, and has hold, a three-piece preview, a landing ghost, wall kicks and a level that speeds up every 10 rows.

### How scores are protected

A leaderboard that accepts whatever number the browser sends is trivially cheatable. Starfall never sends a score:

1. **The server starts the run.** Pressing *Start* asks the server for a run. It stores a random **seed**, and the seed decides the order of every piece in the game, so nobody can pick a lucky game.
2. **The browser records inputs, not results.** The game engine (`src/apps/arcade/games/starfall/engine.ts`) is plain TypeScript with no browser code. It advances in fixed ticks (60 per second) using integer math, and records each key press with the tick it happened on, e.g. `A0G1kH3`.
3. **The server replays the game.** When the run ends, the browser sends only that input log. The server runs the *same engine* with the stored seed and the inputs, and saves the score the replay produces. An hour-long game replays in milliseconds.
4. **Plausibility checks.** A run can be submitted once. A run whose game time is longer than the real time since it started is rejected, so a client can't fast-forward the clock. Malformed logs are rejected and so are logs that continue after the game ended or stop without an end. Runs expire after two hours, and starting a new run abandons the open one. CI checks each of these rules against the running server (`scripts/smoke-test.sh`).

**What this doesn't stop:** someone who writes a bot that plays well, or plays in slow motion, produces real inputs that replay into a real score. That's the honest limit of any client-side game without server-side play or anti-cheat software. The seeded demo players on the leaderboard are in fact a simple bot (`games/starfall/bot.ts`) playing real, replayable runs.

### Adding a game

Each game lives in `src/apps/arcade/games/<id>/` with a deterministic engine and a `verify(seed, log)` function. It is registered in three places: `games/catalog.ts` (name, controls, credits), `games/server.ts` (verification) and `games/client.tsx` (play component and cover art). Runs, the leaderboard and nicknames are shared by every game.

### Content and licensing

Starfall is an **original game** written for this project. Its name, artwork and code are part of this repository; it uses no ROMs, sprites, sounds, names or logos from commercial games. The falling-block genre itself isn't owned by anyone. The *look* of famous games in it is protected, which is why Starfall uses its own crystal artwork and name.

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

- **Phase 2:** more Arcade games, rewards tied to portfolio activity, and live market prices
- **Phase 3:** CSV export, admin panel for the market catalog
- Public deployment
