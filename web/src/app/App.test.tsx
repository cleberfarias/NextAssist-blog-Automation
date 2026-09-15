import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "./App";

class FakeEventSource {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(_url: string) {}
  close() {}
}

describe("App shell", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("renders all 9 sidebar items and navigates between routes", async () => {
    vi.stubGlobal("EventSource", FakeEventSource as unknown as typeof EventSource);
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/workspaces")) return Promise.resolve({ ok: true, json: async () => [{ id: "nextassist", name: "NextAssist" }] });
      if (url.includes("/api/status")) return Promise.resolve({ ok: true, json: async () => ({ running: false, lastEvents: [], runMode: "local" }) });
      if (url.includes("/api/history")) return Promise.resolve({ ok: true, json: async () => [] });
      if (url.includes("/api/sales")) return Promise.resolve({ ok: true, json: async () => ({ updatedAt: null, summary: { total: 0, hot: 0, medium: 0, customers: 0, draftsPendingApproval: 0 }, entries: [] }) });
      if (url.includes("/api/reels")) return Promise.resolve({ ok: true, json: async () => ({ updatedAt: null, summary: { total: 0, pendingApproval: 0, approved: 0, published: 0, failed: 0 }, entries: [] }) });
      return Promise.resolve({ ok: true, json: async () => ({}) });
    }));

    render(<App />);

    const items = ["Dashboard", "Agentes (IA)", "Conteúdo", "Reels", "Blog", "Leads", "Clientes", "Relatórios", "Configurações"];
    for (const label of items) {
      expect(await screen.findByRole("link", { name: label })).toBeInTheDocument();
    }

    await userEvent.click(screen.getByRole("link", { name: "Reels" }));
    expect(await screen.findByText("Reels para aprovação")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("link", { name: "Blog" }));
    expect(await screen.findByText("Nenhum post publicado ainda.")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("link", { name: "Leads" }));
    expect(await screen.findByText("Sales Agent")).toBeInTheDocument();
  });
});
