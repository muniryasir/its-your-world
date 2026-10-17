// A static, deterministic star field (same output on server and client,
// so it doesn't break hydration).

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Star = { x: number; y: number; r: number; o: number };

function makeStars(count: number, seed: number): Star[] {
  const rand = mulberry32(seed);
  return Array.from({ length: count }, () => {
    const big = rand() > 0.93;
    return {
      x: +(rand() * 1000).toFixed(1),
      y: +(rand() * 1000).toFixed(1),
      r: +(big ? 1.4 + rand() * 1.2 : 0.4 + rand() * 0.8).toFixed(2),
      o: +(0.35 + rand() * 0.65).toFixed(2),
    };
  });
}

export function Starfield({ count = 160, seed = 7, className }: { count?: number; seed?: number; className?: string }) {
  const stars = makeStars(count, seed);
  return (
    <svg className={className} viewBox="0 0 1000 1000" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      {stars.map((s, i) => (
        <circle key={i} cx={s.x} cy={s.y} r={s.r} fill="#f3f0ff" opacity={s.o} />
      ))}
    </svg>
  );
}
