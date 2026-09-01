import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WorkspaceProvider, useWorkspace } from "./useWorkspace";
import { ToastProvider } from "../components/ui/Toast";
import { PipelineProvider, usePipeline } from "./usePipeline";

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  url: string;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }
  close() {
    this.closed = true;
  }
}

function Probe() {
  const { running, runMode, runBlog } = usePipeline();
  return (
    <div>
      <span data-testid="running">{String(running)}</span>
      <span data-testid="mode">{runMode}</span>
      <button onClick={() => void runBlog()}>rodar</button>
    </div>
  );
}

// Probe used only by the SSE-reconnect test: exposes workspace-switching buttons
// (same pattern useWorkspace.test.tsx uses) alongside usePipeline state, so we can
// trigger a real workspace change within a single continuous mount.
function SwitchableProbe() {
  const { workspaces, setWorkspace } = useWorkspace();
  const { running, runMode } = usePipeline();
  return (
    <div>
      <span data-testid="running">{String(running)}</span>
      <span data-testid="mode">{runMode}</span>
      {workspaces.map((w) => (
        <button key={w.id} onClick={() => setWorkspace(w.id)}>{w.name}</button>
      ))}
    </div>
  );
}

describe("usePipeline", () => {
  beforeEach(() => {
    localStorage.clear();
    window.history.replaceState({}, "", "/");
    FakeEventSource.instances = [];
    vi.stubGlobal("EventSource", FakeEventSource as unknown as typeof EventSource);
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/api/workspaces")) {
          return Promise.resolve({
            ok: true,
            json: async () => [
              { id: "acme", name: "Acme" },
              { id: "beta", name: "Beta" },
            ],
          });
        }
        if (url.includes("/api/status")) {
          return Promise.resolve({ ok: true, json: async () => ({ running: false, lastEvents: [], runMode: "local" }) });
        }
        if (url.includes("/api/run")) {
          return Promise.resolve({ ok: true, json: async () => ({ ok: true, mode: "local" }) });
        }
        return Promise.resolve({ ok: true, json: async () => ({}) });
      }),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("opens an EventSource scoped to the selected workspace", async () => {
    render(
      <WorkspaceProvider>
        <ToastProvider>
          <PipelineProvider><Probe /></PipelineProvider>
        </ToastProvider>
      </WorkspaceProvider>,
    );

    await waitFor(() => expect(FakeEventSource.instances.length).toBe(1));
    expect(FakeEventSource.instances[0].url).toContain("workspace=acme");
  });

  it("closes the previous EventSource and opens a new one when workspace changes", async () => {
    render(
      <WorkspaceProvider>
        <ToastProvider>
          <PipelineProvider><SwitchableProbe /></PipelineProvider>
        </ToastProvider>
      </WorkspaceProvider>,
    );

    // Initial connection, scoped to the default workspace (acme).
    await waitFor(() => expect(FakeEventSource.instances.length).toBe(1));
    const first = FakeEventSource.instances[0];
    expect(first.url).toContain("workspace=acme");

    // onerror must not be treated as a manual close of the connection.
    act(() => { first.onerror?.(); });
    expect(first.closed).toBe(false);

    // Trigger a real workspace switch within the same mount (no remount),
    // driven the same way useWorkspace.test.tsx exercises setWorkspace.
    await userEvent.click(screen.getByText("Beta"));

    // The old EventSource for "acme" must be closed...
    await waitFor(() => expect(first.closed).toBe(true));

    // ...and a new one opened scoped to "beta".
    await waitFor(() => expect(FakeEventSource.instances.length).toBe(2));
    expect(FakeEventSource.instances[1].url).toContain("workspace=beta");
    expect(FakeEventSource.instances[1].closed).toBe(false);
  });

  it("runBlog POSTs to /api/run with the current workspaceId", async () => {
    render(
      <WorkspaceProvider>
        <ToastProvider>
          <PipelineProvider><Probe /></PipelineProvider>
        </ToastProvider>
      </WorkspaceProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("mode")).toHaveTextContent("local"));

    await userEvent.click(screen.getByText("rodar"));

    const mockFetch = fetch as unknown as ReturnType<typeof vi.fn>;
    const runCall = mockFetch.mock.calls.find(([input]) => String(input).includes("/api/run"));
    expect(runCall).toBeDefined();
    expect(JSON.parse((runCall![1] as RequestInit).body as string)).toEqual({ workspaceId: "acme" });
  });
});
