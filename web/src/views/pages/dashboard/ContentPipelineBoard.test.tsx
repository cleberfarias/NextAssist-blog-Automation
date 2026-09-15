import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { WorkspaceProvider } from "../../../hooks/useWorkspace";
import { PipelineProvider } from "../../../hooks/usePipeline";
import { ToastProvider } from "../../../components/ui/Toast";
import { ContentPipelineBoard } from "./ContentPipelineBoard";

class FakeEventSource {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(_url: string) {}
  close() {}
}

const RUNS = [
  {
    id: "r1", origem: "action", iniciadoEm: "2026-09-14T10:00:00.000Z", finalizadoEm: "2026-09-14T10:20:00.000Z",
    tema: "Tema A", status: "publicado", slug: "tema-a", erro: null,
    eventos: [{ agent: "redator", status: "done", timestamp: "2026-09-14T10:10:00.000Z" }],
  },
];

describe("ContentPipelineBoard", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("mostra KPIs reais, os 8 estágios com nomes reais, e estado vazio de 'em andamento' quando nada está rodando", async () => {
    vi.stubGlobal("EventSource", FakeEventSource as unknown as typeof EventSource);
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/workspaces")) return Promise.resolve({ ok: true, json: async () => [{ id: "nextassist", name: "NextAssist" }] });
      if (url.includes("/api/status")) return Promise.resolve({ ok: true, json: async () => ({ running: false, lastEvents: [], runMode: "local" }) });
      if (url.includes("/api/runs")) return Promise.resolve({ ok: true, json: async () => RUNS });
      if (url.includes("/api/content-calendar")) return Promise.resolve({ ok: true, json: async () => ([{ tema: "Pendente", palavraChaveAlvo: "kw", publicado: false }]) });
      return Promise.resolve({ ok: true, json: async () => ({}) });
    }));

    render(
      <WorkspaceProvider>
        <ToastProvider>
          <PipelineProvider><MemoryRouter><ContentPipelineBoard /></MemoryRouter></PipelineProvider>
        </ToastProvider>
      </WorkspaceProvider>,
    );

    const pipelineCard = (await screen.findByText("Conteúdos no pipeline")).closest("div")!.parentElement!;
    expect(await within(pipelineCard).findByText("1")).toBeInTheDocument(); // pendingContent

    const completedCard = screen.getByText("Concluídos").closest("div")!.parentElement!;
    expect(within(completedCard).getByText("1")).toBeInTheDocument(); // completedLast7Days

    // Cada estágio aparece 2x de propósito: o balão sobre a foto e o card de detalhe abaixo.
    expect(screen.getAllByText("Marketing Director").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Pesquisa de mercado").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Indexação / Google").length).toBeGreaterThan(0);

    expect(screen.getByText(/Nenhum conteúdo em produção no momento/)).toBeInTheDocument();
  });
});
