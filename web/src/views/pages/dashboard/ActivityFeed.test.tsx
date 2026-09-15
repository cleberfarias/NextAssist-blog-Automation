import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { WorkspaceProvider } from "../../../hooks/useWorkspace";
import { PipelineProvider } from "../../../hooks/usePipeline";
import { ToastProvider } from "../../../components/ui/Toast";
import { ActivityFeed } from "./ActivityFeed";

class FakeEventSource {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(_url: string) {}
  close() {}
}

describe("ActivityFeed", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("mescla eventos do pipeline com traces do harness, mais recente primeiro", async () => {
    vi.stubGlobal("EventSource", FakeEventSource as unknown as typeof EventSource);
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/workspaces")) return Promise.resolve({ ok: true, json: async () => [{ id: "nextassist", name: "NextAssist" }] });
      if (url.includes("/api/status")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ running: false, runMode: "local", lastEvents: [{ agent: "redator", status: "done", message: "Rascunho concluído.", timestamp: "2026-09-15T10:00:00.000Z" }] }),
        });
      }
      if (url.includes("/api/runs")) return Promise.resolve({ ok: true, json: async () => [] });
      if (url.includes("/api/harness/traces")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            updatedAt: "2026-09-15T11:00:00.000Z",
            traces: [{ runId: "r1", workspaceId: "nextassist", agent: "revenue-director", goal: "identify_revenue_bottleneck_and_choose_next_action", startedAt: "2026-09-15T11:00:00.000Z", finishedAt: "2026-09-15T11:00:01.000Z", status: "completed", steps: [], costUsd: 0 }],
          }),
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    }));

    render(
      <WorkspaceProvider>
        <ToastProvider>
          <PipelineProvider><ActivityFeed /></PipelineProvider>
        </ToastProvider>
      </WorkspaceProvider>,
    );

    const items = await screen.findAllByRole("listitem");
    expect(items.length).toBe(2);
    expect(items[0]).toHaveTextContent("Revenue Director");
    expect(items[0]).toHaveTextContent("Execução concluída — identify revenue bottleneck and choose next action.");
    expect(items[1]).toHaveTextContent("Redação");
    expect(items[1]).toHaveTextContent("Rascunho concluído.");
  });
});
