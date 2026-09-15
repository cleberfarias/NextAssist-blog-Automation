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
      if (url.includes("/api/workspaces")) {
        return Promise.resolve({ ok: true, json: async () => [{ id: "nextassist", name: "NextAssist" }] });
      }
      if (url.includes("/api/status")) {
        return Promise.resolve({ ok: true, json: async () => ({ running: false, lastEvents: [], runMode: "local" }) });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    }));

    render(<App />);

    const items = ["Dashboard", "Agentes (IA)", "Conteúdo", "Reels", "Blog", "Leads", "Clientes", "Relatórios", "Configurações"];
    for (const label of items) {
      expect(await screen.findByRole("link", { name: label })).toBeInTheDocument();
    }

    await userEvent.click(screen.getByRole("link", { name: "Reels" }));
    expect(await screen.findByTestId("page-reels")).toBeInTheDocument();
  });
});
