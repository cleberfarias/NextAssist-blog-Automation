import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { WorkspaceProvider } from "../../../hooks/useWorkspace";
import { PipelineProvider } from "../../../hooks/usePipeline";
import { ToastProvider } from "../../../components/ui/Toast";
import { AgentDepartmentTabs } from "./AgentDepartmentTabs";

class FakeEventSource {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(_url: string) {}
  close() {}
}

describe("AgentDepartmentTabs", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("alterna entre o departamento Agent Office (5 agentes) e Equipe de conteúdo (8 agentes)", async () => {
    vi.stubGlobal("EventSource", FakeEventSource as unknown as typeof EventSource);
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/workspaces")) return Promise.resolve({ ok: true, json: async () => [{ id: "nextassist", name: "NextAssist" }] });
      if (url.includes("/api/status")) return Promise.resolve({ ok: true, json: async () => ({ running: false, lastEvents: [], runMode: "local" }) });
      if (url.includes("/api/runs")) return Promise.resolve({ ok: true, json: async () => [] });
      if (url.includes("/api/reels")) return Promise.resolve({ ok: true, json: async () => ({ updatedAt: null, summary: { total: 0, pendingApproval: 0, approved: 0, published: 0, failed: 0 }, entries: [] }) });
      if (url.includes("/api/performance")) return Promise.resolve({ ok: true, json: async () => ({ atualizadoEm: "", periodo: { inicio: "", fim: "" }, posts: [] }) });
      if (url.includes("/api/sales")) return Promise.resolve({ ok: true, json: async () => ({ updatedAt: null, summary: { total: 0, hot: 0, medium: 0, customers: 0, draftsPendingApproval: 0 }, entries: [] }) });
      if (url.includes("/api/usage")) return Promise.resolve({ ok: true, json: async () => ({ trackedRuns: 0, month: { estimatedUsd: 0, inputTokens: 0, outputTokens: 0, webSearchRequests: 0 }, total: { estimatedUsd: 0, inputTokens: 0, outputTokens: 0, webSearchRequests: 0 }, averagePublishedUsd: 0 }) });
      if (url.includes("/api/revenue")) return Promise.resolve({ ok: true, json: async () => ({ runId: "r1", monthlyCustomerTarget: null, snapshot: { visits: 0, trials: 0, activated: 0, customers: 0, hotLeads: 0, pendingSalesApprovals: 0, visitToTrialRate: 0, trialToActivationRate: 0, activationToCustomerRate: 0 }, decision: { objective: "increase_paying_customers", bottleneck: "none", action: "do_nothing", priority: "low", reason: "", evidence: [], requiresHumanApproval: false } }) });
      return Promise.resolve({ ok: true, json: async () => ({}) });
    }));

    render(
      <WorkspaceProvider>
        <ToastProvider>
          <PipelineProvider>
            <MemoryRouter><AgentDepartmentTabs /></MemoryRouter>
          </PipelineProvider>
        </ToastProvider>
      </WorkspaceProvider>,
    );

    expect(await screen.findByText("Agentes em ação")).toBeInTheDocument();
    expect(screen.queryByText("Equipe de conteúdo")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("tab", { name: /Equipe de conteúdo/ }));
    expect(await screen.findByText("Equipe de conteúdo")).toBeInTheDocument();
    expect(screen.queryByText("Agentes em ação")).not.toBeInTheDocument();
  });
});
