import { useEffect, useState, type KeyboardEvent } from "react";
import { HomePlanet } from "../shell/art/Planets";
import type { PlanetArt } from "./clientRegistry";

// The hub's picture of your world: your account in the middle and the
// apps you've added orbiting it, plus a "+" slot for the next app.

const CX = 300, CY = 220, RX = 240, RY = 100;
const ORBIT = `M ${CX - RX} ${CY} A ${RX} ${RY} 0 1 0 ${CX + RX} ${CY} A ${RX} ${RY} 0 1 0 ${CX - RX} ${CY}`;
const PERIOD = 60;

function pointAt(f: number) {
  const a = Math.PI - f * 2 * Math.PI;
  return { x: CX + RX * Math.cos(a), y: CY + RY * Math.sin(a) };
}

function useMotionOk() {
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

type Body = { key: string; r: number; node: React.ReactNode };

export function WorldOrbit({
  planets,
  onAddClick,
}: {
  planets: { id: string; Planet: PlanetArt }[];
  onAddClick: () => void;
}) {
  const animate = useMotionOk();

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onAddClick();
    }
  };

  const bodies: Body[] = [
    ...planets.map((p) => ({ key: p.id, r: 40, node: <p.Planet r={40} id={`orbit-${p.id}`} /> })),
    {
      key: "add-slot",
      r: 30,
      node: (
        <g className="orbit-slot" role="button" tabIndex={0} aria-label="Add an app" onClick={onAddClick} onKeyDown={onKey}>
          <circle r={30} fill="#f3f0ff" fillOpacity=".06" stroke="#f3f0ff" strokeOpacity=".7" strokeWidth="2" strokeDasharray="6 6" />
          <path d="M-10 0H10M0 -10V10" stroke="#f3f0ff" strokeWidth="3" strokeLinecap="round" />
        </g>
      ),
    },
  ];

  return (
    <svg className="world-orbit" viewBox="0 0 600 440" role="group" aria-label="Your world and the apps in it">
      <path d={`M ${CX - RX} ${CY} A ${RX} ${RY} 0 0 1 ${CX + RX} ${CY}`} fill="none" stroke="#c9c4f2" strokeOpacity=".28" strokeWidth="1.5" strokeDasharray="2 7" />
      <g transform={`translate(${CX} ${CY})`}>
        <HomePlanet r={64} id="world-home" />
      </g>
      <path d={`M ${CX - RX} ${CY} A ${RX} ${RY} 0 0 0 ${CX + RX} ${CY}`} fill="none" stroke="#c9c4f2" strokeOpacity=".45" strokeWidth="1.5" strokeDasharray="2 7" />
      {bodies.map((b, i) => {
        // Spread bodies evenly, starting at the front of the orbit.
        const at = (0.1 + i / bodies.length) % 1;
        if (!animate) {
          const { x, y } = pointAt(at);
          return <g key={b.key} transform={`translate(${x.toFixed(1)} ${y.toFixed(1)})`}>{b.node}</g>;
        }
        return (
          <g key={b.key}>
            {b.node}
            <animateMotion dur={`${PERIOD}s`} repeatCount="indefinite" path={ORBIT} begin={`-${(at * PERIOD).toFixed(2)}s`} />
          </g>
        );
      })}
    </svg>
  );
}
