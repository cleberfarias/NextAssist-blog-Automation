import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WorkspaceProvider, useWorkspace } from "./useWorkspace";

function Probe() {
  const { workspace, workspaces, setWorkspace, loading } = useWorkspace();
  if (loading) return <p>carregando</p>;
  return (
    <div>
      <span data-testid="current">{workspace}</span>
      {workspaces.map((w) => (
        <button key={w.id} onClick={() => setWorkspace(w.id)}>{w.name}</button>
      ))}
    </div>
  );
}

describe("WorkspaceProvider", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [{ id: "acme", name: "Acme" }, { id: "beta", name: "Beta" }],
    }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("loads the workspace list and selects the first one by default", async () => {
    render(<WorkspaceProvider><Probe /></WorkspaceProvider>);
    await waitFor(() => expect(screen.getByTestId("current")).toHaveTextContent("acme"));
  });

  it("switching workspace updates the selection without reloading the page", async () => {
    render(<WorkspaceProvider><Probe /></WorkspaceProvider>);
    await waitFor(() => expect(screen.getByTestId("current")).toHaveTextContent("acme"));

    await userEvent.click(screen.getByText("Beta"));

    expect(screen.getByTestId("current")).toHaveTextContent("beta");
    expect(localStorage.getItem("office.workspaceId")).toBe("beta");
  });
});
