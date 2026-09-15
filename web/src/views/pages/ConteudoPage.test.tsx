import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { WorkspaceProvider } from "../../hooks/useWorkspace";
import { ConteudoPage } from "./ConteudoPage";

const TOPICS = [
  { tema: "Pauta pendente", palavraChaveAlvo: "kw1", publicado: false, priority: "high" },
  { tema: "Pauta publicada", palavraChaveAlvo: "kw2", publicado: true, publicadoEm: "2026-09-10T10:00:00.000Z" },
];

const REELS = {
  updatedAt: "2026-09-12T00:00:00.000Z",
  summary: { total: 1, pendingApproval: 1, approved: 0, published: 0, failed: 0 },
  entries: [
    { id: "r1", slug: "reel-1", title: "Reel de teste", blogUrl: "https://x", caption: "Legenda real do reel", status: "pending_approval", updatedAt: "2026-09-12T14:00:00.000Z", audit: [] },
  ],
};

function stubFetch() {
  vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/api/workspaces")) return Promise.resolve({ ok: true, json: async () => [{ id: "nextassist", name: "NextAssist" }] });
    if (url.includes("/api/content-calendar")) return Promise.resolve({ ok: true, json: async () => TOPICS });
    if (url.includes("/api/reels")) return Promise.resolve({ ok: true, json: async () => REELS });
    return Promise.resolve({ ok: true, json: async () => ({}) });
  }));
}

describe("ConteudoPage", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("mostra o calendário por padrão, com os eventos reais de blog e Reel plotados na data certa", async () => {
    stubFetch();
    render(<WorkspaceProvider><MemoryRouter><ConteudoPage /></MemoryRouter></WorkspaceProvider>);

    expect(await screen.findByText("Pauta publicada")).toBeInTheDocument();
    expect(screen.getByText("Reel de teste")).toBeInTheDocument();
    // A pauta pendente não tem data real — não deve aparecer no calendário.
    expect(screen.queryByText("Pauta pendente")).not.toBeInTheDocument();
  });

  it("aba Ideias lista o backlog pendente", async () => {
    stubFetch();
    render(<WorkspaceProvider><MemoryRouter><ConteudoPage /></MemoryRouter></WorkspaceProvider>);

    await screen.findByText("Pauta publicada");
    await userEvent.click(screen.getByRole("tab", { name: "Ideias" }));

    expect(await screen.findByText("Pauta pendente")).toBeInTheDocument();
    expect(screen.queryByText("Pauta publicada")).not.toBeInTheDocument();
  });

  it("aba Roteiros lista os Reels com a legenda real", async () => {
    stubFetch();
    render(<WorkspaceProvider><MemoryRouter><ConteudoPage /></MemoryRouter></WorkspaceProvider>);

    await screen.findByText("Reel de teste");
    await userEvent.click(screen.getByRole("tab", { name: "Roteiros" }));

    expect(await screen.findByText("Legenda real do reel")).toBeInTheDocument();
  });

  it("aba Biblioteca lista apenas conteúdo publicado", async () => {
    stubFetch();
    render(<WorkspaceProvider><MemoryRouter><ConteudoPage /></MemoryRouter></WorkspaceProvider>);

    await screen.findByText("Pauta publicada");
    await userEvent.click(screen.getByRole("tab", { name: "Biblioteca" }));

    expect(await screen.findByText("Pauta publicada")).toBeInTheDocument();
    // O Reel de teste está "pending_approval", não publicado — não deve aparecer na Biblioteca.
    expect(screen.queryByText("Reel de teste")).not.toBeInTheDocument();
  });
});
