import { readFile, writeFile } from "node:fs/promises";
import { readStateJson } from "./lib/dataSource.js";

const HISTORY_PATH = new URL("../post-history.json", import.meta.url);

export interface HistoryEntry {
  tema: string;
  titulo: string;
  slug: string;
  publicadoEm: string;
}

async function loadHistory(): Promise<HistoryEntry[]> {
  try {
    const raw = await readFile(HISTORY_PATH, "utf-8");
    return JSON.parse(raw) as HistoryEntry[];
  } catch {
    return [];
  }
}

export async function appendHistory(entry: HistoryEntry): Promise<void> {
  const history = await loadHistory();
  history.unshift(entry);
  await writeFile(HISTORY_PATH, JSON.stringify(history.slice(0, 200), null, 2) + "\n");
}

/**
 * Lê o histórico para exibição. Usa a fonte configurada (local ou GitHub),
 * para o painel hospedado enxergar os posts publicados pela Action.
 */
export async function getHistory(): Promise<HistoryEntry[]> {
  return readStateJson<HistoryEntry[]>("post-history.json", []);
}
