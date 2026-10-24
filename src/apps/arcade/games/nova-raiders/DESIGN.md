# Nova Raiders – game design

Arcade game #2 in It's Your World (`muniryasir/its-your-world`, branch `arcade/nova-raiders`, folder `src/apps/arcade/games/nova-raiders/`).

## Agreed with Yasir (2026-10-24)
- Retro space shooter in the style of old Atari-era home consoles.
- Name: **Nova Raiders** (original name; no commercial titles, sprites or sounds).
- 10 levels, no bosses. Each level introduces one new enemy type (10 types).
- Difficulty chosen before launch: Easy / Normal / Hard. It scales the whole run down or up; levels still get harder on every setting.
- Ship movement: **free** (anywhere in the lower part of the screen).
- Lives: 3, extra ship every 10,000 points (Normal), victory screen after level 10.
- Leaderboard: **none** for this game. Runs are still server-verified (score, "Your best"). Hiding the shared leaderboard needs a change in shared Arcade code → request filed in `docs/handoff/requests.md`.

## Screen and look
- 160 × 192 game pixels plus a 12-pixel score bar, scaled up with crisp square pixels.
- Black starfield, small bright palette, blocky two-frame sprites, CRT scanlines and glow, dark bezel.
- Score bar inside the screen: 6-digit score, `L<level>-W<wave>`, ship icons.
- Overlays (title, difficulty, countdown, pause, result) use the Arcade's pixel font, sun yellow and pink.

## Controls
- Keyboard: arrows / WASD move, Space / J / X fire (hold), 1/2/3 difficulty, P / Esc pause, Enter start.
- Touch: steering pad (8 directions) and a Fire button.

## Levels and waves
- Each level: intro banner ("Level n · New: <type>"), then 3 waves.
- Wave size: (5 + level + 2 × wave) × difficulty %, between 4 and 26 enemies.
- Share of the level's new type per wave: 40% / 50% / 65%; the rest are earlier types.
- Level clear bonus: 1,000 × level. Clearing level 10: + 5,000 per ship left.

## Difficulty
| | Easy | Normal | Hard |
|---|---|---|---|
| Swarm size, speed, fire rate | 70% | 100% | 130% |
| Extra ship every | 7,000 | 10,000 | 13,000 |

Pace also rises 9% per level (Normal level 10 = 181%).

## Enemy types
| Level | Name | Behaviour | Points |
|---|---|---|---|
| 1 | Drone | Holds formation, occasional straight shots | 100 |
| 2 | Darter | Dives at the player's column, loops back | 150 |
| 3 | Gunner | Formation, aimed shots | 200 |
| 4 | Weaver | Sweeps sideways along a wave, drops a row each pass | 200 |
| 5 | Bulwark | Formation, takes 3 hits | 300 |
| 6 | Splitter | Breaks into 2 shards that dive diagonally (50 each) | 250 |
| 7 | Miner | Patrols the top, lays mines (shootable, 25) | 250 |
| 8 | Seeker | Dives and homes in on the player | 300 |
| 9 | Spreader | Formation, 3-way shots | 350 |
| 10 | Phantom | Turns invisible, teleports, aimed shots | 400 |

## Score verification
Same as Starfall: deterministic engine (60 ticks/s, integer math in 1/16 px, seeded RNG, written-out sine table). Input log = difficulty digit + inputs with tick deltas + "end". Server replays it with its own seed. Tested in the cloud with a bot: 18 full runs across difficulties replay identically; tampered logs are rejected or replay to a different, honest score.

## Open items
- Arcade chat: hide leaderboard per game; per-game stat column instead of "Rows".
- Sound effects (not in v1).
