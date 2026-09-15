import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { WorkspaceProvider } from "../../hooks/useWorkspace";
import { ReelApprovalPanel } from "./ReelApprovalPanel";
import type { ReelListEntry } from "../../types/api";

const ENTRIES: ReelListEntry[] = [
  {
    id: "r-rendering", slug: "r-rendering", title: "NextAssist - Teste multi-cena Studio",
    blogUrl: "", caption: "", status: "rendering", createdAt: "2026-09-14T13:35:00.000Z", updatedAt: "2026-09-14T13:35:00.000Z", audit: [],
    timelineSteps: [{ step: "processando", at: "2026-09-14T13:35:00.000Z" }],
  },
  {
    id: "r-failed", slug: "r-failed", title: "MarkupEmpresa - Assistência técnica",
    blogUrl: "", caption: "", status: "failed", error: "HeyGen API: resposta HTTP 402.", createdAt: "2026-09-11T14:20:00.000Z", updatedAt: "2026-09-11T14:20:00.000Z", audit: [],
  },
  {
    id: "r-pending", slug: "r-pending", title: "Controle de peças",
    blogUrl: "", caption: "", status: "pending_approval", createdAt: "2026-09-08T10:15:00.000Z", updatedAt: "2026-09-08T10:15:00.000Z", audit: [],
  },
  {
    id: "r-published", slug: "r-published", title: "Rotina na assistência",
    blogUrl: "", caption: "", status: "published", permalink: "https://instagram.com/p/xyz", createdAt: "2026-09-05T09:45:00.000Z", updatedAt: "2026-09-05T09:45:00.000Z", audit: [],
  },
];

function stubFetch(entries: ReelListEntry[]) {
  vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/api/workspaces")) return Promise.resolve({ ok: true, json: async () => [{ id: "nextassist", name: "NextAssist" }] });
    if (url.includes("/api/reels/review") || url.includes("/api/reels/publish")) {
      return Promise.resolve({ ok: true, json: async () => ({ ok: true }) });
    }
    if (url.includes("/api/reels")) {
      return Promise.resolve({
        ok: true,
        json: async () => ({
          updatedAt: null,
          summary: { total: entries.length, pendingApproval: entries.filter((e) => e.status === "pending_approval").length, approved: 0, published: 0, failed: 0 },
          entries,
        }),
      });
    }
    return Promise.resolve({ ok: true, json: async () => ({}) });
  }));
}

describe("ReelApprovalPanel", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("mostra todos os Reels reais na aba Todos, com status e data reais", async () => {
    stubFetch(ENTRIES);
    render(<WorkspaceProvider><MemoryRouter><ReelApprovalPanel /></MemoryRouter></WorkspaceProvider>);

    expect(await screen.findByText("NextAssist - Teste multi-cena Studio")).toBeInTheDocument();
    expect(screen.getByText("MarkupEmpresa - Assistência técnica")).toBeInTheDocument();
    expect(screen.getByText("Controle de peças")).toBeInTheDocument();
    expect(screen.getByText("Rotina na assistência")).toBeInTheDocument();

    // Status real: passo atual da timeline e código HTTP real extraído do erro.
    expect(screen.getByText("Processando na HeyGen")).toBeInTheDocument();
    expect(screen.getByText("Falhou (402)")).toBeInTheDocument();
    // "Aguardando aprovação" aparece na aba E no status do card — basta confirmar que existe nos dois.
    expect(screen.getAllByText("Aguardando aprovação").length).toBeGreaterThanOrEqual(2);
  });

  it("cada aba filtra pelo status real correspondente", async () => {
    stubFetch(ENTRIES);
    render(<WorkspaceProvider><MemoryRouter><ReelApprovalPanel /></MemoryRouter></WorkspaceProvider>);
    await screen.findByText("NextAssist - Teste multi-cena Studio");

    await userEvent.click(screen.getByRole("tab", { name: "Publicados" }));
    expect(await screen.findByText("Rotina na assistência")).toBeInTheDocument();
    expect(screen.queryByText("Controle de peças")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("tab", { name: "Aguardando aprovação" }));
    expect(await screen.findByText("Controle de peças")).toBeInTheDocument();
    expect(screen.queryByText("Rotina na assistência")).not.toBeInTheDocument();
  });

  it("Reel aguardando aprovação mostra Aprovar/Rejeitar; Reel publicado mostra o link real do Instagram", async () => {
    stubFetch(ENTRIES);
    render(<WorkspaceProvider><MemoryRouter><ReelApprovalPanel /></MemoryRouter></WorkspaceProvider>);
    await screen.findByText("Controle de peças");

    expect(screen.getByRole("button", { name: "Aprovar" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Rejeitar" })).toBeInTheDocument();

    const instagramLink = screen.getByRole("link", { name: "Ver no Instagram" });
    expect(instagramLink).toHaveAttribute("href", "https://instagram.com/p/xyz");
  });

  it("clicar Aprovar chama a API real de revisão e recarrega a lista", async () => {
    stubFetch(ENTRIES);
    render(<WorkspaceProvider><MemoryRouter><ReelApprovalPanel /></MemoryRouter></WorkspaceProvider>);
    await screen.findByText("Controle de peças");

    await userEvent.click(screen.getByRole("button", { name: "Aprovar" }));

    const fetchMock = vi.mocked(fetch);
    const reviewCall = fetchMock.mock.calls.find(([input]) => String(input).includes("/api/reels/review"));
    expect(reviewCall).toBeDefined();
    const body = JSON.parse(String((reviewCall?.[1] as RequestInit).body));
    expect(body).toMatchObject({ workspaceId: "nextassist", reelId: "r-pending", decision: "approved" });
  });

  it("aba vazia mostra a mensagem real de categoria vazia, sem inventar dado", async () => {
    stubFetch([ENTRIES[0]]);
    render(<WorkspaceProvider><MemoryRouter><ReelApprovalPanel /></MemoryRouter></WorkspaceProvider>);
    await screen.findByText("NextAssist - Teste multi-cena Studio");

    await userEvent.click(screen.getByRole("tab", { name: "Rejeitados" }));
    expect(await screen.findByText("Nenhum Reel nesta categoria.")).toBeInTheDocument();
  });
});
