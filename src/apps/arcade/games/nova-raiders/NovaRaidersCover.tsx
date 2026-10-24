import type { ReactElement } from "react";
import type { EnemyType } from "./engine";
import { ENEMY_COLORS, ENEMY_SPRITES, PLAYER, PLAYER_COLOR, type Sprite } from "./sprites";

// Cover art for Nova Raiders: a row of pixel raiders above the player's ship,
// one of them bursting apart, on a black starfield with scanlines. Built from
// the game's own (original) sprites.
const P = 4; // one game pixel = 4 cover units

function Pixels({ art, color, x, y, scale = P }: { art: Sprite; color: string; x: number; y: number; scale?: number }) {
  const rects: ReactElement[] = [];
  art.forEach((row, ry) => {
    for (let rx = 0; rx < row.length; rx++) {
      if (row[rx] === "#") rects.push(<rect key={`${rx}-${ry}`} x={x + rx * scale} y={y + ry * scale} width={scale} height={scale} />);
    }
  });
  return <g fill={color}>{rects}</g>;
}

const ROW: [EnemyType, number, number][] = [
  [3, 40, 22], [1, 92, 22], [10, 144, 22], [1, 196, 22], [3, 248, 22],
  [2, 66, 56], [8, 118, 56], [9, 170, 56], [2, 222, 56],
];

export function NovaRaidersCover({ id = "nrc" }: { id?: string }) {
  return (
    <svg viewBox="0 0 320 160" className="game-cover" role="img" aria-label="Nova Raiders: pixel raiders in formation above a small yellow starship">
      <defs>
        <pattern id={`${id}-scan`} width="4" height="4" patternUnits="userSpaceOnUse">
          <rect width="4" height="1.3" y="2.7" fill="#000" opacity="0.35" />
        </pattern>
      </defs>
      <rect width="320" height="160" fill="#05040f" />
      {[[14, 12], [60, 44], [118, 8], [182, 46], [300, 20], [276, 70], [30, 96], [300, 118], [210, 104], [96, 120], [150, 90]].map(([x, y], i) => (
        <rect key={i} x={x} y={y} width={i % 3 === 0 ? 3 : 2} height={i % 3 === 0 ? 3 : 2} fill={i % 4 === 0 ? "#f3f0ff" : "#6a64c0"} />
      ))}
      {ROW.map(([type, x, y], i) => (
        <Pixels key={i} art={ENEMY_SPRITES[type][i % 2]} color={ENEMY_COLORS[type]} x={x} y={y} />
      ))}
      {/* A raider bursting apart */}
      <g fill={ENEMY_COLORS[6]}>
        {[[272, 58], [282, 52], [294, 60], [276, 72], [290, 74], [284, 64], [300, 50], [266, 68]].map(([x, y], i) => (
          <rect key={i} x={x} y={y} width={i % 2 ? 4 : 6} height={i % 2 ? 4 : 6} />
        ))}
      </g>
      {/* Laser shot and the player's ship */}
      <rect x="156" y="84" width="4" height="16" fill="#fff3a8" />
      <rect x="156" y="104" width="4" height="10" fill="#fff3a8" opacity="0.5" />
      <Pixels art={PLAYER} color={PLAYER_COLOR} x={140} y={118} />
      <rect x="0" y="152" width="320" height="8" fill="#3a1e6e" />
      <rect width="320" height="160" fill={`url(#${id}-scan)`} />
    </svg>
  );
}
