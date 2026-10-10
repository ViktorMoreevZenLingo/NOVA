"use client";

import { useState } from "react";
import type { TrendPoint } from "@/lib/coach-api";

// Small, dependency-free SVG charts for the insights screens. One series per chart,
// one axis, recessive grid, values in text ink. Suppressed (k < 5) points are gaps.

export function StatTile({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "good" | "warning" | "critical" }) {
  return (
    <div className="coach-stat">
      <span className="coach-stat-label">{label}</span>
      <strong>{value}</strong>
      {sub && (
        <span className={`coach-stat-sub${tone ? ` tone-${tone}` : ""}`}>
          {tone && <span className="coach-dot" aria-hidden="true" />}
          {sub}
        </span>
      )}
    </div>
  );
}

const fmtWeek = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

/** Weekly engagement (0-100). Hover a week for its value and answer count. */
export function TrendChart({ points, label = "Engagement" }: { points: TrendPoint[]; label?: string }) {
  const [hover, setHover] = useState<number | null>(null);
  if (!points.length) return <p className="coach-empty">No answers in this period yet.</p>;
  const W = 640, H = 200, L = 34, R = 12, T = 12, B = 26;
  const values = points.map((p) => p.engagement).filter((v): v is number => v !== null);
  const lo = Math.max(0, Math.floor((Math.min(...values, 50) - 10) / 10) * 10);
  const hi = Math.min(100, Math.ceil((Math.max(...values, 50) + 10) / 10) * 10);
  const x = (i: number) => L + (points.length === 1 ? (W - L - R) / 2 : (i * (W - L - R)) / (points.length - 1));
  const y = (v: number) => T + ((hi - v) * (H - T - B)) / (hi - lo || 1);
  const segments: string[] = [];
  let current = "";
  points.forEach((p, i) => {
    if (p.engagement === null) {
      if (current) segments.push(current);
      current = "";
      return;
    }
    current += `${current ? "L" : "M"}${x(i).toFixed(1)},${y(p.engagement).toFixed(1)}`;
  });
  if (current) segments.push(current);
  const ticks = [lo, (lo + hi) / 2, hi];
  const h = hover !== null ? points[hover] : null;

  return (
    <figure className="coach-chart" onMouseLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${label} by week`}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} className="coach-grid" />
            <text x={L - 8} y={y(t) + 4} textAnchor="end" className="coach-axis">{Math.round(t)}</text>
          </g>
        ))}
        {points.map((p, i) =>
          i % Math.ceil(points.length / 6) === 0 || i === points.length - 1
            ? <text key={p.week} x={x(i)} y={H - 6} textAnchor="middle" className="coach-axis">{fmtWeek(p.week)}</text>
            : null
        )}
        {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={T} y2={H - B} className="coach-crosshair" />}
        {segments.map((d) => <path key={d} d={d} className="coach-line" />)}
        {points.map((p, i) =>
          p.engagement !== null && (
            <circle key={p.week} cx={x(i)} cy={y(p.engagement)} r={hover === i ? 5 : 4} className="coach-point" />
          )
        )}
        {points.map((p, i) => (
          <rect
            key={`hit-${p.week}`}
            x={x(i) - (W - L - R) / Math.max(1, points.length - 1) / 2}
            y={T}
            width={(W - L - R) / Math.max(1, points.length - 1)}
            height={H - T - B}
            fill="transparent"
            onMouseEnter={() => setHover(i)}
          />
        ))}
      </svg>
      {h && (
        <div className="coach-tooltip" style={{ left: `${(x(hover!) / W) * 100}%` }} role="status">
          <strong>Week of {fmtWeek(h.week)}</strong>
          <span>{h.engagement === null ? "Hidden: fewer than 5 people answered" : `${label} ${h.engagement.toFixed(0)}`}</span>
          <span>{h.responses} answers</span>
        </div>
      )}
    </figure>
  );
}

/** Horizontal share bars (0-1), sorted by the caller. */
export function ShareBars({ items, empty = "No themes yet." }: { items: { label: string; share: number }[]; empty?: string }) {
  if (!items.length) return <p className="coach-empty">{empty}</p>;
  return (
    <ul className="coach-bars">
      {items.map((it) => (
        <li key={it.label} title={`${it.label}: ${Math.round(it.share * 100)}% of answers`}>
          <span className="coach-bar-label">{it.label}</span>
          <span className="coach-bar-track"><span className="coach-bar-fill" style={{ width: `${Math.max(2, it.share * 100)}%` }} /></span>
          <span className="coach-bar-value">{Math.round(it.share * 100)}%</span>
        </li>
      ))}
    </ul>
  );
}

// Sequential blue ramp (light → dark) for heatmap cells; text flips to white on dark steps.
const RAMP = ["#f4f8fd", "#cde2fb", "#9ec5f4", "#6da7ec", "#3987e5", "#256abf", "#184f95"];
export function heatColor(share: number) {
  const i = Math.min(RAMP.length - 1, Math.round(share * (RAMP.length - 1) * 1.4));
  return { background: RAMP[i], color: i >= 4 ? "#fff" : "#191919" };
}

export function Delta({ now, before, unit = "" }: { now: number | null; before: number | null; unit?: string }) {
  if (now === null || before === null) return null;
  const d = now - before;
  if (Math.abs(d) < 0.5) return <span className="coach-delta">no change</span>;
  return (
    <span className={`coach-delta ${d > 0 ? "up" : "down"}`}>
      {d > 0 ? "▲" : "▼"} {Math.abs(d).toFixed(0)}{unit}
    </span>
  );
}

export function riskTone(share: number | null): "good" | "warning" | "critical" | undefined {
  if (share === null) return undefined;
  return share >= 0.3 ? "critical" : share >= 0.15 ? "warning" : "good";
}
export const riskLabel = (share: number | null) =>
  share === null ? "—" : share >= 0.3 ? "High" : share >= 0.15 ? "Elevated" : "Low";
