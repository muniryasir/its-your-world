# How apps work in It's Your World

It's Your World is one Wasp codebase with two layers:

- **The world shell** (`src/shell/`, `src/world/`): home page, login/signup, the hub at `/world`, the app catalog, adding/removing apps, the access gate, navigation.
- **Apps** (`src/apps/<id>/`): self-contained features that users add to their world. Today there's `portfolio` (live) and `arcade` (coming soon, manifest only).

"Adding an app" doesn't install code. All apps ship in the codebase; the `UserApp` table records which apps each user has added.

```
User ──< UserApp (userId, appId, position, addedAt)      ← shell
User ──< Portfolio ──< Investment                         ← portfolio app
```

## The app contract

Every app lives in `src/apps/<id>/` and provides:

| Piece | File (portfolio example) | Purpose |
|---|---|---|
| Manifest | `manifest.ts` | id, name, tagline, description, status (`live` / `coming-soon`), color, `basePath`. Plain data only. |
| Wasp spec | `portfolio.wasp.ts` | The app's routes, queries and actions, exported as an array (`portfolioSpec`). |
| Hub tile | `PortfolioTile.tsx` | Small summary shown on the user's hub (a few numbers, no actions). |
| Planet art | currently `src/shell/art/Planets.tsx` | The app's planet, used in the hub orbit, catalog and gate. |
| `onAdd` hook (optional) | `onAdd.ts` | Server-side setup the first time a user adds the app. |
| Styles | `portfolio.css` | The app's own CSS, imported by its pages. |

The shell connects these in three registry files, which are the **only** shell files an app needs to touch:

- `src/world/catalog.ts`: add the manifest to `APPS`
- `src/world/clientRegistry.tsx`: map the id to `{ Planet, Tile }`
- `src/world/serverHooks.ts`: map the id to `{ onAdd }` (if any)

`main.wasp.ts` imports each app's spec array (`portfolioSpec`).

## Security rules (non-negotiable)

1. **Every route** of an app lives under its manifest's `basePath` and uses `authRequired: true`.
2. **Every query and action** of an app:
   - lists `"UserApp"` in its `entities`, and
   - starts with `const user = await requireAppAdded(context, "<appId>")` (from `src/world/requireApp.ts`).

   This returns **401** when no one is logged in and **403** when the user hasn't added the app.
3. **Every database read or write is scoped to the user.** Put `userId: user.id` in the `where` clause (e.g. `findFirst({ where: { id, userId: user.id } })`). Records that belong to someone else are answered exactly like missing records: **404**, never 403.
4. Removing an app keeps its data. `onAdd` must be safe to run again for a user who already has data.

The shell also blocks an app's pages in the browser when the app isn't added (`AppGate`). That is a convenience; rules 2 and 3 are the real protection.

`scripts/smoke-test.sh` checks these rules against the running server on every push. When you add an operation, add a check for it there.

## Styling

- The home page and the hub use the dark "space" look (`src/shell/space.css`, fonts *Unbounded* + *Figtree*). Shared tokens: `--night`, `--night-deep`, `--starlight`, `--mist`, `--teal`, `--pink`, `--sun`, `--font-cosmic`, `--font-text`.
- App pages render inside the light shell by default (`src/shell/app.css`). An app may restyle its own pages in its own CSS file, but must not change shell CSS.
- An app can opt into the dark space shell with `theme: "space"` in its manifest (Portfolio does). The header then floats over the page like on the hub, so the app's pages add their own top padding, and the space tokens (`--night`, `--starlight`, `--mist`, `--teal`, `--font-cosmic`, …) are available to its CSS.
- Hub tiles render on a dark card: use the `tile-*` classes from `src/world/world.css` (`tile-stats`, `tile-label`, `tile-value`, `tile-pos`, `tile-neg`, `tile-muted`).

## Testing and reviewing

- **CI** (`.github/workflows/ci.yml`) runs on every push to every branch: compile, migrations check, seed, production build, `scripts/smoke-test.sh` (security rules), `e2e/browser-check.mjs` (real browser flow), and a dev-container build.
- **Screenshots:** `e2e/screenshots.mjs` captures key pages. Pushes to `main` go to the `screenshots` branch; pushes to another branch go to `screenshots-<branch>` (slashes become dashes). Review the design there before asking anyone to test.
- **Codespaces:** opening a codespace sets everything up and starts the app. `scripts/diagnose.sh` runs automatically and pushes a log to the `diagnostics` branch. When something breaks, read that log (or improve the script) instead of asking the user to run commands.
- **Migrations:** after changing `schema.prisma`, commit a migration in `migrations/`. If you can't run `wasp db migrate-dev` locally, push anyway: CI fails and prints the SQL Prisma expects in the error annotation. Commit that as `migrations/<timestamp>_<name>/migration.sql`.

## Adding a new app (checklist)

1. Create `src/apps/<id>/` with `manifest.ts` (status `coming-soon` until it works).
2. Add the manifest to `catalog.ts`, the planet/tile to `clientRegistry.tsx`, any hooks to `serverHooks.ts`.
3. Create `<id>.wasp.ts` with routes under `basePath` and operations that follow the security rules; import it in `main.wasp.ts`.
4. Add the app's models to `schema.prisma` in its own section, with a migration.
5. Add smoke tests for its operations and a screenshot of its main page.
6. Switch the manifest to `live`.
