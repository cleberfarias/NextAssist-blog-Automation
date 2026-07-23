import { readFile, writeFile } from "node:fs/promises";
import { readStateJson } from "./lib/dataSource.js";
import type { PipelineEvent } from "./pipeline.js";

const RUNS_PATH = new URL("../runs-history.json", import.meta.url);
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
}

async function loadLocal(): Promise<RunRecord[]> {
  try {
    const raw = await readFile(RUNS_PATH, "utf-8");
    return JSON.parse(raw) as RunRecord[];
  } catch {
    return [];
  }
}

/** Grava (no disco local) o registro de uma execução no topo do histórico. */
export async function appendRun(record: RunRecord): Promise<void> {
  const runs = await loadLocal();
  runs.unshift(record);
  await writeFile(RUNS_PATH, JSON.stringify(runs.slice(0, MAX_RUNS), null, 2) + "\n");
}

/** Lê o histórico de execuções (local ou do GitHub, conforme DATA_SOURCE). */
export async function getRuns(): Promise<RunRecord[]> {
  return readStateJson<RunRecord[]>("runs-history.json", []);
}
