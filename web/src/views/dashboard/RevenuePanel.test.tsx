import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { WorkspaceProvider } from "../../hooks/useWorkspace";
import { RevenuePanel } from "./RevenuePanel";

const BASE_RESPONSE = {
  runId: "run-1",
  monthlyCustomerTarget: null,
  snapshot: { visits: 12, trials: 2, activated: 1, customers: 0, hotLeads: 1, pendingSalesApprovals: 0, visitToTrialRate: 0.16, trialToActivationRate: 0.5, activationToCustomerRate: 0 },
  decision: { objective: "increase_paying_customers", bottleneck: "traffic", action: "create_content", priority: "medium", reason: "pouco tráfego", evidence: ["12 visitas"], requiresHumanApproval: false },
};

function stubFetch(response: unknown) {
  vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/api/workspaces")) return Promise.resolve({ ok: true, json: async () => [{ id: "nextassist", name: "NextAssist" }] });
    if (url.includes("/api/revenue")) return Promise.resolve({ ok: true, json: async () => response });
    return Promise.resolve({ ok: true, json: async () => ({}) });
  }));
}

describe("RevenuePanel", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sem growthLoop ainda persistido, não mostra a seção do loop", async () => {
    stubFetch({ ...BASE_RESPONSE, growthLoop: null });
    render(<WorkspaceProvider><RevenuePanel /></WorkspaceProvider>);

    expect(await screen.findByText("Revenue Director")).toBeInTheDocument();
    expect(screen.queryByText("Loop de Crescimento")).not.toBeInTheDocument();
  });

  it("com growthLoop preparado pelo Marketing Director, mostra a cadeia completa", async () => {
    stubFetch({
      ...BASE_RESPONSE,
      growthLoop: {
        runId: "gl-1", startedAt: "2026-09-16T12:00:00.000Z", completedAt: "2026-09-16T12:00:05.000Z", updatedAt: "2026-09-16T12:00:05.000Z",
        snapshot: BASE_RESPONSE.snapshot, decision: BASE_RESPONSE.decision,
        outcome: { type: "marketing", skipped: false, pendingBefore: 1, generated: 3, discardedDuplicates: 0, discardedForbidden: 0, discardedInvalid: 0, pendingAfter: 4, error: null },
      },
    });
    render(<WorkspaceProvider><RevenuePanel /></WorkspaceProvider>);

    expect(await screen.findByText("Loop de Crescimento")).toBeInTheDocument();
    expect(screen.getByText(/Marketing Director preparou 3 pauta/)).toBeInTheDocument();
  });

  it("com growthLoop roteado pro Sales Agent, mostra rascunhos criados e reaproveitados", async () => {
    stubFetch({
      ...BASE_RESPONSE,
      decision: { ...BASE_RESPONSE.decision, bottleneck: "sales_followup", action: "prioritize_hot_leads" },
      growthLoop: {
        runId: "gl-2", startedAt: "2026-09-16T12:00:00.000Z", completedAt: "2026-09-16T12:00:05.000Z", updatedAt: "2026-09-16T12:00:05.000Z",
        snapshot: BASE_RESPONSE.snapshot, decision: { ...BASE_RESPONSE.decision, bottleneck: "sales_followup", action: "prioritize_hot_leads" },
        outcome: { type: "sales", leadsAssessed: 5, outreachCreated: 2, outreachReused: 1 },
      },
    });
    render(<WorkspaceProvider><RevenuePanel /></WorkspaceProvider>);

    expect(await screen.findByText("Loop de Crescimento")).toBeInTheDocument();
    expect(screen.getByText(/2 rascunho\(s\) novo\(s\)/)).toBeInTheDocument();
    expect(screen.getByText(/1 reaproveitado\(s\)/)).toBeInTheDocument();
  });
});
