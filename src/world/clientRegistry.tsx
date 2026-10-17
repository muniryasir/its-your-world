// Client-side parts of each app: its planet artwork and its hub tile.
// Register new apps here after adding their manifest to catalog.ts.
import type { ComponentType } from "react";
import { ArcadePlanet, MysteryPlanet, PortfolioPlanet } from "../shell/art/Planets";
import { PortfolioTile } from "../apps/portfolio/PortfolioTile";
import { ArcadeTile } from "../apps/arcade/ArcadeTile";

export type PlanetArt = ComponentType<{ r: number; id: string }>;

export type AppClientParts = {
  Planet: PlanetArt;
  /** Summary shown on the hub tile. Optional. */
  Tile?: ComponentType;
};

export const CLIENT_PARTS: Record<string, AppClientParts> = {
  portfolio: { Planet: PortfolioPlanet, Tile: PortfolioTile },
  arcade: { Planet: ArcadePlanet, Tile: ArcadeTile },
};

export const FallbackPlanet: PlanetArt = MysteryPlanet;
