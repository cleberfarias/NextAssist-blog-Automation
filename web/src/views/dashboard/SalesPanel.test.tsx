import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { WorkspaceProvider } from "../../hooks/useWorkspace";
import { SalesPanel } from "./SalesPanel";

const RESPONSE = {
  updatedAt: "2026-09-15T00:00:00.000Z",
  summary: { total: 2, hot: 1, medium: 1, customers: 1, draftsPendingApproval: 0 },
  entries: [
    { lead: { leadId: "l1", userId: "Lead Quente", signals: [] }, assessment: { leadId: "l1", score: 90, intent: "high", nextAction: "invite_trial", reasons: [] } },
    { lead: { leadId: "l2", userId: "Cliente Atual", signals: [] }, assessment: { leadId: "l2", score: 100, intent: "customer", nextAction: "customer_success", reasons: [] } },
  ],
};

describe("SalesPanel", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("filterIntent='customer' mostra só o lead com intent customer", async () => {
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/workspaces")) return Promise.resolve({ ok: true, json: async () => [{ id: "nextassist", name: "NextAssist" }] });
      if (url.includes("/api/sales")) return Promise.resolve({ ok: true, json: async () => RESPONSE });
      return Promise.resolve({ ok: true, json: async () => ({}) });
    }));

    render(<WorkspaceProvider><SalesPanel filterIntent="customer" /></WorkspaceProvider>);

    expect(await screen.findByText("Cliente Atual")).toBeInTheDocument();
    expect(screen.queryByText("Lead Quente")).not.toBeInTheDocument();
  });
});
