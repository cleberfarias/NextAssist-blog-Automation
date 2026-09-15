import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "./App";

class FakeEventSource {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(_url: string) {}
  close() {}
}

describe("App shell", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("renders all 9 sidebar items and navigates between routes", async () => {
    vi.stubGlobal("EventSource", FakeEventSource as unknown as typeof EventSource);
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/workspaces")) return Promise.resolve({ ok: true, json: async () => [{ id: "nextassist", name: "NextAssist" }] });
      if (url.includes("/api/status")) return Promise.resolve({ ok: true, json: async () => ({ running: false, lastEvents: [], runMode: "local" }) });
      if (url.includes("/api/history")) return Promise.resolve({ ok: true, json: async () => [] });
      if (url.includes("/api/sales")) return Promise.resolve({ ok: true, json: async () => ({ updatedAt: null, summary: { total: 0, hot: 0, medium: 0, customers: 0, draftsPendingApproval: 0 }, entries: [] }) });
      if (url.includes("/api/reels")) return Promise.resolve({ ok: true, json: async () => ({ updatedAt: null, summary: { total: 0, pendingApproval: 0, approved: 0, published: 0, failed: 0 }, entries: [] }) });
      if (url.includes("/api/performance")) return Promise.resolve({ ok: true, json: async () => ({ atualizadoEm: "2026-09-15T00:00:00.000Z", periodo: { inicio: "", fim: "" }, posts: [] }) });
      if (url.includes("/api/usage")) return Promise.resolve({ ok: true, json: async () => ({ trackedRuns: 0, month: { estimatedUsd: 0, inputTokens: 0, outputTokens: 0, webSearchRequests: 0 }, total: { estimatedUsd: 0, inputTokens: 0, outputTokens: 0, webSearchRequests: 0 }, averagePublishedUsd: 0 }) });
      if (url.includes("/api/attribution")) return Promise.resolve({ ok: true, json: async () => ({ rows: [], unattributedEvents: 0 }) });
      if (url.includes("/api/revenue")) return Promise.resolve({ ok: true, json: async () => ({ runId: "r1", monthlyCustomerTarget: 10, snapshot: { visits: 0, trials: 0, activated: 0, customers: 0, hotLeads: 0, pendingSalesApprovals: 0, visitToTrialRate: 0, trialToActivationRate: 0, activationToCustomerRate: 0 }, decision: { objective: "increase_paying_customers", bottleneck: "traffic", action: "create_content", priority: "medium", reason: "Pouco tráfego ainda.", evidence: [], requiresHumanApproval: true } }) });
      if (url.includes("/api/harness/traces")) return Promise.resolve({ ok: true, json: async () => ({ updatedAt: null, traces: [] }) });
      return Promise.resolve({ ok: true, json: async () => ({}) });
    }));

    render(<App />);

    const items = ["Dashboard", "Agentes (IA)", "Conteúdo", "Reels", "Blog", "Leads", "Clientes", "Relatórios", "Configurações"];
    for (const label of items) {
      expect(await screen.findByRole("link", { name: label })).toBeInTheDocument();
    }

    expect(await screen.findByText("Agentes em ação")).toBeInTheDocument();
    expect(screen.getByText("Metas do mês")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("link", { name: "Reels" }));
    expect(await screen.findByText("Gerencie a produção e publicação dos seus vídeos")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("link", { name: "Blog" }));
    expect(await screen.findByText("Nenhum post publicado ainda.")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("link", { name: "Leads" }));
    expect(await screen.findByText("Sales Agent")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("link", { name: "Relatórios" }));
    expect(await screen.findByText("Consumo de IA")).toBeInTheDocument();
  });
});
