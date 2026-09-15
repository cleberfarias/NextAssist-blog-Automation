import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WorkspaceProvider } from "../../../hooks/useWorkspace";
import { AnalyticsOverviewTab } from "./AnalyticsOverviewTab";
import type { AnalyticsOverview } from "../../../types/api";

const OVERVIEW_30: AnalyticsOverview = {
  rangeDays: 30,
  visits: { value: 1248, changePct: 12 },
  leads: { value: 23, changePct: 35 },
  conversionRate: { value: 0.018, changePoints: 0.6 },
  customers: { value: 3, changePct: 50 },
  series: [
    { date: "2026-09-13", visits: 10, leads: 1 },
    { date: "2026-09-14", visits: 15, leads: 2 },
  ],
  leadSources: [
    { source: "instagram", count: 5, pct: 42 },
    { source: "site", count: 3, pct: 28 },
  ],
};

const OVERVIEW_90: AnalyticsOverview = { ...OVERVIEW_30, rangeDays: 90, visits: { value: 5000, changePct: null } };

function stubFetch() {
  vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/api/workspaces")) return Promise.resolve({ ok: true, json: async () => [{ id: "nextassist", name: "NextAssist" }] });
    if (url.includes("days=90")) return Promise.resolve({ ok: true, json: async () => OVERVIEW_90 });
    if (url.includes("/api/analytics/overview")) return Promise.resolve({ ok: true, json: async () => OVERVIEW_30 });
    return Promise.resolve({ ok: true, json: async () => ({}) });
  }));
}

describe("AnalyticsOverviewTab", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("mostra os 4 KPIs reais com a variação real, e as origens reais dos leads", async () => {
    stubFetch();
    render(<WorkspaceProvider><AnalyticsOverviewTab /></WorkspaceProvider>);

    expect(await screen.findByText("1.248")).toBeInTheDocument();
    expect(screen.getByText("+12,0%")).toBeInTheDocument();
    expect(screen.getByText("23")).toBeInTheDocument();
    expect(screen.getByText("+35,0%")).toBeInTheDocument();
    expect(screen.getByText("1,8%")).toBeInTheDocument();
    expect(screen.getByText("+0,6 p.p.")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("instagram")).toBeInTheDocument();
    expect(screen.getByText("site")).toBeInTheDocument();
  });

  it("sem período anterior real pra comparar, mostra a mensagem honesta em vez de uma variação inventada", async () => {
    stubFetch();
    render(<WorkspaceProvider><AnalyticsOverviewTab /></WorkspaceProvider>);
    await screen.findByText("1.248");

    await userEvent.selectOptions(screen.getByLabelText("Período"), "90");
    expect(await screen.findByText("5.000")).toBeInTheDocument();
    expect(screen.getByText("Sem período anterior pra comparar")).toBeInTheDocument();
  });
});
