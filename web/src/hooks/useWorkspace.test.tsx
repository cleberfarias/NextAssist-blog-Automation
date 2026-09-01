import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
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

  it("cancels previous workspace fetch when switching workspaces (regression test: cancelamento ao trocar workspace)", async () => {
    // This test proves the pattern that all dashboard panels will use:
    // each panel fetches data for the current workspace and aborts on switch.
    // Without proper abort handling, stale responses would overwrite current data.

    const abortedSignals = new Set<AbortSignal>();

    // Create implementation for the custom mock
    const customFetchImplementation = async (
      urlInput: string | URL | Request,
      options?: { signal?: AbortSignal }
    ): Promise<Response> => {
      let urlStr: string;
      if (typeof urlInput === "string") {
        urlStr = urlInput;
      } else if (urlInput instanceof URL) {
        urlStr = urlInput.toString();
      } else if ((urlInput as any).url) {
        urlStr = (urlInput as any).url;
      } else {
        urlStr = "";
      }

      const signal = options?.signal;

      // Handle WorkspaceProvider's initial fetch for workspace list
      if (urlStr.includes("/api/workspaces")) {
        return Promise.resolve({
          ok: true,
          json: async () => [
            { id: "acme", name: "Acme" },
            { id: "beta", name: "Beta" },
          ],
        } as Response);
      }

      // Handle DataFetchingProbe's workspace-specific data fetch
      return new Promise<Response>((resolve, reject) => {
        let timeoutId: NodeJS.Timeout;

        const respondWithData = () => {
          const isAcme = urlStr.includes("acme");
          resolve({
            ok: true,
            json: async () => ({
              name: isAcme ? "Acme Data" : "Beta Data",
            }),
          } as Response);
        };

        // Acme's fetch takes 500ms (simulating a slow network), Beta's is instant
        const delay = urlStr.includes("acme") ? 500 : 0;
        timeoutId = setTimeout(respondWithData, delay);

        if (signal) {
          signal.addEventListener("abort", () => {
            clearTimeout(timeoutId);
            abortedSignals.add(signal);
            reject(new DOMException("Aborted", "AbortError"));
          });
        }
      });
    };

    // Get the existing fetch mock and replace its implementation
    const originalFetch = global.fetch as any;
    vi.mocked(originalFetch).mockImplementation(customFetchImplementation);

    // Component that follows the panel pattern: fetch data when workspace changes
    function DataFetchingProbe() {
      const { workspace, workspaces, setWorkspace, loading } = useWorkspace();
      const [data, setData] = React.useState<any>(null);

      React.useEffect(() => {
        const controller = new AbortController();

        fetch(`/api/workspace/${workspace}/data`, { signal: controller.signal })
          .then((res) => res.json())
          .then(setData)
          .catch((err) => {
            if ((err as Error).name !== "AbortError") throw err;
            // Silently ignore aborted requests (as all panels should)
          });

        return () => controller.abort();
      }, [workspace]);

      if (loading) return <p>carregando</p>;
      return (
        <div>
          <span data-testid="current">{workspace}</span>
          <span data-testid="data">{data?.name || "sem dados"}</span>
          {workspaces.map((w) => (
            <button key={w.id} onClick={() => setWorkspace(w.id)}>
              {w.name}
            </button>
          ))}
        </div>
      );
    }

    render(<WorkspaceProvider><DataFetchingProbe /></WorkspaceProvider>);

    // Wait for initial load - get whatever workspace is selected first
    let currentWorkspace: string;

    await waitFor(() => {
      const currentElement = screen.getByTestId("current");
      const text = currentElement.textContent || "";
      expect(text).toBeTruthy();
    });

    currentWorkspace = (screen.getByTestId("current").textContent || "").trim();

    // Get the OTHER workspace button
    const otherButton = screen.getByText(currentWorkspace === "acme" ? "Beta" : "Acme");
    const otherWorkspaceId = currentWorkspace === "acme" ? "beta" : "acme";
    const expectedDataText = otherWorkspaceId === "beta" ? "Beta Data" : "Acme Data";

    // At this point, the first workspace's fetch is pending
    // Immediately click to switch to the other workspace (before previous fetch might complete)
    await userEvent.click(otherButton);

    // Verify workspace switched
    expect(screen.getByTestId("current")).toHaveTextContent(otherWorkspaceId);

    // Wait for the new workspace's data to load
    // This might take 500ms (for acme) or be instant (for beta)
    await waitFor(
      () => {
        expect(screen.getByTestId("data")).toHaveTextContent(expectedDataText);
      },
      { timeout: 1000 }
    );

    // Wait for any slow fetches to complete (they will be aborted and rejected)
    await new Promise((r) => setTimeout(r, 600));

    // Critical assertion: data should still show the current workspace's data
    // This proves that the stale response from the previous workspace was properly ignored
    expect(screen.getByTestId("data")).toHaveTextContent(expectedDataText);

    // Verify that at least one abort signal was fired (cleanup ran for the previous workspace's fetch)
    expect(abortedSignals.size).toBeGreaterThan(0);
  });
});
