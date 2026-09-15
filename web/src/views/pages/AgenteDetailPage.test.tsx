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

describe("AgenteDetailPage", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("mostra as 4 abas e troca de conteúdo ao clicar", async () => {
    vi.stubGlobal("EventSource", FakeEventSource as unknown as typeof EventSource);
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/workspaces")) return Promise.resolve({ ok: true, json: async () => [{ id: "nextassist", name: "NextAssist" }] });
      if (url.includes("/api/status")) return Promise.resolve({ ok: true, json: async () => ({ running: false, lastEvents: [], runMode: "local" }) });
      if (url.includes("/api/sales")) return Promise.resolve({ ok: true, json: async () => ({ updatedAt: null, summary: { total: 0, hot: 0, medium: 0, customers: 0, draftsPendingApproval: 0 }, entries: [] }) });
      if (url.includes("/api/runs")) return Promise.resolve({ ok: true, json: async () => [] });
      return Promise.resolve({ ok: true, json: async () => ({}) });
    }));

    render(
      <WorkspaceProvider>
        <ToastProvider>
          <PipelineProvider>
            <MemoryRouter initialEntries={["/agentes/sales"]}>
              <Routes><Route path="/agentes/:agentId" element={<AgenteDetailPage />} /></Routes>
            </MemoryRouter>
          </PipelineProvider>
        </ToastProvider>
      </WorkspaceProvider>,
    );

    expect(await screen.findByRole("tab", { name: "Visão geral" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Detalhes técnicos" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Histórico" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Ações" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("tab", { name: "Histórico" }));
    expect(await screen.findByText("Execuções recentes")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("tab", { name: "Ações" }));
    expect(await screen.findByText(/Sem ações automatizadas/)).toBeInTheDocument();
  });

  it("aceita um dos 8 IDs do pipeline (não só os 5 do Agent Office) e mostra status real", async () => {
    vi.stubGlobal("EventSource", FakeEventSource as unknown as typeof EventSource);
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/workspaces")) return Promise.resolve({ ok: true, json: async () => [{ id: "nextassist", name: "NextAssist" }] });
      if (url.includes("/api/status")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ running: false, runMode: "local", lastEvents: [{ agent: "redator", status: "done", message: "Rascunho concluído.", timestamp: "2026-09-15T10:00:00.000Z" }] }),
        });
      }
      if (url.includes("/api/runs")) return Promise.resolve({ ok: true, json: async () => [] });
      return Promise.resolve({ ok: true, json: async () => ({}) });
    }));

    render(
      <WorkspaceProvider>
        <ToastProvider>
          <PipelineProvider>
            <MemoryRouter initialEntries={["/agentes/redator"]}>
              <Routes><Route path="/agentes/:agentId" element={<AgenteDetailPage />} /></Routes>
            </MemoryRouter>
          </PipelineProvider>
        </ToastProvider>
      </WorkspaceProvider>,
    );

    expect(await screen.findByRole("heading", { name: "Redação" })).toBeInTheDocument();
    expect(await screen.findByText("Rascunho concluído.")).toBeInTheDocument();
  });

  it("agente social mostra o Reel em destaque com dados reais, não a tabela genérica de aprovação", async () => {
    vi.stubGlobal("EventSource", FakeEventSource as unknown as typeof EventSource);
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/workspaces")) return Promise.resolve({ ok: true, json: async () => [{ id: "nextassist", name: "NextAssist" }] });
      if (url.includes("/api/status")) return Promise.resolve({ ok: true, json: async () => ({ running: false, lastEvents: [], runMode: "local" }) });
      if (url.includes("/api/reels")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            updatedAt: null, summary: { total: 1, pendingApproval: 0, approved: 0, published: 0, failed: 0 },
            entries: [{ id: "r1", slug: "r1", title: "Reel de teste", blogUrl: "", caption: "Legenda real", status: "rendering", updatedAt: new Date().toISOString(), audit: [] }],
          }),
        });
      }
      if (url.includes("/api/runs")) return Promise.resolve({ ok: true, json: async () => [] });
      return Promise.resolve({ ok: true, json: async () => ({}) });
    }));

    render(
      <WorkspaceProvider>
        <ToastProvider>
          <PipelineProvider>
            <MemoryRouter initialEntries={["/agentes/social"]}>
              <Routes><Route path="/agentes/:agentId" element={<AgenteDetailPage />} /></Routes>
            </MemoryRouter>
          </PipelineProvider>
        </ToastProvider>
      </WorkspaceProvider>,
    );

    expect(await screen.findByRole("heading", { name: "Social Agent" })).toBeInTheDocument();
    expect(await screen.findByText("Reel de teste")).toBeInTheDocument();
    expect(screen.getByText("Linha do tempo")).toBeInTheDocument();
  });
});
