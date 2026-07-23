import { readFile } from "node:fs/promises";
import { config } from "../config.js";

/**
 * Lê um arquivo de estado JSON da raiz do projeto. Em modo "github" (painel
 * hospedado, que não recebe os commits da Action) busca a versão crua do
 * repositório; em "local" lê do disco. Devolve `fallback` se não existir.
 */
export async function readStateJson<T>(fileName: string, fallback: T): Promise<T> {
  try {
    if (config.dataSource === "github") {
      // API de conteúdo do GitHub — funciona para repositório privado
      // (com token) e público. `Accept: raw` devolve o conteúdo direto.
      const url = `https://api.github.com/repos/${config.githubRepo}/contents/${fileName}?ref=${config.githubBranch}`;
      const headers: Record<string, string> = {
        Accept: "application/vnd.github.raw",
        "User-Agent": "nextassist-panel",
      };
      if (config.githubToken) headers.Authorization = `Bearer ${config.githubToken}`;
      const res = await fetch(url, { headers });
      if (!res.ok) return fallback; // 404 = arquivo ainda não existe
      return JSON.parse(await res.text()) as T;
    }
    const raw = await readFile(new URL(`../../${fileName}`, import.meta.url), "utf-8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}
