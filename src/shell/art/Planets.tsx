// Planet illustrations. Each one is drawn around (0, 0) with radius `r`,
// so it can be placed inside any parent <svg> with a transform.
// `id` keeps gradient ids unique when the same planet appears twice.

type PlanetProps = { r: number; id: string };

export function PortfolioPlanet({ r, id }: PlanetProps) {
  const s = r / 100;
  return (
    <g>
      <defs>
        <radialGradient id={`${id}-body`} cx="35%" cy="30%" r="75%">
          <stop offset="0%" stopColor="#8ff5d2" />
          <stop offset="55%" stopColor="#21b98a" />
          <stop offset="100%" stopColor="#0b5c4f" />
        </radialGradient>
      </defs>
      <circle r={r * 1.18} fill="#2ed3a0" opacity="0.14" />
      <circle r={r} fill={`url(#${id}-body)`} />
      {/* bands */}
      <path d={`M${-92 * s} ${-28 * s} Q0 ${-48 * s} ${92 * s} ${-28 * s}`} stroke="#0b5c4f" strokeOpacity=".25" strokeWidth={10 * s} fill="none" />
      <path d={`M${-98 * s} ${18 * s} Q0 ${-2 * s} ${98 * s} ${18 * s}`} stroke="#0b5c4f" strokeOpacity=".2" strokeWidth={8 * s} fill="none" />
      {/* rising line chart */}
      <polyline
        points={[[-62, 38], [-34, 18], [-12, 28], [14, -6], [36, 4], [64, -38]].map(([x, y]) => `${x * s},${y * s}`).join(" ")}
        fill="none" stroke="#f3fff9" strokeWidth={7 * s} strokeLinecap="round" strokeLinejoin="round"
      />
      <circle cx={64 * s} cy={-38 * s} r={9 * s} fill="#f3fff9" />
      {/* coin moon */}
      <g transform={`translate(${118 * s} ${-74 * s})`}>
        <circle r={20 * s} fill="#ffd23f" />
        <circle r={13 * s} fill="none" stroke="#c99700" strokeWidth={3 * s} />
      </g>
    </g>
  );
}

export function ArcadePlanet({ r, id }: PlanetProps) {
  const s = r / 100;
  // pixel blocks clipped to the planet
  const pixels: [number, number, string][] = [
    [-60, -60, "#ffd23f"], [-40, -60, "#ff8cc2"], [20, -80, "#ffd23f"], [40, -40, "#7a2bd8"],
    [-80, -20, "#7a2bd8"], [-20, -20, "#ffd23f"], [60, 0, "#ff8cc2"], [-60, 20, "#ff8cc2"],
    [0, 20, "#7a2bd8"], [20, 40, "#ffd23f"], [-40, 60, "#7a2bd8"], [40, 60, "#ff8cc2"],
    [80, -40, "#7a2bd8"], [-20, -80, "#7a2bd8"], [0, 60, "#ffd23f"],
  ];
  return (
    <g>
      <defs>
        <radialGradient id={`${id}-body`} cx="35%" cy="30%" r="75%">
          <stop offset="0%" stopColor="#ff9ccb" />
          <stop offset="55%" stopColor="#f0459a" />
          <stop offset="100%" stopColor="#7c1456" />
        </radialGradient>
        <clipPath id={`${id}-clip`}>
          <circle r={r} />
        </clipPath>
      </defs>
      <circle r={r * 1.18} fill="#ff5fa2" opacity="0.14" />
      {/* ring, back half */}
      <ellipse rx={r * 1.55} ry={r * 0.36} fill="none" stroke="#c99700" strokeWidth={9 * s} transform="rotate(-18)" />
      <circle r={r} fill={`url(#${id}-body)`} />
      <g clipPath={`url(#${id}-clip)`} opacity=".85">
        {pixels.map(([x, y, c], i) => (
          <rect key={i} x={x * s} y={y * s} width={20 * s} height={20 * s} fill={c} />
        ))}
      </g>
      {/* ring, front half */}
      <path
        d={`M${-r * 1.55} 0 A${r * 1.55} ${r * 0.36} 0 0 0 ${r * 1.55} 0`}
        transform="rotate(-18)" fill="none" stroke="#ffd23f" strokeWidth={9 * s}
      />
    </g>
  );
}

export function MysteryPlanet({ r, id: _id }: PlanetProps) {
  const s = r / 100;
  return (
    <g>
      <circle r={r} fill="#b8b3e6" fillOpacity=".08" stroke="#c9c4f2" strokeWidth={5 * s} strokeDasharray={`${14 * s} ${12 * s}`} />
      <circle cx={-34 * s} cy={-30 * s} r={16 * s} fill="#c9c4f2" opacity=".18" />
      <circle cx={30 * s} cy={26 * s} r={24 * s} fill="#c9c4f2" opacity=".12" />
      <circle cx={-6 * s} cy={48 * s} r={9 * s} fill="#c9c4f2" opacity=".18" />
    </g>
  );
}

export function HomePlanet({ r, id }: PlanetProps) {
  return (
    <g>
      <defs>
        <radialGradient id={`${id}-glow`}>
          <stop offset="40%" stopColor="#8a6bff" stopOpacity=".55" />
          <stop offset="100%" stopColor="#8a6bff" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${id}-body`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#c7b8ff" />
          <stop offset="50%" stopColor="#7b5cf0" />
          <stop offset="100%" stopColor="#2a1f73" />
        </linearGradient>
        <clipPath id={`${id}-clip`}>
          <circle r={r} />
        </clipPath>
      </defs>
      <circle r={r * 2} fill={`url(#${id}-glow)`} />
      <circle r={r} fill={`url(#${id}-body)`} />
      {/* night side, echoing the ◐ logo */}
      <g clipPath={`url(#${id}-clip)`}>
        <circle cx={r * 0.55} cy={r * 0.45} r={r * 1.05} fill="#1b1550" opacity=".55" />
      </g>
    </g>
  );
}
