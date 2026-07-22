import { readFile, writeFile } from "node:fs/promises";

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

export async function getHistory(): Promise<HistoryEntry[]> {
  return loadHistory();
}
