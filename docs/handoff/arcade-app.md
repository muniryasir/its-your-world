# Handoff: the Arcade app (games)

You're building the **Arcade app** inside It's Your World. Other chats own the world shell (home page, login, hub, catalog) and the Portfolio app. Read this file, `CLAUDE.md` and `docs/apps.md` before changing anything.

**Yasir will explain how the games should be structured at the start of your chat.** Don't design the game system before he does. Get set up, read the code, then listen and propose a plan.

## Context

- **Owner:** Yasir, a freelance software developer building a portfolio of showcase projects for Upwork clients. This project is one of them, so code quality, a clear README and good screenshots matter.
- **Repo:** `muniryasir/its-your-world`. Stack: Wasp 0.26 (React 19 + TypeScript, Node, Prisma 5, PostgreSQL), plain CSS, no UI libraries so far. Ask Yasir before adding a game engine or other large dependency.
- **Working style Yasir asked for:** don't ask him to run commands one by one. Build or extend a diagnostics script whose output you can read yourself (see `scripts/diagnose.sh` and the `diagnostics` branch). He tests in GitHub Codespaces: opening a codespace sets everything up automatically.
- **Environment limits:** Claude's cloud workspace can't download Prisma engines (binaries.prisma.sh is blocked), so `wasp compile`/`wasp start` don't work there. Verify through GitHub Actions instead. Raw Actions logs can't be downloaded either; read check-run **annotations** through the API (`scripts/ci-run.sh` turns failures into annotations).

## What already exists for the Arcade

Only placeholders:

| Where | What |
|---|---|
| `src/apps/arcade/manifest.ts` | id `arcade`, basePath `/arcade`, status `coming-soon`, color `#ff5fa2` |
| `src/world/catalog.ts` | Arcade is listed (shown as "Coming soon", can't be added yet) |
| `src/world/clientRegistry.tsx` | `arcade: { Planet: ArcadePlanet }` (no hub tile yet) |
| `src/shell/art/Planets.tsx` | `ArcadePlanet`, the pink pixel planet with a yellow ring |
| Home page (`src/shell/LandingPage.tsx`) | an Arcade panel: "Play retro games, modded classics, leaderboards, rewards linked to portfolio activity" |

Study the Portfolio app (`src/apps/portfolio/`) as the working example of an app: manifest, its own `portfolio.wasp.ts`, operations guarded by `requireAppAdded`, a hub tile, an `onAdd` hook, its own CSS, and `theme: "space"` for the dark look.

## What's yours to change, and what isn't

**You own** (change freely):
- everything in `src/apps/arcade/`
- a new "Arcade app models" section in `schema.prisma`, plus migrations for it
- arcade parts of `src/db/seed.ts` (e.g. demo scores), `scripts/smoke-test.sh`, `e2e/browser-check.mjs`, `e2e/screenshots.mjs`
- an Arcade section in `README.md`

**Small edits in shell files that you may make** (registry one-liners, as Portfolio did):
- `src/world/clientRegistry.tsx`: add your `Tile` (and your own planet, if you make one)
- `src/world/serverHooks.ts`: add `arcade: { onAdd }` if you need setup when a user adds the app
- `main.wasp.ts`: import your `arcadeSpec` and add it to `spec`, next to `portfolioSpec`

**Ask Yasir first** for anything else outside `src/apps/arcade/`. That includes other changes in `src/shell/**` or `src/world/**`, `.devcontainer/**`, `.github/**`, the World or Portfolio models, and the home page's Arcade wording if your plan differs from it. Write the request in `docs/handoff/requests.md`.

## Rules you must keep

1. **Security** (`docs/apps.md`): every query/action lists `"UserApp"` in entities, calls `await requireAppAdded(context, "arcade")` first, scopes every DB query by `userId`, and answers 404 for other users' records. Add smoke tests for each operation.
2. **Scores come from the server's view of the game, not blindly from the client.** A leaderboard that accepts any number the browser sends is trivially cheatable. Validate at least plausibility (e.g. max score per second played, one session id per run) and say in the README what is and isn't protected.
3. **Game content must be legal to publish.** Don't commit or load commercial console ROMs, copyrighted sprites, music or names/logos of real games. Use original games, or open-source/homebrew games whose license allows it, and note the license in the repo. If "modded classics" means something specific, clarify it with Yasir before building.
4. **No direct reads of another app's tables.** "Rewards tied to portfolio activity" crosses apps. Agree the interface with Yasir first; the shell chat will add a shared, read-only function for it. Don't query `Portfolio`/`Holding`/`Trade` from Arcade code.
5. **Release the app by switching the manifest to `status: "live"`** only when it works end to end; that's what makes it addable in the catalog.

## How to work

1. Work on a branch, e.g. `arcade/first-game`. Never push to `main` directly. Pull `main` into your branch regularly. Portfolio work is landing in parallel.
2. Push; CI runs on the branch. Read results through the GitHub API (runs → jobs → check-run annotations).
3. Review your screenshots on the `screenshots-<branch>` branch (slashes become dashes, e.g. `screenshots-arcade-first-game`). Add your own pages to `e2e/screenshots.mjs`.
4. When CI is green, open a pull request to `main` with a short summary and screenshots. Yasir tests in a codespace on that branch, then merges.

## Suggested first steps

1. Confirm GitHub access, read the code above, and summarize back to Yasir how an app plugs into the world.
2. Listen to Yasir's game structure, then propose: pages and routes under `/arcade`, data models (games, sessions, scores…), what the hub tile shows, how scores are protected, and where the game content comes from (with licenses).
3. Build the smallest playable version first: one game, a play page, saving a score, a leaderboard and the hub tile. Then switch the manifest to `live`.

## Adding more games

Games after Starfall may be built in their own chats. Their starting point is `docs/handoff/arcade-new-game.md` (how a game plugs in, the rules, and which files a game chat owns).
