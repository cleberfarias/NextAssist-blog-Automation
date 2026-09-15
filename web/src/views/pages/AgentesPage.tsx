import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useWorkspace } from "../../hooks/useWorkspace";
import { apiGet } from "../../lib/api";
import { usd } from "../../lib/formatters";
import type { ReelDashboardResponse, PerformanceReport, SalesDashboardResponse, UsageReport, RevenueDashboardResponse } from "../../types/api";

export type OfficeAgentId = "social" | "analytics" | "sales" | "finance" | "revenue";

function AgentCard({ agentId, icon, title, status, headline, kpis }: {
  agentId: OfficeAgentId; icon: string; title: string; status: string; headline: string;
  kpis: { label: string; value: string }[];
}) {
  return (
    <Link to={`/agentes/${agentId}`} className="block rounded-lg border border-border bg-surface p-4 hover:border-accent">
      <div className="flex items-center justify-between">
        <span className="text-2xl" aria-hidden="true">{icon}</span>
        <span className="text-xs text-status-ok">{status}</span>
      </div>
      <h2 className="mt-2 font-semibold text-primary">{title}</h2>
      <p className="mt-1 text-sm text-secondary">{headline}</p>
      <div className="mt-3 flex gap-4">
        {kpis.map((kpi) => (
          <div key={kpi.label}>
            <div className="text-xs text-secondary">{kpi.label}</div>
            <div className="text-sm font-semibold text-primary">{kpi.value}</div>
          </div>
        ))}
      </div>
    </Link>
  );
}

function useAgentData<T>(path: string): T | null {
  const { workspace } = useWorkspace();
  const [data, setData] = useState<T | null>(null);
  useEffect(() => {
    if (!workspace) return;
    const controller = new AbortController();
    apiGet<T>(path, workspace, controller.signal).then(setData).catch((err) => {
      if ((err as Error).name !== "AbortError") setData(null);
    });
    return () => controller.abort();
  }, [workspace, path]);
  return data;
}

export function AgentesPage() {
  const reels = useAgentData<ReelDashboardResponse>("/api/reels");
  const performance = useAgentData<PerformanceReport>("/api/performance");
  const sales = useAgentData<SalesDashboardResponse>("/api/sales");
  const usage = useAgentData<UsageReport>("/api/usage");
  const revenue = useAgentData<RevenueDashboardResponse>("/api/revenue");

  const totalImpressions = performance?.posts.reduce((sum, p) => sum + p.impressions, 0) ?? 0;
  const totalClicks = performance?.posts.reduce((sum, p) => sum + p.clicks, 0) ?? 0;

  return (
    <div className="p-6 text-primary">
      <h1 className="mb-4 text-xl font-semibold">Agentes (IA)</h1>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <AgentCard
          agentId="social" icon="📸" title="Social Agent"
          status={reels ? "Em dia" : "Carregando"}
          headline={reels ? `${reels.summary.pendingApproval} aguardando aprovação` : "Carregando..."}
          kpis={[{ label: "Total", value: String(reels?.summary.total ?? 0) }, { label: "Publicados", value: String(reels?.summary.published ?? 0) }]}
        />
        <AgentCard
          agentId="analytics" icon="📈" title="Analytics Agent"
          status="Em dia"
          headline={`${totalImpressions} impressões, ${totalClicks} cliques monitorados`}
          kpis={[{ label: "Impressões", value: String(totalImpressions) }, { label: "Cliques", value: String(totalClicks) }]}
        />
        <AgentCard
          agentId="sales" icon="👥" title="Sales Agent"
          status={sales ? "Em dia" : "Carregando"}
          headline={sales ? `${sales.summary.total} leads, ${sales.summary.hot} quentes` : "Carregando..."}
          kpis={[{ label: "Leads", value: String(sales?.summary.total ?? 0) }, { label: "Quentes", value: String(sales?.summary.hot ?? 0) }]}
        />
        <AgentCard
          agentId="finance" icon="💰" title="Finance Agent"
          status={usage ? "Em dia" : "Carregando"}
          headline={usage ? `Custo do mês: ${usd.format(usage.month.estimatedUsd)} — créditos HeyGen em breve` : "Carregando..."}
          kpis={[{ label: "Custo mês", value: usage ? usd.format(usage.month.estimatedUsd) : "—" }]}
        />
        <AgentCard
          agentId="revenue" icon="👑" title="Revenue Director"
          status="Planejando"
          headline={revenue?.decision.reason ?? "Carregando..."}
          kpis={[{ label: "Clientes", value: revenue ? `${revenue.snapshot.customers}/${revenue.monthlyCustomerTarget ?? "—"}` : "—" }]}
        />
      </div>
    </div>
  );
}
