import { readFile, writeFile } from "node:fs/promises";
import { readStateJson } from "./lib/dataSource.js";
import type { WorkspaceContext } from "./context.js";

export interface HistoryEntry {
  tema: string;
  titulo: string;
  slug: string;
  publicadoEm: string;
}

async function loadHistory(ctx: WorkspaceContext): Promise<HistoryEntry[]> {
  try {
    const raw = await readFile(ctx.paths.history, "utf-8");
    return JSON.parse(raw) as HistoryEntry[];
  } catch {
    return [];
  }
}

export async function appendHistory(ctx: WorkspaceContext, entry: HistoryEntry): Promise<void> {
  const history = await loadHistory(ctx);
  history.unshift(entry);
  await writeFile(ctx.paths.history, JSON.stringify(history.slice(0, 200), null, 2) + "\n");
}

/**
 * Lê o histórico para exibição. Usa a fonte configurada (local ou GitHub),
 * para o painel hospedado enxergar os posts publicados pela Action.
 */
export async function getHistory(ctx: WorkspaceContext): Promise<HistoryEntry[]> {
  return readStateJson<HistoryEntry[]>(ctx.paths.history, [], ctx.workspace.id);
}
