import { pickEvenIndices, formatShortDate } from "./chartHelpers";
import type { AnalyticsOverviewSeriesPoint } from "../../../types/api";

const WIDTH = 560;
const HEIGHT = 180;
const PADDING = 24;

function points(series: AnalyticsOverviewSeriesPoint[], key: "visits" | "leads", maxY: number): string {
  const stepX = series.length > 1 ? (WIDTH - PADDING * 2) / (series.length - 1) : 0;
  const scaleY = (v: number) => HEIGHT - PADDING - (maxY > 0 ? (v / maxY) * (HEIGHT - PADDING * 2) : 0);
  return series.map((p, i) => `${PADDING + i * stepX},${scaleY(p[key])}`).join(" ");
}

export function TrendChart({ series }: { series: AnalyticsOverviewSeriesPoint[] }) {
  const maxY = Math.max(1, ...series.map((p) => Math.max(p.visits, p.leads)));
  const stepX = series.length > 1 ? (WIDTH - PADDING * 2) / (series.length - 1) : 0;
  const labelIndices = pickEvenIndices(series.length, 7);
  const hasData = series.some((p) => p.visits > 0 || p.leads > 0);

  return (
    <div>
      <div className="mb-2 flex items-center gap-4 text-xs text-secondary">
        <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-accent" aria-hidden="true" />Visitas</span>
        <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-status-ok" aria-hidden="true" />Leads</span>
      </div>
      {hasData ? (
        <svg viewBox={`0 0 ${WIDTH} ${HEIGHT + 20}`} className="w-full" role="img" aria-label="Visitas e leads ao longo do período">
          <polyline points={points(series, "visits", maxY)} fill="none" stroke="#7b61ff" strokeWidth="2" />
          <polyline points={points(series, "leads", maxY)} fill="none" stroke="#34b56b" strokeWidth="2" />
          {labelIndices.map((i) => (
            <text key={i} x={PADDING + i * stepX} y={HEIGHT + 14} fontSize="9" fill="#8992a5" textAnchor="middle">
              {formatShortDate(series[i].date)}
            </text>
          ))}
        </svg>
      ) : (
        <p className="py-10 text-center text-sm text-secondary">Sem visitas ou leads registrados neste período.</p>
      )}
    </div>
  );
}
