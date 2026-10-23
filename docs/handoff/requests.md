# Requests between chats

When one chat needs a change in an area another chat owns, add an entry here
and tell Yasir. The owning chat removes the entry once it's done.

Format:
- **From:** portfolio app · **To:** world shell · **What:** … · **Why:** …

## Open requests

- **From:** arcade app · **To:** world shell · **What:** update the home page's Arcade panel (`src/shell/LandingPage.tsx`, `ArcadePreview`): the Arcade is live now ("Arcade opens soon" → e.g. "Now playing: Starfall"), and the copy "modded classics … rewards linked to portfolio activity" no longer matches. Suggested: "Play original browser games like Starfall and climb leaderboards where every score is verified by the server." Also `docs/apps.md` still calls the Arcade "coming soon, manifest only". · **Why:** Arcade PR `arcade/starfall` switches the manifest to `live`; the home page wording is the shell's.
- **From:** arcade app · **To:** world shell · **FYI:** the Arcade PR adds three relation lines to the `User` model (`arcadePlayer`, `arcadeGames`, `gameRuns`, under "App relations", as Portfolio did) and replaces the smoke test's "coming-soon apps can't be added" check, which used the Arcade and has no other coming-soon app to test with now. Re-add it if a coming-soon app appears. · **Why:** Prisma needs the back-relations; the old check would fail once the Arcade is live.
