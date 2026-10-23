// Client side of each game: the play component and the cover art.
import type { ComponentType } from "react";
import { StarfallGame } from "./starfall/StarfallGame";
import { StarfallCover } from "./StarfallCover";

export type GameClient = {
  /** The playable game. `canPlay` is false until the game is on the user's shelf. */
  Play: ComponentType<{ gameId: string; canPlay: boolean }>;
  Cover: ComponentType<{ id?: string }>;
};

export const GAME_CLIENTS: Record<string, GameClient> = {
  starfall: { Play: StarfallGame, Cover: StarfallCover },
};
