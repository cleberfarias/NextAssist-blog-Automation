import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { WorkspaceProvider } from "../../hooks/useWorkspace";
import { ReelDetailPage } from "./ReelDetailPage";

const DETAIL = {
  id: "nextassist:teste", slug: "teste", title: "NextAssist - Teste multi-cena Studio",
  blogUrl: "https://x.test/teste", caption: "Legenda", status: "rendering",
  updatedAt: "2026-09-15T00:00:00.000Z", audit: [],
  scenes: [
    { type: "avatar_video", label: "Abertura (avatar)" },
    { type: "video", label: "Fechamento de OS", assetId: "8d08e75c81d34ea3b066d2db18ed72c5" },
  ],
  timelineSteps: [
    { step: "roteiro_gerado", at: "2026-09-15T00:00:00.000Z" },
    { step: "cenas_montadas", at: "2026-09-15T00:00:01.000Z" },
    { step: "enviado_heygen", at: "2026-09-15T00:00:02.000Z" },
  ],
};

describe("ReelDetailPage", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("mostra a timeline e a galeria de B-roll do Reel", async () => {
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/workspaces")) return Promise.resolve({ ok: true, json: async () => [{ id: "nextassist", name: "NextAssist" }] });
      if (url.includes("/api/reels/")) return Promise.resolve({ ok: true, json: async () => DETAIL });
      return Promise.resolve({ ok: true, json: async () => ({}) });
    }));

    render(
      <WorkspaceProvider>
        <MemoryRouter initialEntries={["/reels/nextassist:teste"]}>
          <Routes><Route path="/reels/:id" element={<ReelDetailPage />} /></Routes>
        </MemoryRouter>
      </WorkspaceProvider>,
    );

    expect(await screen.findByText("NextAssist - Teste multi-cena Studio")).toBeInTheDocument();
    expect(screen.getByText("Roteiro gerado pela IA")).toBeInTheDocument();
    expect(screen.getByText("Cenas montadas (Studio)")).toBeInTheDocument();
    expect(screen.getByText("Enviado para HeyGen")).toBeInTheDocument();
    expect(screen.getByText("Fechamento de OS")).toBeInTheDocument();
  });
});
