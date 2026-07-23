import { config } from "../config.js";
import { googleFetch } from "./google.js";

const SITE = encodeURIComponent(config.searchConsoleSiteUrl);

export interface UrlMetrics {
  clicks: number;
  impressions: number;
  ctr: number; // 0..1
  position: number; // posição média
}

/**
 * Consulta a Search Analytics API para uma URL específica, agregando o
 * período informado. Retorna zeros se ainda não há dados (post recente).
 */
export async function getUrlMetrics(
  url: string,
  startDate: string,
  endDate: string,
): Promise<UrlMetrics> {
  const data = await googleFetch<{ rows?: Array<UrlMetrics> }>(
    `https://www.googleapis.com/webmasters/v3/sites/${SITE}/searchAnalytics/query`,
    {
      method: "POST",
      body: {
        startDate,
        endDate,
        dimensions: ["page"],
        dimensionFilterGroups: [
          { filters: [{ dimension: "page", operator: "equals", expression: url }] },
        ],
        rowLimit: 1,
      },
    },
  );

  const row = data.rows?.[0];
  return {
    clicks: row?.clicks ?? 0,
    impressions: row?.impressions ?? 0,
    ctr: row?.ctr ?? 0,
    position: row?.position ?? 0,
  };
}

export interface IndexStatus {
  verdict: string; // PASS | NEUTRAL | FAIL | VERDICT_UNSPECIFIED
  coverageState: string; // ex: "Submitted and indexed"
  lastCrawlTime: string | null;
}

/**
 * Consulta a URL Inspection API: diz se a URL já está indexada, o estado de
 * cobertura e quando foi rastreada pela última vez.
 */
export async function getIndexStatus(url: string): Promise<IndexStatus> {
  const data = await googleFetch<{
    inspectionResult?: {
      indexStatusResult?: {
        verdict?: string;
        coverageState?: string;
        lastCrawlTime?: string;
      };
    };
  }>("https://searchconsole.googleapis.com/v1/urlInspection/index:inspect", {
    method: "POST",
    body: { inspectionUrl: url, siteUrl: config.searchConsoleSiteUrl },
  });

  const r = data.inspectionResult?.indexStatusResult;
  return {
    verdict: r?.verdict ?? "VERDICT_UNSPECIFIED",
    coverageState: r?.coverageState ?? "Desconhecido",
    lastCrawlTime: r?.lastCrawlTime ?? null,
  };
}
