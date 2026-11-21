# Console Cricket

*Brian Lara Cricket 96* (Sega Mega Drive, Codemasters, 1996) rebuilt as a web game from its ROM:
the game logic is read out of the 68000 machine code and rewritten in TypeScript, then checked tick by
tick against the original running in an emulator. Nothing is emulated in the browser.

Branch `console/cricket` only (merged into `main` when the whole project is done). This branch also
holds data extracted from the ROM (tables, sprite collision masks, start states) and the original art
(decoded sprites and backgrounds; Yasir's decision, 2026-10-29). The ROM itself and the disassembly are
never committed.

## What works (phase 4: full match rules)

`/console/cricket` (logged in) opens on **a match, England v Australia** (tab *Match*); the nets are the
second tab.

- **Setup**: all the original's match settings: play England or Australia or watch the computer, who
  bats first, overs a side (10, 20, 40, 50, 55, 60, 90 or unlimited), period (1 to 5 days), one or two
  innings each, white or coloured kits, level, fielding yourself.
- **Play**: every ball in both views with the original art, then the original's rules between balls:
  strike changes, overs and ends, the bowler limit and bowler changes (the computer captain's plan or
  yours), wickets and the next batsman, innings, targets, results (runs, wickets, an innings, tie,
  draw). Tests have the original's clock: lunch at 1pm, tea at 3:40, close of play, the next day with a
  new pitch report, rain breaks, declarations (the computer captain's, or yours from the pause menu), the
  follow-on, and on the last day "Match drawn" or play on.
- **The page**: the score strip (total, overs, target or lead, the Test clock, batsmen, bowler, this
  over), banners between balls, the captain's questions, the pause menu (`P` / `Esc`: scorecard, change
  the next bowler, declare, auto play to watch the computer play for you, auto play quick to the result,
  abandon). The match is kept in the browser after every ball and resumes from the ball in play.

The rules are checked against seven recorded matches (below): 10 overs computer v computer, you bat,
you bowl, from the toss, a one-day Test, a two-day Test (a new day, a declaration, three rain breaks) and
coloured kits.

### Practice in the nets (phase 3)

Two modes.

**Bat**: against a bowling machine, the original's computer bowler.
- How it picks line and length, the swing/spin and pace meters, the run-up, the release, the ball's
  flight, bounce, swing and spin.
- Your batsman is the original's: footwork, shot choice from the pad, the shot plan, timing, contact
  against the bat's outline, edges, where the ball goes off the bat (including the gaps in the field).
- Bowled, LBW, caught by the keeper or slips, wides, the keeper and slips diving.
- Once the ball leaves the batting view, the original's fielding view: fielders chase, catch, gather
  and throw; running between the wickets (`Z` to run, `Z` again to turn back), run outs, boundaries.
- Settings: bowler type (fast, swing, spin), bowling arm, accuracy, difficulty (the original's three
  levels), left- or right-handed batsman.

**Bowl**: you bowl to the original's computer batsman.
- The original's human bowling: move the aim marker with the arrows, `Z` fixes it; swing and spin
  bowlers pick the way it moves (`←`/`→`, then `Z`); `Z` stops the power meter; tap `Z` in the run-up
  for pace. `C` is never passed on while you bowl (in the original it opens the in-game menu).
- The computer batsman: shot choice from 11 options scored against the field, lofting, footwork, when
  to run.
- Fielding: yourself (the original's human-fielding option, its default): steer the chaser, he catches
  and gathers by himself, `Z`/`X` throw to the keeper's / bowler's end, `C` switches fielder before
  anyone has the ball; the computer takes over when you're idle and after your throw. Or leave it all
  to the computer's fielders.
- Settings: bowler type, arm, rating (it sets how fast your aim marker moves), difficulty, field yourself.

It's the nets: the striker stays on strike. The full rules are in the match.

**Look**: both views use the original art. The batting view: the background (stand, grass, pitch, the
Power and Speed gauges, whose needles follow the meters), every player sprite in the team colours of
the match (the non-striker too), the umpire, the ball and its shadow sized by distance. The fielding
view: the whole ground (scrolled with the original's camera), the fielders with the original's choice of
frame for their facing and action, the batsmen running, both sets of stumps, the umpire, the ball and
its shadow, your fielder's ring, the arrow towards the ball or the stumps, your target marker and the
pitch overlay with the runners' icons. All placed by the original's own display routines (rebuilt in
`engine/fieldSprites.ts`), drawn in its order.

## Layout

| Path | What |
|---|---|
| `engine/` | The rebuilt game logic. Plain TypeScript, deterministic, integer maths that reproduces the 68000's (`m68k.ts`). State lives in a 64 KB `Ram` with the original's own addresses, so every routine can be compared with the original's memory. Each function names the original routine it rebuilds (`sub_04486A` = code at ROM address $4486A). |
| `engine/engine.ts` | One delivery: the original's loops (aim, meters, run-up, ball live, hand-over) and the order of the work in each game tick. |
| `engine/fielding.ts`, `fieldlib.ts` | The fielding view: fielders' states, catches, throws, running, run outs, boundaries, human fielding. |
| `engine/fieldSprites.ts` | The fielding view's display objects (what is on screen, where, which sprite frame), written into RAM like the original's object records, so the traces check them. |
| `engine/aiBatsman.ts` | The computer batsman's shot choice and running. |
| `engine/practice.ts` | The game layer for practice: modes, settings, score, results, and what to draw. |
| `engine/match.ts` | The match rules between balls (the original's over, innings and match loops, the Test clock, intervals, declarations, follow-on, results); `Delivery` plays one ball on the match RAM. |
| `engine/matchGame.ts` | The match layer for the page: a new match from settings, the flow driven one pad sample at a time, questions, scorecards, auto play, save and restore. |
| `engine/baseMatch.ts`, `maskPieces.ts` | Generated: the start RAM of a match; the pieces the original builds its collision masks from. |
| `Match.tsx` | The match page: setup, play, score strip, banners, questions, pause menu, scorecard. |
| `engine/romData.ts`, `maskData.ts`, `fieldData.ts`, `baseState.ts`, `baseBowl.ts` | Generated from the ROM / emulator by the analysis tools (outside this repo) and `tools/genBatBase.ts` / `genBowlBase.ts`. Don't edit. |
| `art/` | The original art, generated by the analysis tools: `batting-bg-*.png` / `batting-fg-*.png` (background and its high-priority gauge tiles, per match palette), `sprites-bat.png` / `sprites-bowl.png` (all sprite frames the page draws, per team palettes), `static.png` (umpire and bowler's-end stumps), `needles.png`; the fielding view's `field-ground-*.png` (the whole ground from the ROM's block map, per match palette), `field-sprites-*.png`, `field-overlay.png`; `atlas.ts`. |
| `render.ts`, `art.ts`, `Nets.tsx`, `CricketPage.tsx`, `cricket.css` | The page. Positions come from the original's projection and sprite placement. Until the art has loaded, players are drawn as silhouettes cut from the collision masks. |
| `traces/` | Recorded deliveries from the original (`*.json.gz`; `bowl_*` = you bowl), fielding views (`traces/field`) and hand-overs to the fielding view (`traces/hand`). |
| `tools/` | The fidelity checks and the trace/start-state tools (below). |

## Fidelity checks

```
npx tsx src/apps/console/cricket/tools/check.ts        # deliveries (batting view), all traces
npx tsx src/apps/console/cricket/tools/checkField.ts   # fielding views
npx tsx src/apps/console/cricket/tools/checkHand.ts    # hand-overs from the batting to the fielding view
```

Whole matches, against recordings of the original (`traces/match`: the RAM at every ball's start and
end, and the between-ball logic in between):

```
npx tsx src/apps/console/cricket/tools/checkMatch.ts src/apps/console/cricket/traces/match/NAME.json.gz [--free]
```

| Recording | Match | Deliveries |
|---|---|---|
| `spec1` | 10 overs, computer v computer | 118/118 |
| `h1`, `h2` | 10 overs, you bat first / you bowl first (with pad input) | 25/25, 107/107 |
| `t1` | from the toss, the first innings' set-up | 11/11 |
| `td1` | 1 day, two innings each, unlimited overs | 367/367 |
| `td2` | 2 days, two innings each: a new day, a declaration, three rain breaks | 688/688 |
| `kc1` | 10 overs, coloured kits | 120/120 |

All match with `--free` too (the engine plays the whole match alone; only at a rain break does the
checker continue from the recording, see below). `tools/playMatch.ts` plays engine-only matches.

Current result: **189/189** deliveries (57,045 ticks), **336/336** fielding views (137,384 steps),
**178/178** hand-overs, every compared value equal. Covered: every shot direction with both shot buttons
at several timings, footwork, random batting, both batsmen, several deliveries in a row, later overs;
human bowling with all bowler types and both arms against the computer batsman; computer and human
fielding (including switching fielder and throwing to either end). The 54 `traces/field/obj_*` traces
also compare the fielding view's display objects (each object's position, sprite frame, palette, depth,
on-screen and mirrored flags) after every step.

Other tools: `trimField.ts` / `trimHand.ts` (cut new traces down to the RAM they need),
`touchedPractice.ts` (RAM a batting session reads), `genBatBase.ts` / `genBowlBase.ts` (the batting and
bowling start states: play many balls on the recorded full RAM and keep what is read), `checkBase.ts`
(identity test: the same sessions from the full RAM and from the trimmed start state must give the same
view on every tick; all three start states pass, fielding views included).

## Known differences and modelled quirks

- **Register leaks.** Two routines divide by a register the original never sets there: the batting
  view's `sub_048202` (upper half of `d6`, left by the release, the stumps or a dive: `Ram.d6hi`) and
  the fielding view's `sub_037BB6` (all of `d6`, left by the camera or the runners' sprites: `Ram.fd6`).
  Both are modelled, which fixed phase 2's only known difference.
- **A stale pointer.** `sub_0471D8` calls `sub_048202` without setting the register it reads the "hand
  frame" from, so it reads the word at `$FFFF8D96`; that word is `$160` throughout, so the engine uses
  that constant.
- **Stale bytes in the collision masks.** The original builds each sprite's 1-bit mask in RAM
  (`$FF6CE6` / `$FF6FE6`) piece by piece, a row being the width rounded up to 16 pixels. A piece writes
  only its own bytes, so the rest of the row keeps whatever an earlier mask left there, and the ball can
  hit those phantom pixels (a mirrored, left-handed batsman's pad in a recorded Test match). The engine
  builds the masks the same way into its RAM (`collide.ts`, pieces in `maskPieces.ts`).
- **The rain scene.** Its rules are the original's: the clock (the covers stay on for 10 hours 8
  minutes of game time: the rain meter has no randomness), lunch or tea lost to the rain, the wetter
  pitch; the page shows the original's covers (from the emulator) with the clock running. Not rebuilt:
  the scene's animation, which draws about 34,000 random numbers (the raindrops) while the players walk
  off and back: so after rain the random sequence is not the original's, and the recording checker
  continues from the recording at a rain break.
- **Follow-on and your declaration** are rebuilt from the code but not yet seen in a recording. The
  follow-on question goes to the human controlling the side that batted last, as the original's code
  reads.
- **Dead code.** The fielding view's dive (state 5) and jump (state 7) can't be reached in the original:
  nothing calls the routines that set them. They throw if ever reached.
- **Things the checkers skip**: VBlank counters and the pad words (the emulator samples the pad a frame
  later than the game tick reads it); the display objects in the last step before a run-out replay
  (the replay, not rebuilt, takes them over).

## Practice simplifications (not the original's rules)

- The striker stays on strike, the over count is only for the scoreboard, and the players' records are
  the recorded matches' (England's openers when you bat, Australia's when you bowl). The match tab has the full
  rules.
- **The machine's set-up** (choosing its line, the meters) runs four ticks per frame, so balls come
  quicker. Same logic, less waiting. Your own set-up runs in real time.
- Not drawn: the original's on-screen texts and the batting view's fielders map (our scoreboard
  instead), and the run-out replay (the page shows the result instead).
- **One frame of lag.** The original shows each step's sprites and scroll one frame later than it
  computes them; the page draws them in the same frame.
