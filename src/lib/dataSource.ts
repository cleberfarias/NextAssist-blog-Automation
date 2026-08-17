import { readFile } from "node:fs/promises";
import { config } from "../config.js";

/**
 * Lê um arquivo de estado JSON de um workspace. Em modo "github" (painel
 * hospedado, que não recebe os commits da Action) busca a versão crua do
 * repositório em `workspaces/<workspaceId>/<fileName>`; em "local" lê do
 * disco a partir de `path`. Devolve `fallback` se não existir.
 */
export async function readStateJson<T>(path: URL, fallback: T, workspaceId?: string): Promise<T> {
  try {
    if (config.dataSource === "github") {
      if (!workspaceId) throw new Error("readStateJson: workspaceId é obrigatório em modo github");
      const fileName = path.pathname.split("/").pop();
      const url = `https://api.github.com/repos/${config.githubRepo}/contents/workspaces/${workspaceId}/${fileName}?ref=${config.githubBranch}`;
      const headers: Record<string, string> = {
        Accept: "application/vnd.github.raw",
        "User-Agent": "nextassist-panel",
      };
      if (config.githubToken) headers.Authorization = `Bearer ${config.githubToken}`;
      const res = await fetch(url, { headers });
      if (!res.ok) return fallback;
      return JSON.parse(await res.text()) as T;
    }
    const raw = await readFile(path, "utf-8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}
