import { readFile, writeFile } from "node:fs/promises";
import { postUrl } from "./agents/indexer.js";
import { config } from "./config.js";
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

interface PublishedBlogPost {
  slug: string;
  titulo: string;
}

async function getPublishedBlogPosts(): Promise<PublishedBlogPost[]> {
  const response = await fetch(`${config.blogApiUrl}/blog/posts`, {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`API do blog respondeu HTTP ${response.status}`);
  }

  const payload = (await response.json()) as { data?: PublishedBlogPost[] };
  if (!Array.isArray(payload.data)) {
    throw new Error("API do blog retornou uma lista de posts inválida.");
  }

  // Slugs duplicados apontam para a mesma URL e não devem repetir métricas.
  return [...new Map(payload.data.map((post) => [post.slug, post])).values()];
}

export function isoDate(offsetDays: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function isValidIsoDate(value: string): boolean {
  if (!ISO_DATE_PATTERN.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function validatePerformancePeriod(inicio: string, fim: string): void {
  if (!isValidIsoDate(inicio) || !isValidIsoDate(fim)) {
    throw new Error("Informe as datas de início e fim no formato AAAA-MM-DD.");
  }
  if (inicio > fim) {
    throw new Error("A data inicial não pode ser posterior à data final.");
  }
  if (fim > isoDate(0)) {
    throw new Error("A data final não pode estar no futuro.");
  }
}

/**
 * Consulta o Search Console para cada post publicado na API do blog e grava um relatório
 * em `post-performance.json`. Falhas por post são registradas no campo `erro`
 * sem interromper os demais.
 */
export async function refreshPerformance(
  inicio = isoDate(-28),
  fim = isoDate(0),
): Promise<PerformanceReport> {
  validatePerformancePeriod(inicio, fim);
  const publishedPosts = await getPublishedBlogPosts();

  const posts = await Promise.all(publishedPosts.map(async (entry): Promise<PostPerformance> => {
    const url = postUrl(entry.slug);
    const base = { slug: entry.slug, titulo: entry.titulo, url };
    try {
      const [status, metrics] = await Promise.all([
        getIndexStatus(url),
        getUrlMetrics(url, inicio, fim),
      ]);
      return {
        ...base,
        indexado: status.verdict === "PASS",
        coverageState: status.coverageState,
        lastCrawlTime: status.lastCrawlTime,
        clicks: metrics.clicks,
        impressions: metrics.impressions,
        ctr: metrics.ctr,
        position: metrics.position,
      };
    } catch (err) {
      return {
        ...base,
        indexado: false,
        coverageState: "Erro",
        lastCrawlTime: null,
        clicks: 0,
        impressions: 0,
        ctr: 0,
        position: 0,
        erro: err instanceof Error ? err.message : String(err),
      };
    }
  }));

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
