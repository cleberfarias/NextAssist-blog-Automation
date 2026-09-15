import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { WorkspaceProvider } from "../../hooks/useWorkspace";
import { PipelineProvider } from "../../hooks/usePipeline";
import { ToastProvider } from "../../components/ui/Toast";
import { AgenteDetailPage } from "./AgenteDetailPage";

class FakeEventSource {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(_url: string) {}
  close() {}
}

const EMPTY_REELS = { updatedAt: null, summary: { total: 0, pendingApproval: 0, approved: 0, published: 0, failed: 0 }, entries: [] };
const EMPTY_PERFORMANCE = { atualizadoEm: "", periodo: { inicio: "", fim: "" }, posts: [] };
const EMPTY_SALES = { updatedAt: null, summary: { total: 0, hot: 0, medium: 0, customers: 0, draftsPendingApproval: 0 }, entries: [] };
const EMPTY_USAGE = { trackedRuns: 0, month: { estimatedUsd: 0, inputTokens: 0, outputTokens: 0, webSearchRequests: 0 }, total: { estimatedUsd: 0, inputTokens: 0, outputTokens: 0, webSearchRequests: 0 }, averagePublishedUsd: 0 };
const EMPTY_REVENUE = {
  runId: "r1", monthlyCustomerTarget: null,
  snapshot: { visits: 0, trials: 0, activated: 0, customers: 0, hotLeads: 0, pendingSalesApprovals: 0, visitToTrialRate: 0, trialToActivationRate: 0, activationToCustomerRate: 0 },
  decision: { objective: "increase_paying_customers", bottleneck: "none", action: "do_nothing", priority: "low", reason: "", evidence: [], requiresHumanApproval: false },
};

function stubFetch(overrides: Record<string, unknown> = {}) {
  vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/api/workspaces")) return Promise.resolve({ ok: true, json: async () => [{ id: "nextassist", name: "NextAssist" }] });
    if (url.includes("/api/status")) return Promise.resolve({ ok: true, json: async () => (overrides.status ?? { running: false, lastEvents: [], runMode: "local" }) });
    if (url.includes("/api/runs")) return Promise.resolve({ ok: true, json: async () => [] });
    if (url.includes("/api/reels")) return Promise.resolve({ ok: true, json: async () => (overrides.reels ?? EMPTY_REELS) });
    if (url.includes("/api/performance")) return Promise.resolve({ ok: true, json: async () => (overrides.performance ?? EMPTY_PERFORMANCE) });
    if (url.includes("/api/sales")) return Promise.resolve({ ok: true, json: async () => (overrides.sales ?? EMPTY_SALES) });
    if (url.includes("/api/usage")) return Promise.resolve({ ok: true, json: async () => (overrides.usage ?? EMPTY_USAGE) });
    if (url.includes("/api/revenue")) return Promise.resolve({ ok: true, json: async () => (overrides.revenue ?? EMPTY_REVENUE) });
    return Promise.resolve({ ok: true, json: async () => ({}) });
  }));
}

function renderAt(path: string) {
  return render(
    <WorkspaceProvider>
      <ToastProvider>
        <PipelineProvider>
          <MemoryRouter initialEntries={[path]}>
            <Routes><Route path="/agentes/:agentId" element={<AgenteDetailPage />} /></Routes>
          </MemoryRouter>
        </PipelineProvider>
      </ToastProvider>
    </WorkspaceProvider>,
  );
}

describe("AgenteDetailPage", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("mostra as 4 abas e troca de conteúdo ao clicar", async () => {
    vi.stubGlobal("EventSource", FakeEventSource as unknown as typeof EventSource);
    stubFetch();
    renderAt("/agentes/sales");

    expect(await screen.findByRole("tab", { name: "Visão geral" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Detalhes técnicos" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Histórico" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Ações" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("tab", { name: "Histórico" }));
    expect(await screen.findByText("Execuções recentes")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("tab", { name: "Ações" }));
    expect(await screen.findByText(/Sem ações automatizadas/)).toBeInTheDocument();
  });

  it("aceita um dos 8 IDs do pipeline (não só os 5 do Agent Office), mostra o mesmo cabeçalho de status com dados reais", async () => {
    vi.stubGlobal("EventSource", FakeEventSource as unknown as typeof EventSource);
    stubFetch({
      status: { running: false, runMode: "local", lastEvents: [{ agent: "redator", status: "done", message: "Rascunho concluído.", timestamp: "2026-09-15T10:00:00.000Z" }] },
    });
    renderAt("/agentes/redator");

    expect(await screen.findByRole("heading", { name: "Redação" })).toBeInTheDocument();
    expect(await screen.findByText("Rascunho concluído.")).toBeInTheDocument();
    expect(screen.getByText("Concluído")).toBeInTheDocument();
  });

  it("agente social mostra o cabeçalho de status comum + o Reel em destaque, não a tabela genérica de aprovação", async () => {
    vi.stubGlobal("EventSource", FakeEventSource as unknown as typeof EventSource);
    stubFetch({
      reels: {
        updatedAt: null, summary: { total: 1, pendingApproval: 0, approved: 0, published: 0, failed: 0 },
        entries: [{ id: "r1", slug: "r1", title: "Reel de teste", blogUrl: "", caption: "Legenda real", status: "rendering", updatedAt: new Date().toISOString(), audit: [] }],
      },
    });
    renderAt("/agentes/social");

    expect(await screen.findByRole("heading", { name: "Social Agent" })).toBeInTheDocument();
    expect(screen.getByText("Trabalhando")).toBeInTheDocument();
    expect(await screen.findByText("Reel de teste")).toBeInTheDocument();
    expect(screen.getByText("Linha do tempo")).toBeInTheDocument();
  });

  it("agente analytics mostra o cabeçalho de status comum + o painel real de desempenho no Google", async () => {
    vi.stubGlobal("EventSource", FakeEventSource as unknown as typeof EventSource);
    stubFetch({
      performance: { atualizadoEm: "2026-09-14T00:00:00.000Z", periodo: { inicio: "2026-08-01", fim: "2026-09-14" }, posts: [{ slug: "a", titulo: "Post real A", url: "https://x", indexado: true, coverageState: "", clicks: 10, impressions: 500, ctr: 0.02, position: 5 }] },
    });
    renderAt("/agentes/analytics");

    expect(await screen.findByRole("heading", { name: "Analytics Agent" })).toBeInTheDocument();
    expect(screen.getByText("Desempenho no Google")).toBeInTheDocument();
    // O título real aparece tanto no gráfico quanto na tabela — basta confirmar que existe.
    expect((await screen.findAllByText("Post real A")).length).toBeGreaterThan(0);
  });

  it("agente finance mostra o cabeçalho de status comum + o painel real de custo de IA", async () => {
    vi.stubGlobal("EventSource", FakeEventSource as unknown as typeof EventSource);
    stubFetch({ usage: { ...EMPTY_USAGE, trackedRuns: 3, month: { ...EMPTY_USAGE.month, estimatedUsd: 12.5 } } });
    renderAt("/agentes/finance");

    expect(await screen.findByRole("heading", { name: "Finance Agent" })).toBeInTheDocument();
    expect(screen.getByText("Em dia")).toBeInTheDocument();
    expect(await screen.findByText("Consumo de IA")).toBeInTheDocument();
  });
});
