import { readFile, writeFile } from "node:fs/promises";
import { getHistory } from "./history.js";
import { postUrl } from "./agents/indexer.js";
import { getUrlMetrics, getIndexStatus } from "./lib/searchConsole.js";

const PERFORMANCE_PATH = new URL("../post-performance.json", import.meta.url);

export interface PostPerformance {
  slug: string;
  titulo: string;
  url: string;
  indexado: boolean;
  coverageState: string;
  lastCrawlTime: string | null;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
  erro?: string;
}

export interface PerformanceReport {
  atualizadoEm: string;
  periodo: { inicio: string; fim: string };
  posts: PostPerformance[];
}

function isoDate(offsetDays: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

/**
 * Consulta o Search Console para cada post do histórico e grava um relatório
 * em `post-performance.json`. Falhas por post são registradas no campo `erro`
 * sem interromper os demais.
 */
export async function refreshPerformance(): Promise<PerformanceReport> {
  const history = await getHistory();
  const fim = isoDate(0);
  const inicio = isoDate(-28);

  const posts: PostPerformance[] = [];
  for (const entry of history) {
    const url = postUrl(entry.slug);
    const base = { slug: entry.slug, titulo: entry.titulo, url };
    try {
      const [status, metrics] = await Promise.all([
        getIndexStatus(url),
        getUrlMetrics(url, inicio, fim),
      ]);
      posts.push({
        ...base,
        indexado: status.verdict === "PASS",
        coverageState: status.coverageState,
        lastCrawlTime: status.lastCrawlTime,
        clicks: metrics.clicks,
        impressions: metrics.impressions,
        ctr: metrics.ctr,
        position: metrics.position,
      });
    } catch (err) {
      posts.push({
        ...base,
        indexado: false,
        coverageState: "Erro",
        lastCrawlTime: null,
        clicks: 0,
        impressions: 0,
        ctr: 0,
        position: 0,
        erro: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const report: PerformanceReport = {
    atualizadoEm: new Date().toISOString(),
    periodo: { inicio, fim },
    posts,
  };
  await writeFile(PERFORMANCE_PATH, JSON.stringify(report, null, 2) + "\n");
  return report;
}

/** Lê o último relatório salvo (ou null se ainda não foi gerado). */
export async function getPerformance(): Promise<PerformanceReport | null> {
  try {
    const raw = await readFile(PERFORMANCE_PATH, "utf-8");
    return JSON.parse(raw) as PerformanceReport;
  } catch {
    return null;
  }
}
