# Requests between chats

When one chat needs a change in an area another chat owns, add an entry here
and tell Yasir. The owning chat removes the entry once it's done.

Format:
- **From:** portfolio app · **To:** world shell · **What:** … · **Why:** …

## Open requests

- 2026-10-24 · **From:** Console Cricket (branch `console/cricket`) · **To:** world shell · **What:** a CI step that runs the
  cricket fidelity check when it exists, e.g. after the build step:
  `[ -f src/apps/console/cricket/tools/check.ts ] && npx tsx src/apps/console/cricket/tools/check.ts`
  (it exits non-zero on a mismatch and prints one line per trace; ~10 s; needs `tsx` via npx). The guard keeps it a no-op on
  `main` until the branch is merged. · **Why:** the engine is checked tick by tick against recordings of the original game;
  CI should catch a change that breaks that.

## Done

- 2026-10-23 · arcade → shell: home page Arcade panel and `docs/apps.md` updated for the live Arcade (Starfall). Portfolio panel updated for the simulator at the same time.
- 2026-10-23 · arcade → shell (FYI): `User` back-relations for Arcade models and the replaced "coming-soon apps can't be added" smoke check are noted; re-add that check if a coming-soon app appears.
