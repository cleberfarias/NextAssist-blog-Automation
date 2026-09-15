import type { AnalyticsOverviewLeadSource } from "../../../types/api";

const SIZE = 160;
const RADIUS = 56;
const STROKE = 22;
const CENTER = SIZE / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
const COLORS = ["#7b61ff", "#34b56b", "#ffb020", "#e5484d", "#8992a5"];

export function LeadSourceDonut({ sources }: { sources: AnalyticsOverviewLeadSource[] }) {
  if (sources.length === 0) {
    return <p className="py-10 text-center text-sm text-secondary">Sem leads registrados neste período.</p>;
  }

  let offset = 0;
  const arcs = sources.map((s, i) => {
    const dash = (s.pct / 100) * CIRCUMFERENCE;
    const arc = { source: s, color: COLORS[i % COLORS.length], dash, offset };
    offset += dash;
    return arc;
  });

  return (
    <div className="flex items-center gap-6">
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="h-40 w-40 shrink-0" role="img" aria-label="Origem dos leads">
        <circle cx={CENTER} cy={CENTER} r={RADIUS} fill="none" stroke="#1f2940" strokeWidth={STROKE} />
        {arcs.map(({ source, color, dash, offset: arcOffset }) => (
          <circle
            key={source.source}
            cx={CENTER}
            cy={CENTER}
            r={RADIUS}
            fill="none"
            stroke={color}
            strokeWidth={STROKE}
            strokeDasharray={`${dash} ${CIRCUMFERENCE - dash}`}
            strokeDashoffset={-arcOffset}
            transform={`rotate(-90 ${CENTER} ${CENTER})`}
          />
        ))}
      </svg>
      <ul className="space-y-1.5 text-sm">
        {arcs.map(({ source, color }) => (
          <li key={source.source} className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: color }} aria-hidden="true" />
            <span className="text-primary">{source.source}</span>
            <span className="text-secondary">{Math.round(source.pct)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
