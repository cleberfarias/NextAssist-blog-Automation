import { readFile, writeFile } from "node:fs/promises";
import { config } from "../config.js";
import type { WorkspaceContext } from "../context.js";
import { readStoredStateJson, writeStateJson } from "../lib/storage.js";
import type { AgentTrace } from "./types.js";

const TRACE_FILE = "harness-traces.json";
export const MAX_HARNESS_TRACES = 200;

export interface HarnessTraceReport {
  updatedAt: string;
  traces: AgentTrace[];
}

function localFile(ctx: WorkspaceContext): URL {
  return new URL(TRACE_FILE, ctx.paths.root);
}

export function appendBoundedTrace(
  traces: AgentTrace[],
  trace: AgentTrace,
  limit = MAX_HARNESS_TRACES,
): AgentTrace[] {
  return [...traces.filter((item) => item.runId !== trace.runId), trace].slice(-limit);
}

export async function getHarnessTraces(ctx: WorkspaceContext): Promise<HarnessTraceReport> {
  if (config.dataSource === "github") {
    return readStoredStateJson<HarnessTraceReport>(ctx, TRACE_FILE, { updatedAt: "", traces: [] });
  }

  try {
    return JSON.parse(await readFile(localFile(ctx), "utf-8")) as HarnessTraceReport;
  } catch {
    return { updatedAt: "", traces: [] };
  }
}

export async function saveHarnessTrace(ctx: WorkspaceContext, trace: AgentTrace): Promise<void> {
  const current = await getHarnessTraces(ctx);
  const report: HarnessTraceReport = {
    updatedAt: new Date().toISOString(),
    traces: appendBoundedTrace(current.traces, trace),
  };

  if (config.dataSource === "github") {
    await writeStateJson(ctx, TRACE_FILE, report);
    return;
  }

  await writeFile(localFile(ctx), `${JSON.stringify(report, null, 2)}\n`);
}
