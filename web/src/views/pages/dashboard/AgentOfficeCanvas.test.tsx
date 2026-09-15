import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { WorkspaceProvider } from "../../../hooks/useWorkspace";
import { AgentOfficeCanvas } from "./AgentOfficeCanvas";

describe("AgentOfficeCanvas", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("renderiza os 5 badges de agente, cada um linkando pro drill-down correspondente", async () => {
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/workspaces")) return Promise.resolve({ ok: true, json: async () => [{ id: "nextassist", name: "NextAssist" }] });
      return Promise.resolve({ ok: true, json: async () => ({}) });
    }));

    render(<WorkspaceProvider><MemoryRouter><AgentOfficeCanvas /></MemoryRouter></WorkspaceProvider>);

    expect(await screen.findByText("Social Agent")).toBeInTheDocument();
    expect(screen.getByText("Analytics Agent")).toBeInTheDocument();
    expect(screen.getByText("Sales Agent")).toBeInTheDocument();
    expect(screen.getByText("Finance Agent")).toBeInTheDocument();
    expect(screen.getByText("Revenue Director")).toBeInTheDocument();

    expect(screen.getByText("Social Agent").closest("a")).toHaveAttribute("href", "/agentes/social");
    expect(screen.getByText("Revenue Director").closest("a")).toHaveAttribute("href", "/agentes/revenue");
  });
});
