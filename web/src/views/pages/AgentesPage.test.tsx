import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { WorkspaceProvider } from "../../hooks/useWorkspace";
import { AgentesPage } from "./AgentesPage";

describe("AgentesPage", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("renderiza os 5 cards de agente com dados reais", async () => {
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/workspaces")) return Promise.resolve({ ok: true, json: async () => [{ id: "nextassist", name: "NextAssist" }] });
      if (url.includes("/api/reels")) return Promise.resolve({ ok: true, json: async () => ({ updatedAt: null, summary: { total: 2, pendingApproval: 1, approved: 0, published: 1, failed: 0 }, entries: [] }) });
      if (url.includes("/api/performance")) return Promise.resolve({ ok: true, json: async () => ({ atualizadoEm: "2026-09-15T00:00:00.000Z", periodo: { inicio: "", fim: "" }, posts: [{ slug: "a", titulo: "A", url: "", indexado: true, coverageState: "", clicks: 10, impressions: 500, ctr: 0.02, position: 5 }] }) });
      if (url.includes("/api/sales")) return Promise.resolve({ ok: true, json: async () => ({ updatedAt: null, summary: { total: 4, hot: 2, medium: 1, customers: 1, draftsPendingApproval: 0 }, entries: [] }) });
      if (url.includes("/api/usage")) return Promise.resolve({ ok: true, json: async () => ({ trackedRuns: 3, month: { estimatedUsd: 12.5, inputTokens: 0, outputTokens: 0, webSearchRequests: 0 }, total: { estimatedUsd: 40, inputTokens: 0, outputTokens: 0, webSearchRequests: 0 }, averagePublishedUsd: 4 }) });
      if (url.includes("/api/revenue")) return Promise.resolve({ ok: true, json: async () => ({ runId: "r1", monthlyCustomerTarget: 10, snapshot: { visits: 0, trials: 0, activated: 0, customers: 2, hotLeads: 0, pendingSalesApprovals: 0, visitToTrialRate: 0, trialToActivationRate: 0, activationToCustomerRate: 0 }, decision: { objective: "increase_paying_customers", bottleneck: "traffic", action: "create_content", priority: "medium", reason: "Pouco tráfego ainda.", evidence: [], requiresHumanApproval: true } }) });
      return Promise.resolve({ ok: true, json: async () => ({}) });
    }));

    render(<WorkspaceProvider><MemoryRouter><AgentesPage /></MemoryRouter></WorkspaceProvider>);

    expect(await screen.findByText("Social Agent")).toBeInTheDocument();
    expect(screen.getByText("Analytics Agent")).toBeInTheDocument();
    expect(screen.getByText("Sales Agent")).toBeInTheDocument();
    expect(screen.getByText("Finance Agent")).toBeInTheDocument();
    expect(screen.getByText("Revenue Director")).toBeInTheDocument();
    expect(await screen.findByText(/1 Reel\(s\) aguardando sua aprovação/)).toBeInTheDocument();
    expect(screen.getByText(/Pouco tráfego ainda\./)).toBeInTheDocument();
  });
});
