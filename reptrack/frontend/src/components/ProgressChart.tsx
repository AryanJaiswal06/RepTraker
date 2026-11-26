import { useId, useState } from "react";
import { fmtDate, toDisplay, useSettings } from "../settings";
import { ProgressPoint } from "../types";

type Metric = "best_weight" | "est_1rm" | "volume";

const METRICS: { id: Metric; label: string }[] = [
  { id: "best_weight", label: "Best Weight" },
  { id: "est_1rm", label: "Est. 1RM" },
  { id: "volume", label: "Total Volume" },
];

export default function ProgressChart({ points }: { points: ProgressPoint[] }) {
  const { s } = useSettings();
  const [metric, setMetric] = useState<Metric>("best_weight");
  const [activeIdx, setActiveIdx] = useState<number | null>(null);
  const gradId = useId();

  if (!points.length) {
    return (
      <div className="rounded-xl border border-line bg-raised/50 px-3 py-3 text-xs text-muted">
        Log at least one session to view progression charts.
      </div>
    );
  }

  const values = points.map((p) => {
    const converted = toDisplay(p[metric], s.unit);
    return metric === "volume" ? Math.round(converted) : converted;
  });

  const minVal = Math.min(...values);
  const maxVal = Math.max(...values);
  const span = maxVal - minVal;
  const yMin = span === 0 ? Math.max(0, minVal - 5) : Math.max(0, minVal - span * 0.15);
  const yMax = span === 0 ? maxVal + 5 : maxVal + span * 0.15;
  const ySpan = yMax - yMin || 1;

  const W = 420;
  const H = 112;
  const PAD_X = 12;
  const PAD_Y = 12;
  const plotW = W - PAD_X * 2;
  const plotH = H - PAD_Y * 2;

  const coords = values.map((v, i) => {
    const x = values.length === 1 ? W / 2 : PAD_X + (i / (values.length - 1)) * plotW;
    const y = PAD_Y + (1 - (v - yMin) / ySpan) * plotH;
    return { x, y, v, date: points[i].date };
  });

  const linePath = coords.map((c, i) => `${i === 0 ? "M" : "L"} ${c.x.toFixed(1)} ${c.y.toFixed(1)}`).join(" ");
  const areaPath =
    coords.length > 1
      ? `${linePath} L ${coords[coords.length - 1].x.toFixed(1)} ${(H - PAD_Y).toFixed(1)} L ${coords[0].x.toFixed(1)} ${(H - PAD_Y).toFixed(1)} Z`
      : "";

  const idx = activeIdx !== null && activeIdx < coords.length ? activeIdx : coords.length - 1;
  const selected = coords[idx];
  const firstVal = values[0];
  const diff = selected.v - firstVal;
  const fmtVal = (v: number) => (metric === "volume" ? Math.round(v).toLocaleString() : v);

  return (
    <div className="space-y-2.5 rounded-xl border border-line bg-raised/40 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex rounded-lg border border-line bg-card p-0.5 text-xs">
          {METRICS.map((m) => (
            <button
              type="button"
              key={m.id}
              onClick={() => setMetric(m.id)}
              className={`rounded-md px-2.5 py-1 font-medium transition-colors ${
                metric === m.id ? "bg-accent text-white" : "text-muted hover:text-fg"
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
        <div className="num flex items-center gap-2 text-xs">
          <span className="text-muted">{fmtDate(selected.date)}</span>
          <span className="font-semibold text-fg">
            {fmtVal(selected.v)} {s.unit}
          </span>
          {points.length > 1 && idx > 0 && diff !== 0 && (
            <span className={`font-medium ${diff > 0 ? "text-mint" : "text-red-400"}`}>
              ({diff > 0 ? "+" : ""}{Math.round(diff * 10) / 10} {s.unit})
            </span>
          )}
        </div>
      </div>

      <div className="relative">
        <svg viewBox={`0 0 ${W} ${H}`} className="h-28 w-full overflow-visible" role="img" aria-label="Exercise progression chart">
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--mint)" stopOpacity="0.28" />
              <stop offset="100%" stopColor="var(--mint)" stopOpacity="0.0" />
            </linearGradient>
          </defs>

          {[0.25, 0.5, 0.75].map((t) => {
            const y = PAD_Y + t * plotH;
            return (
              <line
                key={t}
                x1={PAD_X}
                x2={W - PAD_X}
                y1={y}
                y2={y}
                stroke="var(--border)"
                strokeDasharray="3 3"
                strokeWidth="1"
              />
            );
          })}

          {areaPath && <path d={areaPath} fill={`url(#${gradId})`} />}
          {coords.length > 1 && (
            <path d={linePath} fill="none" stroke="var(--mint)" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" />
          )}

          {coords.map((c, i) => {
            const isSel = i === idx;
            return (
              <g key={i} className="cursor-pointer" onMouseEnter={() => setActiveIdx(i)} onClick={() => setActiveIdx(i)}>
                <circle cx={c.x} cy={c.y} r={10} fill="transparent" />
                <circle
                  cx={c.x}
                  cy={c.y}
                  r={isSel ? 5 : 3.2}
                  fill={isSel ? "var(--accent)" : "var(--mint)"}
                  stroke="var(--card)"
                  strokeWidth="1.75"
                />
              </g>
            );
          })}
        </svg>

        <div className="num flex justify-between px-1 text-[11px] text-muted">
          <span>{fmtDate(points[0].date)}</span>
          <span>
            Range: {fmtVal(Math.round(minVal * 10) / 10)} – {fmtVal(Math.round(maxVal * 10) / 10)} {s.unit}
          </span>
          {points.length > 1 && <span>{fmtDate(points[points.length - 1].date)}</span>}
        </div>
      </div>
    </div>
  );
}
