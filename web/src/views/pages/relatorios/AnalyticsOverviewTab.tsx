import { useEffect, useState } from "react";
import { useWorkspace } from "../../../hooks/useWorkspace";
import { apiGet } from "../../../lib/api";
import { nf } from "../../../lib/formatters";
import { formatSignedPct } from "./chartHelpers";
import { TrendChart } from "./TrendChart";
import { LeadSourceDonut } from "./LeadSourceDonut";
import type { AnalyticsOverview } from "../../../types/api";

const RANGE_OPTIONS = [
  { days: 7, label: "Últimos 7 dias" },
  { days: 30, label: "Últimos 30 dias" },
  { days: 90, label: "Últimos 90 dias" },
];

function ChangeBadge({ changePct, changePoints }: { changePct?: number | null; changePoints?: number | null }) {
  const change = changePct ?? changePoints ?? null;
  if (change === null) return <div className="mt-1 text-xs text-secondary">Sem período anterior pra comparar</div>;
  const suffix = changePoints !== undefined ? " p.p." : "%";
  const color = change >= 0 ? "text-status-ok" : "text-status-error";
  return <div className={`mt-1 text-xs font-semibold ${color}`}>{formatSignedPct(change)}{suffix}</div>;
}

function KpiCard({ label, value, changePct, changePoints }: { label: string; value: string; changePct?: number | null; changePoints?: number | null }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="text-xs text-secondary">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-primary">{value}</div>
      <ChangeBadge changePct={changePct} changePoints={changePoints} />
    </div>
  );
}

export function AnalyticsOverviewTab() {
  const { workspace } = useWorkspace();
  const [days, setDays] = useState(30);
  const [data, setData] = useState<AnalyticsOverview | null>(null);

  useEffect(() => {
    if (!workspace) return;
    const controller = new AbortController();
    apiGet<AnalyticsOverview>(`/api/analytics/overview?days=${days}`, workspace, controller.signal, "Não foi possível carregar os relatórios.")
      .then(setData)
      .catch((err) => { if ((err as Error).name !== "AbortError") setData(null); });
    return () => controller.abort();
  }, [workspace, days]);

  return (
    <div>
      <div className="flex justify-end">
        <select
          aria-label="Período"
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
          className="rounded-md border border-border bg-app px-2 py-1.5 text-sm text-primary"
        >
          {RANGE_OPTIONS.map((o) => <option key={o.days} value={o.days}>{o.label}</option>)}
        </select>
      </div>

      {!data ? (
        <p className="mt-6 text-sm text-secondary">Aguardando dados</p>
      ) : (
        <>
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard label="Visitas no site" value={nf.format(data.visits.value)} changePct={data.visits.changePct} />
            <KpiCard label="Leads gerados" value={nf.format(data.leads.value)} changePct={data.leads.changePct} />
            <KpiCard label="Taxa de conversão" value={`${(data.conversionRate.value * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`} changePoints={data.conversionRate.changePoints} />
            <KpiCard label="Clientes" value={nf.format(data.customers.value)} changePct={data.customers.changePct} />
          </div>

          <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="rounded-lg border border-border bg-surface p-4">
              <h2 className="mb-3 text-sm font-semibold text-primary">Visitas e Leads</h2>
              <TrendChart series={data.series} />
            </div>
            <div className="rounded-lg border border-border bg-surface p-4">
              <h2 className="mb-3 text-sm font-semibold text-primary">Origem dos leads</h2>
              <LeadSourceDonut sources={data.leadSources} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
