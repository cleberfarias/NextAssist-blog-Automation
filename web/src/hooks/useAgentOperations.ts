import { useEffect, useState } from "react";
import { useWorkspace } from "./useWorkspace";
import { apiGet } from "../lib/api";
import { usd } from "../lib/formatters";
import type { ReelDashboardResponse, PerformanceReport, SalesDashboardResponse, UsageReport, RevenueDashboardResponse } from "../types/api";

export type OfficeAgentId = "social" | "analytics" | "sales" | "finance" | "revenue";
export type AgentOperationalStatus = "working" | "waiting" | "needs_attention" | "failed" | "completed" | "idle";

export interface AgentOperationalState {
  agentId: OfficeAgentId;
  title: string;
  icon: string;
  status: AgentOperationalStatus;
  statusLabel: string;
  message: string;
  kpis: { label: string; value: string }[];
}

const STATUS_LABELS: Record<AgentOperationalStatus, string> = {
  working: "Trabalhando",
  waiting: "Aguardando",
  needs_attention: "Precisa de atenção",
  failed: "Falhou",
  completed: "Em dia",
  idle: "Ocioso",
};

const NO_DATA_MESSAGE = "Dados ainda não disponíveis.";

/** Mapeia o status de 4 valores do pipeline (idle/working/done/error) pro status operacional de 6 valores usado nos balões/cards de agente — só a cor/semântica, o rótulo de texto continua vindo de STATUS_LABEL (LiveStatus.tsx), que já é o texto certo pra um estágio de pipeline. */
export function pipelineStatusToOperational(status: "idle" | "working" | "done" | "error"): AgentOperationalStatus {
  if (status === "done") return "completed";
  if (status === "working") return "working";
  if (status === "error") return "failed";
  return "idle";
}

function idleState(agentId: OfficeAgentId, title: string, icon: string): AgentOperationalState {
  return { agentId, title, icon, status: "idle", statusLabel: STATUS_LABELS.idle, message: NO_DATA_MESSAGE, kpis: [] };
}

function minutesSince(iso: string): number {
  return Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
}

function deriveSocial(reels: ReelDashboardResponse | null): AgentOperationalState {
  const base = { agentId: "social" as const, title: "Social Agent", icon: "📸" };
  if (!reels) return idleState("social", base.title, base.icon);
  const kpis = [{ label: "Total", value: String(reels.summary.total) }, { label: "Publicados", value: String(reels.summary.published) }];

  const failedEntry = reels.entries.find((e) => e.status === "failed");
  if (failedEntry) return { ...base, status: "failed", statusLabel: STATUS_LABELS.failed, message: failedEntry.error ?? "Um Reel falhou.", kpis };

  const renderingEntry = reels.entries.find((e) => e.status === "rendering");
  if (renderingEntry) {
    return { ...base, status: "working", statusLabel: STATUS_LABELS.working, message: `Seu Reel está sendo processado há ${minutesSince(renderingEntry.updatedAt)} min.`, kpis };
  }

  if (reels.summary.pendingApproval > 0) {
    return { ...base, status: "needs_attention", statusLabel: STATUS_LABELS.needs_attention, message: `${reels.summary.pendingApproval} Reel(s) aguardando sua aprovação.`, kpis };
  }

  if (reels.summary.total === 0) return idleState("social", base.title, base.icon);
  return { ...base, status: "completed", statusLabel: STATUS_LABELS.completed, message: "Nenhum Reel pendente no momento.", kpis };
}

function deriveAnalytics(performance: PerformanceReport | null): AgentOperationalState {
  const base = { agentId: "analytics" as const, title: "Analytics Agent", icon: "📈" };
  if (!performance || performance.posts.length === 0) return idleState("analytics", base.title, base.icon);
  const impressions = performance.posts.reduce((sum, p) => sum + p.impressions, 0);
  const clicks = performance.posts.reduce((sum, p) => sum + p.clicks, 0);
  return {
    ...base, status: "completed", statusLabel: STATUS_LABELS.completed,
    message: `${impressions} impressões, ${clicks} cliques monitorados.`,
    kpis: [{ label: "Impressões", value: String(impressions) }, { label: "Cliques", value: String(clicks) }],
  };
}

