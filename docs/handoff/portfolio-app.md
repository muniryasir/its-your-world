# Handoff: the Portfolio app

You're taking over the **Portfolio app** inside It's Your World. Another chat owns the world shell (home page, login, hub, catalog). Read this file and `docs/apps.md` before changing anything.

## Context

- **Owner:** Yasir, a freelance software developer building a portfolio of showcase projects for Upwork clients. This project is one of them, so code quality, a clear README and good screenshots matter.
- **Repo:** `muniryasir/its-your-world`. Stack: Wasp 0.26 (React 19 + TypeScript, Node, Prisma 5, PostgreSQL), plain CSS, no UI libraries.
- **Working style Yasir asked for:** don't ask him to run commands one by one. Build or extend a diagnostics script whose output you can read yourself (see `scripts/diagnose.sh` and the `diagnostics` branch). He tests in GitHub Codespaces: opening a codespace sets everything up automatically.
- **Environment limits:** Claude's cloud workspace can't download Prisma engines (binaries.prisma.sh is blocked), so `wasp compile`/`wasp start` don't work there. Verify through GitHub Actions instead. Raw Actions logs can't be downloaded either; read check-run **annotations** through the API (`scripts/ci-run.sh` turns failures into annotations).

## What already exists

The Portfolio app is a **simulator**: each portfolio gets demo cash (default $100,000) to invest in 40 assets across four asset classes, at simulated daily prices.

| File | What it is |
|---|---|
| `src/apps/portfolio/manifest.ts` | id `portfolio`, basePath `/portfolio`, status `live` |
| `src/apps/portfolio/portfolio.wasp.ts` | routes `/portfolio`, `/portfolio/markets`, `/portfolio/markets/:symbol`, `/portfolio/:id`; queries `getMarket`, `getAsset`, `getPortfolios`, `getPortfolio`; actions `createPortfolio`, `buyAsset`, `sellAsset` |
| `src/apps/portfolio/operations.ts` | server logic; every operation calls `requireAppAdded` and scopes by `userId`; trades lock the portfolio row |
| `src/apps/portfolio/market/catalog.ts` | the 40 assets (10 per class): name, unit, base price, volatility, facts, supply |
| `src/apps/portfolio/market/prices.ts` | deterministic daily price simulation: `quote`, `history`, `closeOn` |
| `src/apps/portfolio/assetClasses.ts` | the four classes and their chart colors (shared by client and server) |
| `src/apps/portfolio/PortfolioHomePage.tsx` | totals across portfolios, combined allocation, portfolio cards, create form (with starting cash), market links |
| `src/apps/portfolio/MarketsPage.tsx` | tabs per asset class, top 10 table with price, 1-day change, 30-day sparkline |
| `src/apps/portfolio/AssetPage.tsx` | asset detail: price chart, key stats, about, your position, buy/sell panel |
| `src/apps/portfolio/PortfolioDetailPage.tsx` | value/return/cash stats, allocation, holdings table, recent trades |
| `src/apps/portfolio/charts.tsx` | SVG sparkline, price chart (hover tooltip), allocation bar |
| `src/apps/portfolio/PortfolioTile.tsx` | summary on the user's hub (total value, return, count) |
| `src/apps/portfolio/onAdd.ts` | creates "My portfolio" (with default demo cash) when a user first adds the app |
| `src/apps/portfolio/portfolio.css`, `format.ts` | styles and number formatting |
| `schema.prisma` → "Portfolio app models" section | `Portfolio` (with `startingCash`, `cash`), `Holding` (average cost), `Trade` (money stored as `Decimal`) |
| `src/db/seed.ts` | demo account `demo` / `demo1234` with 3 portfolios whose trades are replayed at past demo prices |

### Terms

- **Asset class:** Oil & Energy, Crypto, US Stocks, Metals.
- **Asset:** one thing in the market catalog (Brent Crude, Bitcoin, Apple, Gold).
- **Holding:** what a portfolio owns of one asset (quantity and cost basis).
- **Trade:** one buy or sell, kept as history.

## What's yours to change, and what isn't

**You own** (change freely):
- everything in `src/apps/portfolio/`
- the "Portfolio app models" section of `schema.prisma`, plus new migrations for it
- the portfolio part of `src/db/seed.ts` (the `DEMO_PORTFOLIOS` data and loop)
- portfolio checks in `scripts/smoke-test.sh`, `e2e/browser-check.mjs` and `e2e/screenshots.mjs`
- the portfolio sections of `README.md`

**Ask Yasir first** (the shell chat owns these):
- `src/shell/**`, `src/world/**` (except the one-line registry entries for portfolio)
- `main.wasp.ts`, `.devcontainer/**`, `.github/**`, `scripts/diagnose.sh`
- the World models (`User`, `UserApp`) in `schema.prisma`

If you need something from the shell, such as a new tile style or a nav change, write it down in `docs/handoff/requests.md` and tell Yasir.

## Rules you must keep

The security rules in `docs/apps.md` apply to every new operation:
`"UserApp"` in entities, `requireAppAdded(context, "portfolio")` first, `userId` in every `where`, 404 for other users' records. Add a smoke test for each new operation, covering both the normal case and another user's record.

## How to work

1. Work on a branch, e.g. `portfolio/edit-investments`. Never push to `main` directly.
2. Push; CI runs on the branch. Read results through the GitHub API (runs → jobs → check-run annotations).
3. Review your screenshots on the `screenshots-<branch>` branch, e.g. `screenshots-portfolio-edit-investments`.
4. When CI is green, open a pull request to `main` and give Yasir a short summary with screenshots. He tests in a codespace on that branch, then merges.

## Suggested backlog (confirm priorities with Yasir before starting)

1. **Rename and delete** portfolios (with confirmation; keep ownership checks).
2. ~~Update current prices inline~~ (done differently: prices are simulated daily).
3. **Visual refresh** of the portfolio pages to fit the cosmic look of the shell (dark or light is Yasir's call). Keep plain CSS.
4. **Better empty states and validation messages** (e.g. a new user's "My portfolio" with no holdings).
5. Later phases: **live market prices** (replace `market/prices.ts`), **admin panel** for the catalog, **CSV export**. (Charts: done.)
6. A **case-study section** for the Portfolio app in the README (problem, approach, screenshots).
