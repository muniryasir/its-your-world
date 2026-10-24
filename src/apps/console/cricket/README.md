# Console Cricket

*Brian Lara Cricket 96* (Sega Mega Drive, Codemasters, 1996) rebuilt as a web game from its ROM:
the game logic is read out of the 68000 machine code and rewritten in TypeScript, then checked tick by
tick against the original running in an emulator. Nothing is emulated in the browser.

Branch `console/cricket` only (merged into `main` when the whole project is done). This branch also
holds values copied from the ROM (tables, sprite collision masks, start states); the ROM itself, the
disassembly and the original art are never committed.

## What works (phase 2: batting)

`/console/cricket` (logged in): batting practice against a bowling machine.

- The machine is the original's computer bowler: how it picks line and length, the swing/spin and pace
  meters, the run-up, the release, the ball's flight, bounce, swing and spin.
- The batsman is the original's: footwork, shot choice from the pad, the shot plan, timing, contact
  against the bat's outline, edges, where the ball goes off the bat (including the gaps in the field).
- Bowled, LBW, caught by the keeper or slips, wides, the keeper and slips diving: the original's logic.
- Settings: bowler type (fast, swing, spin), bowling arm, accuracy, difficulty (the original's three
  levels), left- or right-handed batsman.

Controls: arrows for direction (diagonals too) and footwork, `Z` keeps the shot on the ground, `X`
lofts it, `Space` bowls the next ball, `P` pauses. Touch screens get an on-screen pad.

## Layout

| Path | What |
|---|---|
| `engine/` | The rebuilt game logic. Plain TypeScript, deterministic, integer maths that reproduces the 68000's (`m68k.ts`). State lives in a 64 KB `Ram` with the original's own addresses, so every routine can be compared with the original's memory. Each function names the original routine it rebuilds (`sub_04486A` = code at ROM address $4486A). |
| `engine/engine.ts` | One delivery: the original's loops (aim, meters, run-up, ball live) and the order of the work in each game tick. |
| `engine/practice.ts` | The game layer for practice: settings, score, results, and what to draw. |
| `engine/romData.ts`, `maskData.ts`, `baseState.ts` | Generated from the ROM / emulator by the analysis tools (outside this repo). Don't edit. |
| `render.ts`, `Nets.tsx`, `CricketPage.tsx`, `cricket.css` | The page. Positions come from the original's projection and sprite placement; players are drawn as flat silhouettes cut from the collision masks (our own look, not the original art). |
| `traces/` | 89 recorded deliveries from the original (start state, pad input per tick, every value the engine models after every tick). |
| `tools/check.ts` | The fidelity check: runs the engine on every trace and compares. |

## Fidelity check

```
npx tsx src/apps/console/cricket/tools/check.ts            # all traces
npx tsx src/apps/console/cricket/tools/check.ts traces/UA@104.json.gz
```

Current result: 88 of 89 traces match on every compared value for the whole delivery (16,634 ticks),
covering no-shot deliveries, every shot direction with both shot buttons at several timings, footwork,
random play, both batsmen, several deliveries in a row and later overs. The one known difference is
listed below.

## Known differences

- **Trace `start_s0_d4`.** In one routine (`sub_048202`, close fielders steering) the original divides by
  a register whose upper half is left over from earlier code. The engine can't reproduce that garbage;
  the result differs by one unit in one rare case.
- **A stale pointer in the original.** `sub_0471D8` calls `sub_048202` without setting the register it
  reads the "hand frame" from, so it reads the main task's stack frame (the word at `$FFFF8D96`). That
  word is `$160` throughout the delivery loops, so the engine uses that constant.
- **Things the checker skips**: VBlank counters and the pad words (the emulator samples the pad a frame
  later than the game tick reads it).

## Phase-2 placeholders (replaced in later phases)

- **After the ball leaves the batting view** the original cuts to the fielding view (phase 3). Until then
  the page follows the ball with the original's ball physics and scores it: it reaches the rope (6,400
  units from the middle, about the original's straight boundaries) for four, or six on the full;
  otherwise 0–3 runs by how far from the striker's crease it stopped. No outfielders, no run-outs.
- **The machine's set-up** (choosing its line, the meters) runs four ticks per frame, so balls come
  quicker. Same logic, less waiting.
- **The look** is ours (silhouettes, night ground, our pitch and creases drawn through the original's
  projection). The original's background art is not used.
- Balls faced feed the original's misjudge rolls; the rest of the batsman's and bowler's records are the
  recorded match's (England's openers, first over).
