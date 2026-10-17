import { CRYSTAL_COLORS } from "./starfall/render";

// Cover art for Starfall: a few crystals stacked at the bottom of a night
// field and one more falling in. Drawn in SVG, original artwork.
const STACK: [x: number, y: number, kind: number][] = [
  [0, 4, 6], [0, 3, 6], [1, 4, 6], [2, 4, 6],
  [3, 4, 2], [4, 4, 2], [3, 3, 2], [4, 3, 2],
  [5, 4, 4], [6, 4, 4], [6, 3, 4], [7, 3, 4],
  [8, 4, 1], [8, 3, 1], [8, 2, 1], [8, 1, 1],
  [9, 4, 7], [9, 3, 7], [7, 4, 5], [1, 3, 5], [2, 3, 5], [2, 2, 5],
];
const FALLING: [number, number][] = [[4, 0], [3, 1], [4, 1], [5, 1]];

export function StarfallCover({ id = "sfc" }: { id?: string }) {
  const s = 26;
  const ox = 30;
  const oy = 22;
  const cell = (x: number, y: number, kind: number, key: string, extra = "") => (
    <g key={key} transform={`translate(${ox + x * s} ${oy + y * s})`} className={extra}>
      <rect x="1.5" y="1.5" width={s - 3} height={s - 3} rx="6" fill={`url(#${id}-g${kind})`} />
      <rect x="6" y="6" width={s - 12} height={(s - 12) / 2} rx="3" fill="#fff" opacity="0.28" />
      <path d="M9 5.5 Q9 9 12.5 9 Q9 9 9 12.5 Q9 9 5.5 9 Q9 9 9 5.5Z" fill="#fff" opacity="0.9" />
    </g>
  );
  return (
    <svg viewBox="0 0 320 160" className="game-cover" role="img" aria-label="Starfall: glowing crystals stacking up in a night sky">
      <defs>
        <linearGradient id={`${id}-bg`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#0b0d2b" />
          <stop offset="1" stopColor="#24175a" />
        </linearGradient>
        {[1, 2, 3, 4, 5, 6, 7].map((k) => (
          <linearGradient key={k} id={`${id}-g${k}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#fff" stopOpacity="0.55" />
            <stop offset="0.45" stopColor={CRYSTAL_COLORS[k]} />
            <stop offset="1" stopColor={CRYSTAL_COLORS[k]} stopOpacity="0.75" />
          </linearGradient>
        ))}
        <filter id={`${id}-glow`} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="5" />
        </filter>
      </defs>
      <rect width="320" height="160" fill={`url(#${id}-bg)`} />
      {[[24, 18], [70, 40], [130, 14], [210, 30], [292, 16], [268, 58], [180, 52], [300, 96], [16, 70]].map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r={i % 3 === 0 ? 1.6 : 1} fill="#f3f0ff" opacity={0.4 + (i % 4) * 0.12} />
      ))}
      <g opacity="0.55" filter={`url(#${id}-glow)`}>
        {FALLING.map(([x, y]) => (
          <rect key={`h${x}${y}`} x={ox + x * s} y={oy + y * s - 8} width={s} height={s} fill={CRYSTAL_COLORS[3]} />
        ))}
      </g>
      {FALLING.map(([x, y]) => cell(x, y - 0.3, 3, `f${x}${y}`))}
      {STACK.map(([x, y, k]) => cell(x, y, k, `s${x}${y}`))}
    </svg>
  );
}
