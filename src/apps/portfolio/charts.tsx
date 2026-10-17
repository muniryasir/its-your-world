// Small, dependency-free SVG charts for the Portfolio app.
import { useId, useMemo, useRef, useState, type PointerEvent } from "react";
import { assetClassName, CLASS_COLORS } from "./assetClasses";
import type { AllocationSlice } from "./operations";
import { money, pct, price as fmtPrice, shortDate } from "./format";

// ---------------------------------------------------------------------------
// Sparkline: last 30 days, colored by direction. Decorative (the row already
// shows the 1-day change in text), so it's hidden from screen readers.
// ---------------------------------------------------------------------------
export function Sparkline({ values, width = 96, height = 28 }: { values: number[]; width?: number; height?: number }) {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values
    .map((v, i) => `${((i / (values.length - 1)) * width).toFixed(1)},${(height - 2 - ((v - min) / span) * (height - 4)).toFixed(1)}`)
    .join(" ");
  const up = values[values.length - 1] >= values[0];
  return (
    <svg className={`spark ${up ? "spark--up" : "spark--down"}`} width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <polyline points={pts} fill="none" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Price chart: one series with a crosshair + tooltip on hover/touch.
// ---------------------------------------------------------------------------
type Point = { date: string; close: number };

const W = 720;
const H = 260;
const PAD = { top: 16, right: 64, bottom: 28, left: 12 };

export function PriceChart({ points, decimals, label }: { points: Point[]; decimals: number; label: string }) {
  const gradientId = useId();
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);

  const geo = useMemo(() => {
    const closes = points.map((p) => p.close);
    let min = Math.min(...closes);
    let max = Math.max(...closes);
    const pad = (max - min) * 0.08 || max * 0.01;
    min -= pad;
    max += pad;
    const x = (i: number) => PAD.left + (i / Math.max(points.length - 1, 1)) * (W - PAD.left - PAD.right);
    const y = (v: number) => PAD.top + (1 - (v - min) / (max - min)) * (H - PAD.top - PAD.bottom);
    const line = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.close).toFixed(1)}`).join("");
    const area = `${line}L${x(points.length - 1).toFixed(1)},${H - PAD.bottom}L${x(0).toFixed(1)},${H - PAD.bottom}Z`;
    const ticks = [0, 1, 2, 3].map((k) => min + ((max - min) * (k + 0.5)) / 4);
    const dateTicks = [0, Math.floor((points.length - 1) / 2), points.length - 1];
    return { x, y, line, area, ticks, dateTicks };
  }, [points]);

  if (points.length < 2) return null;

  function onMove(e: PointerEvent<SVGSVGElement>) {
    const box = svgRef.current?.getBoundingClientRect();
    if (!box) return;
    const sx = ((e.clientX - box.left) / box.width) * W;
    const t = (sx - PAD.left) / (W - PAD.left - PAD.right);
    setHover(Math.max(0, Math.min(points.length - 1, Math.round(t * (points.length - 1)))));
  }

  const first = points[0].close;
  const last = points[points.length - 1].close;
  const h = hover === null ? null : points[hover];
  const hx = hover === null ? 0 : geo.x(hover);
  const tipLeft = hover === null ? 0 : (hx / W) * 100;

  return (
    <figure className="price-chart">
      <div className="price-chart-plot">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label={`${label}: ${fmtPrice(first, decimals)} to ${fmtPrice(last, decimals)} from ${shortDate(points[0].date)} to ${shortDate(points[points.length - 1].date)}`}
          onPointerMove={onMove}
          onPointerDown={onMove}
          onPointerLeave={() => setHover(null)}
        >
          <defs>
            <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="var(--chart-line)" stopOpacity="0.16" />
              <stop offset="100%" stopColor="var(--chart-line)" stopOpacity="0" />
            </linearGradient>
          </defs>
          {geo.ticks.map((v) => (
            <g key={v} className="chart-grid">
              <line x1={PAD.left} x2={W - PAD.right} y1={geo.y(v)} y2={geo.y(v)} />
              <text x={W - PAD.right + 8} y={geo.y(v) + 4}>{fmtPrice(v, decimals)}</text>
            </g>
          ))}
          {geo.dateTicks.map((i, k) => (
            <text
              key={i}
              className="chart-axis"
              x={geo.x(i)}
              y={H - 8}
              textAnchor={k === 0 ? "start" : k === 2 ? "end" : "middle"}
            >
              {shortDate(points[i].date)}
            </text>
          ))}
          <path d={geo.area} fill={`url(#${gradientId})`} />
          <path d={geo.line} className="chart-line" fill="none" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
          {h && (
            <g className="chart-cross">
              <line x1={hx} x2={hx} y1={PAD.top} y2={H - PAD.bottom} />
              <circle cx={hx} cy={geo.y(h.close)} r="5" />
            </g>
          )}
        </svg>
        {h && (
          <div className="chart-tip" style={{ left: `${tipLeft}%` }} role="status">
            <strong>{fmtPrice(h.close, decimals)}</strong>
            <span>{shortDate(h.date)}</span>
          </div>
        )}
      </div>
    </figure>
  );
}

// ---------------------------------------------------------------------------
// Allocation bar: share of value by asset class, plus cash. Always labeled.
// ---------------------------------------------------------------------------
const sliceName = (key: AllocationSlice["key"]) => (key === "cash" ? "Cash" : assetClassName(key));

export function AllocationBar({ slices, compact = false }: { slices: AllocationSlice[]; compact?: boolean }) {
  const total = slices.reduce((s, x) => s + x.value, 0);
  if (total <= 0) return null;
  return (
    <div className={`allocation ${compact ? "allocation--compact" : ""}`}>
      <div className="alloc-bar" role="img" aria-label={slices.map((s) => `${sliceName(s.key)} ${pct((s.value / total) * 100)}`).join(", ")}>
        {slices.map((s) => (
          <span
            key={s.key}
            style={{ width: `${(s.value / total) * 100}%`, background: CLASS_COLORS[s.key] }}
            title={`${sliceName(s.key)}: ${money(s.value)}`}
          />
        ))}
      </div>
      {!compact && (
        <ul className="alloc-legend">
          {slices.map((s) => (
            <li key={s.key}>
              <span className="swatch" style={{ background: CLASS_COLORS[s.key] }} />
              {sliceName(s.key)}
              <span className="muted num">{pct((s.value / total) * 100)}</span>
              <span className="muted num small">{money(s.value)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
