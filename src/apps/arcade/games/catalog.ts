// The games in the Arcade, in shelf order. Plain data: used by the server
// (validation) and the client (shelf, play page).
//
// To add a game: create src/apps/arcade/games/<id>/ with a deterministic
// engine and a replay function, add its manifest here, its replay to
// games/server.ts and its component and cover to games/client.tsx.

export type GameManifest = {
  /** Stable id stored in the database. Never change it once released. */
  id: string;
  name: string;
  /** One short line for cards. */
  tagline: string;
  /** One or two sentences for the play page. */
  description: string;
  status: "live" | "coming-soon";
  /** Accent color (hex). */
  color: string;
  /** Keyboard controls shown under the game: [keys, action]. */
  controls: [string, string][];
  /** Where the game comes from and under which license. */
  credits: string;
};

export const STARFALL: GameManifest = {
  id: "starfall",
  name: "Starfall",
  tagline: "Stack falling star-crystals, clear rows, go supernova.",
  description:
    "Crystals fall into a 10 × 20 field. Fit them together to fill rows, which burn away for points. Clear four rows at once for a supernova. The pace picks up every 10 rows.",
  status: "live",
  color: "#ff5fa2",
  controls: [
    ["← →", "Move"],
    ["↓", "Soft drop"],
    ["Space", "Hard drop"],
    ["↑ / X", "Rotate clockwise"],
    ["Z", "Rotate counter-clockwise"],
    ["C / Shift", "Hold"],
    ["P / Esc", "Pause"],
  ],
  credits: "Original game written for It's Your World. Code and artwork are part of this repository.",
};

export const GAMES: readonly GameManifest[] = [STARFALL];

export function findGame(id: string): GameManifest | undefined {
  return GAMES.find((g) => g.id === id);
}
