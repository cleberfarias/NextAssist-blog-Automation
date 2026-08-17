// src/lib/searchConsole.ts
import type { WorkspaceContext } from "../context.js";
import { googleFetch } from "./google.js";

export interface UrlMetrics { clicks: number; impressions: number; ctr: number; position: number; }

export async function getUrlMetrics(ctx: WorkspaceContext, url: string, startDate: string, endDate: string): Promise<UrlMetrics> {
  const site = encodeURIComponent(ctx.workspace.integrations.searchConsole?.siteUrl ?? "");
  const data = await googleFetch<{ rows?: Array<UrlMetrics> }>(ctx, `https://www.googleapis.com/webmasters/v3/sites/${site}/searchAnalytics/query`, {
    method: "POST",
    body: {
      startDate, endDate, dimensions: ["page"],
      dimensionFilterGroups: [{ filters: [{ dimension: "page", operator: "equals", expression: url }] }],
      rowLimit: 1,
    },
  });
  const row = data.rows?.[0];
  return { clicks: row?.clicks ?? 0, impressions: row?.impressions ?? 0, ctr: row?.ctr ?? 0, position: row?.position ?? 0 };
}

export interface IndexStatus { verdict: string; coverageState: string; lastCrawlTime: string | null; }

export async function getIndexStatus(ctx: WorkspaceContext, url: string): Promise<IndexStatus> {
  const siteUrl = ctx.workspace.integrations.searchConsole?.siteUrl ?? "";
  const data = await googleFetch<{
    inspectionResult?: { indexStatusResult?: { verdict?: string; coverageState?: string; lastCrawlTime?: string } };
  }>(ctx, "https://searchconsole.googleapis.com/v1/urlInspection/index:inspect", {
    method: "POST",
    body: { inspectionUrl: url, siteUrl },
  });
  const r = data.inspectionResult?.indexStatusResult;
  return { verdict: r?.verdict ?? "VERDICT_UNSPECIFIED", coverageState: r?.coverageState ?? "Desconhecido", lastCrawlTime: r?.lastCrawlTime ?? null };
}

export interface SearchQueryMetric { query: string; clicks: number; impressions: number; position: number; }

/**
 * Termos de busca com mais impressões nos últimos 28 dias, para o Marketing
 * Director identificar oportunidades (termo com impressões altas mas posição
 * ruim = pauta em potencial). Devolve `[]` se o workspace não tiver Search
 * Console configurado — o Director trata isso como "sem esse sinal", não
 * como erro.
 */
export async function getTopSearchQueries(ctx: WorkspaceContext, limit = 20): Promise<SearchQueryMetric[]> {
  const siteUrl = ctx.workspace.integrations.searchConsole?.siteUrl;
  if (!siteUrl) return [];

  const end = new Date();
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 28);
  const site = encodeURIComponent(siteUrl);

  const data = await googleFetch<{ rows?: Array<{ keys: string[]; clicks: number; impressions: number; position: number }> }>(
    ctx,
    `https://www.googleapis.com/webmasters/v3/sites/${site}/searchAnalytics/query`,
    {
      method: "POST",
      body: {
        startDate: start.toISOString().slice(0, 10),
        endDate: end.toISOString().slice(0, 10),
        dimensions: ["query"],
        rowLimit: limit,
      },
    },
  );

  return (data.rows ?? []).map((row) => ({
    query: row.keys[0],
    clicks: row.clicks,
    impressions: row.impressions,
    position: row.position,
  }));
}
