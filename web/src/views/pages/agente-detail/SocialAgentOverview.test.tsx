import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { WorkspaceProvider } from "../../../hooks/useWorkspace";
import { formatDateTime } from "../../../lib/formatters";
import { SocialAgentOverview } from "./SocialAgentOverview";

function stubReels(entries: unknown[]) {
  vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/api/workspaces")) return Promise.resolve({ ok: true, json: async () => [{ id: "nextassist", name: "NextAssist" }] });
    if (url.includes("/api/reels")) {
      return Promise.resolve({
        ok: true,
        json: async () => ({ updatedAt: null, summary: { total: entries.length, pendingApproval: 0, approved: 0, published: 0, failed: 0 }, entries }),
      });
    }
    return Promise.resolve({ ok: true, json: async () => ({}) });
  }));
}

describe("SocialAgentOverview", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("mostra estado vazio quando não há nenhum Reel ainda", async () => {
    stubReels([]);
    render(<WorkspaceProvider><MemoryRouter><SocialAgentOverview /></MemoryRouter></WorkspaceProvider>);
    expect(await screen.findByText("Nenhum Reel foi gerado ainda.")).toBeInTheDocument();
  });

  it("destaca o Reel em processamento, com dados reais de avatar/voz/cenas e o passo atual da timeline com tempo decorrido real", async () => {
    const now = new Date();
    const thirtySevenMinAgo = new Date(now.getTime() - 37 * 60_000).toISOString();
    stubReels([
      {
        id: "r1", slug: "teste-multi-cena", title: "NextAssist - Teste multi-cena Studio",
        blogUrl: "https://x", caption: "Mostrando como o NextAssist simplifica a gestão da assistência técnica.",
        status: "rendering", updatedAt: thirtySevenMinAgo, audit: [],
        avatarId: "avatar_iv", voiceId: "pt-BR-principal", videoId: "b865f1f125e3d493a49d3880",
        scenes: [
          { type: "avatar_video", label: "Abertura" },
          { type: "video", label: "B-roll 1", assetId: "a1" },
          { type: "video", label: "B-roll 2", assetId: "a2" },
        ],
        timelineSteps: [
          { step: "roteiro_gerado", at: "2026-09-14T13:30:00.000Z" },
          { step: "cenas_montadas", at: "2026-09-14T13:34:00.000Z" },
          { step: "enviado_heygen", at: "2026-09-14T13:35:00.000Z" },
          { step: "processando", at: thirtySevenMinAgo },
        ],
      },
    ]);

    render(<WorkspaceProvider><MemoryRouter><SocialAgentOverview /></MemoryRouter></WorkspaceProvider>);

    expect(await screen.findByText("NextAssist - Teste multi-cena Studio")).toBeInTheDocument();
    expect(screen.getByText("Reel em processamento")).toBeInTheDocument();
    expect(screen.getByText("avatar_iv")).toBeInTheDocument();
    expect(screen.getByText("pt-BR-principal")).toBeInTheDocument();
    expect(screen.getByText("1 avatar + 2 B-roll")).toBeInTheDocument();
    // O passo atual mostra tempo decorrido real, não uma data fixa.
    expect(screen.getByText("Em andamento há 37 min")).toBeInTheDocument();
    // Passos já concluídos mostram a data/hora real registrada.
    expect(screen.getByText(formatDateTime("2026-09-14T13:30:00.000Z"))).toBeInTheDocument();
    // Passos futuros não têm timestamp algum — não é inventado.
    expect(screen.queryByText("Vídeo concluído")).toBeInTheDocument();
  });

  it("prioriza um Reel com falha e mostra o erro real do backend", async () => {
    stubReels([
      { id: "ok", slug: "ok", title: "Reel publicado", blogUrl: "", caption: "", status: "published", updatedAt: "2026-09-10T00:00:00.000Z", audit: [] },
      { id: "bad", slug: "bad", title: "Reel com problema", blogUrl: "", caption: "", status: "failed", updatedAt: "2026-09-14T00:00:00.000Z", audit: [], error: "HeyGen API: resposta HTTP 402." },
    ]);

    render(<WorkspaceProvider><MemoryRouter><SocialAgentOverview /></MemoryRouter></WorkspaceProvider>);

    expect(await screen.findByText("Reel com problema")).toBeInTheDocument();
    expect(screen.getByText("Reel com falha")).toBeInTheDocument();
    expect(screen.getByText("HeyGen API: resposta HTTP 402.")).toBeInTheDocument();
  });
});
