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
