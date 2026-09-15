import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { WorkspaceProvider } from "../../hooks/useWorkspace";
import { ConteudoPage } from "./ConteudoPage";

describe("ConteudoPage", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("lista tópicos pendentes e publicados", async () => {
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/workspaces")) return Promise.resolve({ ok: true, json: async () => [{ id: "nextassist", name: "NextAssist" }] });
      if (url.includes("/api/content-calendar")) {
        return Promise.resolve({ ok: true, json: async () => ([
          { tema: "Pauta pendente", palavraChaveAlvo: "kw1", publicado: false, priority: "high" },
          { tema: "Pauta publicada", palavraChaveAlvo: "kw2", publicado: true, publicadoEm: "2026-09-10T00:00:00.000Z" },
        ]) });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    }));

    render(<WorkspaceProvider><ConteudoPage /></WorkspaceProvider>);

    expect(await screen.findByText("Pauta pendente")).toBeInTheDocument();
    expect(screen.getByText("Pauta publicada")).toBeInTheDocument();
  });
});