function deriveSales(sales: SalesDashboardResponse | null): AgentOperationalState {
  const base = { agentId: "sales" as const, title: "Sales Agent", icon: "👥" };
  if (!sales) return idleState("sales", base.title, base.icon);
  const kpis = [{ label: "Leads", value: String(sales.summary.total) }, { label: "Quentes", value: String(sales.summary.hot) }];

  if (sales.summary.hot > 0) {
    return { ...base, status: "needs_attention", statusLabel: STATUS_LABELS.needs_attention, message: `${sales.summary.hot} lead(s) quente(s) precisam de acompanhamento.`, kpis };
  }
  if (sales.summary.draftsPendingApproval > 0) {
    return { ...base, status: "waiting", statusLabel: STATUS_LABELS.waiting, message: `${sales.summary.draftsPendingApproval} rascunho(s) de abordagem aguardando aprovação.`, kpis };
  }
  if (sales.summary.total === 0) return idleState("sales", base.title, base.icon);
  return { ...base, status: "completed", statusLabel: STATUS_LABELS.completed, message: "Nenhum lead quente no momento.", kpis };
}

function deriveFinance(usage: UsageReport | null): AgentOperationalState {
  const base = { agentId: "finance" as const, title: "Finance Agent", icon: "💰" };
  if (!usage || usage.trackedRuns === 0) return idleState("finance", base.title, base.icon);
  return {
    ...base, status: "completed", statusLabel: STATUS_LABELS.completed,
    message: `Custo de IA atualizado: ${usd.format(usage.month.estimatedUsd)}.`,
    kpis: [{ label: "Custo mês", value: usd.format(usage.month.estimatedUsd) }],
  };
}

function deriveRevenue(revenue: RevenueDashboardResponse | null): AgentOperationalState {
  const base = { agentId: "revenue" as const, title: "Revenue Director", icon: "👑" };
  if (!revenue) return idleState("revenue", base.title, base.icon);
  const status: AgentOperationalStatus = revenue.decision.priority === "high" ? "needs_attention" : "working";
  return {
    ...base, status, statusLabel: STATUS_LABELS[status], message: revenue.decision.reason,
    kpis: [{ label: "Clientes", value: `${revenue.snapshot.customers}/${revenue.monthlyCustomerTarget ?? "—"}` }],
  };
}

export interface AgentOperationsSources {
  reels: ReelDashboardResponse | null;
  performance: PerformanceReport | null;
  sales: SalesDashboardResponse | null;
  usage: UsageReport | null;
  revenue: RevenueDashboardResponse | null;
}

/** Pura — recebe as respostas já buscadas e deriva status/mensagem sem inventar nenhum número. */
export function deriveAgentOperations(sources: AgentOperationsSources): Record<OfficeAgentId, AgentOperationalState> {
  return {
    social: deriveSocial(sources.reels),
    analytics: deriveAnalytics(sources.performance),
    sales: deriveSales(sources.sales),
    finance: deriveFinance(sources.usage),
    revenue: deriveRevenue(sources.revenue),
  };
}

/** Exportado para outras telas (ex.: Dashboard) que precisam de um dos 5 endpoints crus, sem passar pela derivação de status. */
export function useAgentData<T>(path: string): T | null {
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

/**
 * Fonte única de dados operacionais dos 5 agentes — consumida tanto pela
 * página Agentes (operação detalhada) quanto pelo Dashboard (resumo
 * executivo), para nunca duplicar a lógica de status/mensagem entre as duas.
 */
export function useAgentOperations(): { agents: Record<OfficeAgentId, AgentOperationalState>; loading: boolean } {
  const reels = useAgentData<ReelDashboardResponse>("/api/reels");
  const performance = useAgentData<PerformanceReport>("/api/performance");
  const sales = useAgentData<SalesDashboardResponse>("/api/sales");
  const usage = useAgentData<UsageReport>("/api/usage");
  const revenue = useAgentData<RevenueDashboardResponse>("/api/revenue");

  return {
    agents: deriveAgentOperations({ reels, performance, sales, usage, revenue }),
    loading: !reels && !performance && !sales && !usage && !revenue,
  };
}
