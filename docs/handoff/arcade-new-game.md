# Handoff: adding a new game to the Arcade

You're adding **one new game** to the Arcade app in It's Your World. The Arcade itself (shelf, runs, leaderboards, nicknames) and the first game, **Starfall**, already exist and are owned by the Arcade chat. Read `CLAUDE.md`, `docs/apps.md`, `docs/handoff/arcade-app.md` and the README's "Arcade: Starfall" section before changing anything.

**Yasir will explain the game idea at the start of your chat.** Agree on the name, rules, controls, scoring and screens with him before writing code.

## How a game plugs in

Every game is a folder `src/apps/arcade/games/<id>/` plus one entry in each of three registries:

| File | Entry | Purpose |
|---|---|---|
| `games/catalog.ts` | a `GameManifest` added to `GAMES` | id, name, tagline, description, `status`, color, keyboard `controls`, `credits` (origin + license) |
| `games/server.ts` | `<id>: { verify(seed, log) }` in `GAME_SERVERS` | replays a finished run and returns `{ score, ticks, durationMs, stats }`; throws `InvalidLogError` for bad logs |
| `games/client.tsx` | `<id>: { Play, Cover }` in `GAME_CLIENTS` | the playable component and the shelf cover art |

Everything else is shared and works for any game: the shelf (`/arcade`), the game page (`/arcade/<id>`, which renders your `Play` component next to "Your best" and the leaderboard), runs, nicknames, the hub tile. New users get Starfall automatically; other games are added from the shelf's "Add games" section.

## The rules a game must follow

1. **Scores are verified by replay, never sent by the browser.** The game needs a **deterministic engine** in plain TypeScript (no DOM, no `Math.random`, no `Date`): fixed ticks (Starfall uses 60/s), integer math, randomness only from the run's seed. The browser records inputs with their tick; the server replays them. Copy the pattern from `games/starfall/engine.ts` (`InputRecorder`, `replay`) and `StarfallGame.tsx` (the `Controller` class, `startRun` / `finishRun`).
2. **The log must end with an "end" entry** at the tick where the game stopped, and stay under ~90 KB (Wasp's request limit is 100 KB). Runs can last at most 1 hour and expire after 2 hours (`operations.ts`).
3. **Higher score = better.** The leaderboard ranks by the highest `score`. A game where *lower* or *faster* is better (e.g. best time) needs a change to shared code; raise it with Yasir first.
4. **`stats`** is free-form per game (Starfall stores `lines`, `level`, …). The leaderboard's extra column and "Recent runs" currently show `stats.lines`; if your game needs a different column, that's a shared change (see below).
5. **Legal content only:** original games, or open-source/homebrew with a license that allows it (note it in `credits` and the README). No commercial ROMs, sprites, sounds, names or logos. Use an original name and look, even when the game follows a classic genre (Starfall is a falling-block game, not "Tetris").
6. **Look:** dark space theme, the Arcade's pink `#ff5fa2` and sun yellow, the pixel font `"Press Start 2P"` for scores. Prefix your CSS classes (Starfall uses `sf-`) and put them in a CSS file in your game's folder (Starfall's styles sit in the shared `arcade.css`; don't add yours there).
7. Test the engine in the cloud session with `npx tsx` (determinism: play → record → replay must give the same score; tampered logs must fail). `wasp compile` doesn't run there; CI does.

## What's yours, and what isn't

**You own:** `src/apps/arcade/games/<id>/**`, your one-line entries in the three registries, your game's cover, its parts of `src/apps/arcade/seed.ts` (optional demo runs, e.g. from a bot like `games/starfall/bot.ts`), `scripts/smoke-test.sh`, `e2e/browser-check.mjs`, `e2e/screenshots.mjs`, and a section for your game in the README.

**Ask first** (write it in `docs/handoff/requests.md` and tell Yasir): anything else in `src/apps/arcade/` (operations, pages, `arcade.css`, models), Starfall's files, and everything outside the Arcade. No schema change should be needed for a normal score-based game.

## How to work

1. Branch from `main` once the Arcade PR (#2, `arcade/starfall`) is merged. If it isn't merged yet, branch from `arcade/starfall` and say so in your PR.
2. Name the branch `arcade/<id>`. Push; CI runs compile, migrations, seed, build, smoke tests, browser check, dev container and screenshots (`screenshots-arcade-<id>`). Read failures from check-run annotations through the API.
3. Review your screenshots, desktop and mobile (the Starfall page has a check that fails if it's wider than a 390 px phone; add the same for yours).
4. When CI is green, open a PR to `main` with a summary and screenshots. Yasir tests in a new codespace on the branch.
