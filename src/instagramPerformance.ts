import { readFile, writeFile } from "node:fs/promises";
import { getContentRegistry } from "./contentRegistry.js";
import { getInstagramInsights } from "./lib/instagram.js";
import { readStoredStateJson, writeStateJson } from "./lib/storage.js";
import { config } from "./config.js";
import type { WorkspaceContext } from "./context.js";

export interface InstagramPerformance { contentId: string; tema: string; url: string; atualizadoEm: string; erro?: string; plays: number; reach: number; likes: number; comments: number; shares: number; saved: number; }
const FILE = "instagram-performance.json";

export async function refreshInstagramPerformance(ctx: WorkspaceContext): Promise<InstagramPerformance[]> {
  const entries = (await getContentRegistry(ctx)).filter((entry) => entry.channel === "instagram" && entry.status === "published");
  const report = await Promise.all(entries.map(async (entry): Promise<InstagramPerformance> => {
    try { return { contentId: entry.contentId, tema: entry.tema, url: entry.url, atualizadoEm: new Date().toISOString(), ...(await getInstagramInsights(ctx, entry.contentId)) }; }
    catch (err) { return { contentId: entry.contentId, tema: entry.tema, url: entry.url, atualizadoEm: new Date().toISOString(), plays: 0, reach: 0, likes: 0, comments: 0, shares: 0, saved: 0, erro: err instanceof Error ? err.message : String(err) }; }
  }));
  if (config.dataSource === "github") await writeStateJson(ctx, FILE, report); else await writeFile(ctx.paths.instagramPerformance, JSON.stringify(report, null, 2) + "\n");
  return report;
}
export async function getInstagramPerformance(ctx: WorkspaceContext): Promise<InstagramPerformance[]> {
  try { return config.dataSource === "github" ? await readStoredStateJson(ctx, FILE, []) : JSON.parse(await readFile(ctx.paths.instagramPerformance, "utf-8")) as InstagramPerformance[]; } catch { return []; }
}
