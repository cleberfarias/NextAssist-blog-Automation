import { describe, it, expect } from "vitest";
import { deriveAgentOperations } from "./useAgentOperations";
import type { ReelDashboardResponse, PerformanceReport, SalesDashboardResponse, UsageReport, RevenueDashboardResponse } from "../types/api";

const EMPTY_REELS: ReelDashboardResponse = { updatedAt: null, summary: { total: 0, pendingApproval: 0, approved: 0, published: 0, failed: 0 }, entries: [] };
const EMPTY_PERFORMANCE: PerformanceReport = { atualizadoEm: "", periodo: { inicio: "", fim: "" }, posts: [] };
const EMPTY_SALES: SalesDashboardResponse = { updatedAt: null, summary: { total: 0, hot: 0, medium: 0, customers: 0, draftsPendingApproval: 0 }, entries: [] };
const EMPTY_USAGE: UsageReport = { trackedRuns: 0, month: { estimatedUsd: 0, inputTokens: 0, outputTokens: 0, webSearchRequests: 0 }, total: { estimatedUsd: 0, inputTokens: 0, outputTokens: 0, webSearchRequests: 0 }, averagePublishedUsd: 0 };
const EMPTY_REVENUE: RevenueDashboardResponse = {
  runId: "r1", monthlyCustomerTarget: null,
  snapshot: { visits: 0, trials: 0, activated: 0, customers: 0, hotLeads: 0, pendingSalesApprovals: 0, visitToTrialRate: 0, trialToActivationRate: 0, activationToCustomerRate: 0 },
  decision: { objective: "increase_paying_customers", bottleneck: "none", action: "do_nothing", priority: "low", reason: "", evidence: [], requiresHumanApproval: false },
  growthLoop: null,
};

describe("deriveAgentOperations", () => {
  it("sem nenhum dado, todos os agentes ficam idle com 'Dados ainda não disponíveis'", () => {
    const result = deriveAgentOperations({ reels: null, performance: null, sales: null, usage: null, revenue: null });
    for (const agentId of ["social", "analytics", "sales", "finance", "revenue"] as const) {
      expect(result[agentId].status).toBe("idle");
      expect(result[agentId].message).toBe("Dados ainda não disponíveis.");
    }
  });

  it("Social Agent: Reel rendering vira 'working' com minutos reais decorridos", () => {
    const tenMinAgo = new Date(Date.now() - 10 * 60_000).toISOString();
    const reels: ReelDashboardResponse = {
      ...EMPTY_REELS,
      summary: { ...EMPTY_REELS.summary, total: 1 },
      entries: [{ id: "r1", slug: "teste", title: "Teste", blogUrl: "", caption: "", status: "rendering", updatedAt: tenMinAgo, audit: [] }],
    };
    const result = deriveAgentOperations({ reels, performance: null, sales: null, usage: null, revenue: null });
    expect(result.social.status).toBe("working");
    expect(result.social.message).toBe("Seu Reel está sendo processado há 10 min.");
  });

  it("Social Agent: Reel failed vira 'failed' com o erro real do backend", () => {
    const reels: ReelDashboardResponse = {
      ...EMPTY_REELS,
      summary: { ...EMPTY_REELS.summary, total: 1, failed: 1 },
      entries: [{ id: "r1", slug: "teste", title: "Teste", blogUrl: "", caption: "", status: "failed", updatedAt: new Date().toISOString(), audit: [], error: "HeyGen API: resposta HTTP 402." }],
    };
    const result = deriveAgentOperations({ reels, performance: null, sales: null, usage: null, revenue: null });
    expect(result.social.status).toBe("failed");
    expect(result.social.message).toBe("HeyGen API: resposta HTTP 402.");
  });

  it("Social Agent: sem rendering/failed, com pendingApproval > 0 vira 'needs_attention'", () => {
    const reels: ReelDashboardResponse = { ...EMPTY_REELS, summary: { ...EMPTY_REELS.summary, total: 2, pendingApproval: 2 } };
    const result = deriveAgentOperations({ reels, performance: null, sales: null, usage: null, revenue: null });
    expect(result.social.status).toBe("needs_attention");
    expect(result.social.message).toBe("2 Reel(s) aguardando sua aprovação.");
  });

  it("Sales Agent: leads quentes viram 'needs_attention' com contagem real", () => {
    const sales: SalesDashboardResponse = { ...EMPTY_SALES, summary: { ...EMPTY_SALES.summary, total: 5, hot: 3 } };
    const result = deriveAgentOperations({ reels: null, performance: null, sales, usage: null, revenue: null });
    expect(result.sales.status).toBe("needs_attention");
    expect(result.sales.message).toBe("3 lead(s) quente(s) precisam de acompanhamento.");
  });

  it("Finance Agent: com dado de uso vira 'completed' e mostra custo real formatado", () => {
    const usage: UsageReport = { ...EMPTY_USAGE, trackedRuns: 3, month: { ...EMPTY_USAGE.month, estimatedUsd: 12.5 } };
    const result = deriveAgentOperations({ reels: null, performance: null, sales: null, usage, revenue: null });
    expect(result.finance.status).toBe("completed");
    expect(result.finance.message).toContain("Custo de IA atualizado");
    expect(result.finance.message).toContain("12,50");
  });

  it("Revenue Director: usa o reason real da decisão, nunca um texto inventado", () => {
    const revenue: RevenueDashboardResponse = { ...EMPTY_REVENUE, decision: { ...EMPTY_REVENUE.decision, priority: "high", reason: "Gargalo real: pouca ativação de trial." } };
    const result = deriveAgentOperations({ reels: null, performance: null, sales: null, usage: null, revenue });
    expect(result.revenue.status).toBe("needs_attention");
    expect(result.revenue.message).toBe("Gargalo real: pouca ativação de trial.");
  });

  it("Analytics Agent: com posts reais vira 'completed' e soma impressões/cliques reais", () => {
    const performance: PerformanceReport = {
      ...EMPTY_PERFORMANCE,
      posts: [
        { slug: "a", titulo: "A", url: "", indexado: true, coverageState: "", clicks: 10, impressions: 500, ctr: 0.02, position: 5 },
        { slug: "b", titulo: "B", url: "", indexado: true, coverageState: "", clicks: 5, impressions: 300, ctr: 0.02, position: 8 },
      ],
    };
    const result = deriveAgentOperations({ reels: null, performance, sales: null, usage: null, revenue: null });
    expect(result.analytics.status).toBe("completed");
    expect(result.analytics.message).toBe("800 impressões, 15 cliques monitorados.");
  });
});
