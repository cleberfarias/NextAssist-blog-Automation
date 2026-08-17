import { readFile, writeFile } from "node:fs/promises";
import { readStateJson } from "./lib/dataSource.js";
import type { WorkspaceContext } from "./context.js";
import type { PipelineEvent } from "./pipeline.js";
import type { AnthropicUsage } from "./context.js";

const MAX_RUNS = 100;

export type RunStatus = "publicado" | "falhou" | "sem-tema";

export interface RunRecord {
  id: string;
  origem: "action" | "manual";
  iniciadoEm: string;
  finalizadoEm: string;
  tema: string | null;
  status: RunStatus;
  slug: string | null;
  erro: string | null;
  eventos: PipelineEvent[];
  usage?: AnthropicUsage;
}

async function loadLocal(ctx: WorkspaceContext): Promise<RunRecord[]> {
  try {
    const raw = await readFile(ctx.paths.runs, "utf-8");
    return JSON.parse(raw) as RunRecord[];
  } catch {
    return [];
  }
}

/** Grava (no disco local) o registro de uma execução no topo do histórico. */
export async function appendRun(ctx: WorkspaceContext, record: RunRecord): Promise<void> {
  const runs = await loadLocal(ctx);
  runs.unshift(record);
  await writeFile(ctx.paths.runs, JSON.stringify(runs.slice(0, MAX_RUNS), null, 2) + "\n");
}

/** Lê o histórico de execuções (local ou do GitHub, conforme DATA_SOURCE). */
export async function getRuns(ctx: WorkspaceContext): Promise<RunRecord[]> {
  return readStateJson<RunRecord[]>(ctx.paths.runs, [], ctx.workspace.id);
}
