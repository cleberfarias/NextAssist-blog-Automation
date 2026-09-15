import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { WorkspaceProvider } from "../../hooks/useWorkspace";
import { ToastProvider } from "../../components/ui/Toast";
import { PerformancePanel } from "./PerformancePanel";

describe("PerformancePanel", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("quando nenhum relatório foi gerado ainda (backend retorna null), mostra o estado vazio sem lançar erro nem toast", async () => {
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/workspaces")) return Promise.resolve({ ok: true, json: async () => [{ id: "nextassist", name: "NextAssist" }] });
      if (url.includes("/api/performance")) return Promise.resolve({ ok: true, json: async () => null });
      return Promise.resolve({ ok: true, json: async () => ({}) });
    }));

    render(<WorkspaceProvider><ToastProvider><PerformancePanel /></ToastProvider></WorkspaceProvider>);

    expect(await screen.findByText("Nunca atualizado")).toBeInTheDocument();
    expect(screen.getByText(/Sem dados ainda\. Clique em/)).toBeInTheDocument();

    // Dá tempo para uma eventual promise rejeitada (o bug) se propagar até o toast.
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(screen.queryByText(/Cannot read properties/)).not.toBeInTheDocument();
  });
});
