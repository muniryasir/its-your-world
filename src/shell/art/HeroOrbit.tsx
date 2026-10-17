import { useEffect, useState } from "react";
import { ArcadePlanet, HomePlanet, MysteryPlanet, PortfolioPlanet } from "./Planets";

// The hero illustration: your account is the planet in the middle,
// each app is a planet on the orbit around it.
//
// The orbit animation starts after hydration (the server renders the
// planets at fixed positions) and is skipped for prefers-reduced-motion.

const CX = 300;
const CY = 260;
const RX = 250;
const RY = 108;
const ORBIT = `M ${CX - RX} ${CY} A ${RX} ${RY} 0 1 0 ${CX + RX} ${CY} A ${RX} ${RY} 0 1 0 ${CX - RX} ${CY}`;
const PERIOD = 48; // seconds per orbit

// Starting points along the orbit, as a fraction of one lap.
const PLANETS = [
  { key: "portfolio", at: 0.08, r: 34, label: "Portfolio" },
  { key: "arcade", at: 0.42, r: 30, label: "Arcade" },
  { key: "more", at: 0.74, r: 22, label: "More coming" },
] as const;

function pointAt(fraction: number) {
  // The path starts at the left and runs counter-clockwise in screen terms
  // (bottom first) because of the sweep flag 0.
  const angle = Math.PI - fraction * 2 * Math.PI;
  return { x: CX + RX * Math.cos(angle), y: CY + RY * Math.sin(angle) };
}

function usePrefersMotion() {
  const [ok, setOk] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setOk(!mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return ok;
}

export function HeroOrbit() {
  const animate = usePrefersMotion();

  return (
    <svg className="hero-orbit" viewBox="0 0 600 520" role="img" aria-label="Your account in the middle, with Portfolio, Arcade and future apps orbiting around it">
      {/* back half of the orbit */}
      <path d={`M ${CX - RX} ${CY} A ${RX} ${RY} 0 0 1 ${CX + RX} ${CY}`} fill="none" stroke="#c9c4f2" strokeOpacity=".28" strokeWidth="1.5" strokeDasharray="2 7" />
      <g transform={`translate(${CX} ${CY})`}>
        <HomePlanet r={70} id="hero-home" />
      </g>
      {/* front half of the orbit */}
      <path d={`M ${CX - RX} ${CY} A ${RX} ${RY} 0 0 0 ${CX + RX} ${CY}`} fill="none" stroke="#c9c4f2" strokeOpacity=".45" strokeWidth="1.5" strokeDasharray="2 7" />

      {PLANETS.map((p) => {
        const art =
          p.key === "portfolio" ? <PortfolioPlanet r={p.r} id="hero-pf" /> :
          p.key === "arcade" ? <ArcadePlanet r={p.r} id="hero-ar" /> :
          <MysteryPlanet r={p.r} id="hero-mo" />;

        if (!animate) {
          const { x, y } = pointAt(p.at);
          return <g key={p.key} transform={`translate(${x.toFixed(1)} ${y.toFixed(1)})`}>{art}</g>;
        }
        return (
          <g key={p.key}>
            {art}
            <animateMotion dur={`${PERIOD}s`} repeatCount="indefinite" path={ORBIT} begin={`-${(p.at * PERIOD).toFixed(2)}s`} />
          </g>
        );
      })}
    </svg>
  );
}
