# Requests between chats

When one chat needs a change in an area another chat owns, add an entry here
and tell Yasir. The owning chat removes the entry once it's done.

Format:
- **From:** portfolio app · **To:** world shell · **What:** … · **Why:** …

## Open requests

- **From:** Nova Raiders game · **To:** Arcade app · **What:** (1) a per-game option to hide the leaderboard on the game page, e.g. `leaderboard: false` in `GameManifest`, with Nova Raiders switched to it; (2) a per-game extra stat for "Recent runs" and the leaderboard column instead of the fixed `stats.lines` / "Rows", e.g. `stat: { key: "level", label: "Level" }` in `GameManifest`. · **Why:** Yasir doesn't want a leaderboard for Nova Raiders. Until then its page shows the shared leaderboard and its recent runs read "0 rows". Nova Raiders stores `level`, `wave`, `difficulty`, `kills`, `lives`, `shotsFired`, `shotsHit` and `end` in `stats`.

## Done

- 2026-10-23 · arcade → shell: home page Arcade panel and `docs/apps.md` updated for the live Arcade (Starfall). Portfolio panel updated for the simulator at the same time.
- 2026-10-23 · arcade → shell (FYI): `User` back-relations for Arcade models and the replaced "coming-soon apps can't be added" smoke check are noted; re-add that check if a coming-soon app appears.
