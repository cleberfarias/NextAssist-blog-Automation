import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { WorkspaceProvider } from "../../hooks/useWorkspace";
import { PipelineProvider } from "../../hooks/usePipeline";
import { ToastProvider } from "../../components/ui/Toast";
import { UsagePanel } from "./UsagePanel";

class FakeEventSource {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(_url: string) {}
  close() {}
}

describe("UsagePanel", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("renders formatted KPIs from the usage report", async () => {
    vi.stubGlobal("EventSource", FakeEventSource as unknown as typeof EventSource);
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/workspaces")) {
        return Promise.resolve({ ok: true, json: async () => [{ id: "acme", name: "Acme" }] });
      }
      if (url.includes("/api/usage")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            trackedRuns: 3,
            month: { estimatedUsd: 12.5, inputTokens: 10000, outputTokens: 4000, webSearchRequests: 7 },
            total: { estimatedUsd: 40.2, inputTokens: 30000, outputTokens: 12000, webSearchRequests: 20 },
            averagePublishedUsd: 4.1,
          }),
        });
      }
      if (url.includes("/api/status")) {
        return Promise.resolve({ ok: true, json: async () => ({ running: false, lastEvents: [], runMode: "local" }) });
      }
      if (url.includes("/api/runs")) {
        return Promise.resolve({ ok: true, json: async () => [] });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    }));

    render(
      <WorkspaceProvider>
        <ToastProvider>
          <PipelineProvider><UsagePanel /></PipelineProvider>
        </ToastProvider>
      </WorkspaceProvider>,
    );

    await waitFor(() => expect(screen.getByText(/US\$\s*12,50/)).toBeInTheDocument());
    expect(screen.getByText("10.000")).toBeInTheDocument();
    expect(screen.getByText(/3 execução/)).toBeInTheDocument();
  });
});
