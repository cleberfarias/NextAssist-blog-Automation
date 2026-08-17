import { googleFetch } from "../lib/google.js";
import type { WorkspaceContext } from "../context.js";

export function postUrl(ctx: WorkspaceContext, slug: string): string {
  return `${ctx.workspace.integrations.siteUrl}/blog/${slug}`;
}

async function validatePublishedUrl(url: string): Promise<void> {
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) throw new Error(`URL pública respondeu HTTP ${response.status}`);
}

async function validateUrlInSitemap(ctx: WorkspaceContext, url: string): Promise<void> {
  const sitemapUrl = ctx.workspace.integrations.searchConsole?.sitemapUrl;
  if (!sitemapUrl) throw new Error(`Workspace "${ctx.workspace.id}": sitemapUrl não configurado.`);
  const response = await fetch(sitemapUrl, { cache: "no-store" });
  if (!response.ok) throw new Error(`sitemap respondeu HTTP ${response.status}`);
  const sitemap = await response.text();
  if (!sitemap.includes(`<loc>${url}</loc>`)) throw new Error("URL publicada ainda não aparece no sitemap");
}

async function resubmitSitemap(ctx: WorkspaceContext): Promise<void> {
  const sc = ctx.workspace.integrations.searchConsole;
  if (!sc) throw new Error(`Workspace "${ctx.workspace.id}": integrations.searchConsole não configurado.`);
  const site = encodeURIComponent(sc.siteUrl);
  const sitemap = encodeURIComponent(sc.sitemapUrl);
  await googleFetch(ctx, `https://www.googleapis.com/webmasters/v3/sites/${site}/sitemaps/${sitemap}`, { method: "PUT" });
}

export interface IndexResult {
  url: string; urlPublicaOk: boolean; sitemapContemUrl: boolean; sitemapOk: boolean; detalhes: string;
}

export async function indexPublishedPost(ctx: WorkspaceContext, slug: string): Promise<IndexResult> {
  const url = postUrl(ctx, slug);
  const result: IndexResult = { url, urlPublicaOk: false, sitemapContemUrl: false, sitemapOk: false, detalhes: "" };
  const notas: string[] = [];

  try {
    await validatePublishedUrl(url);
    result.urlPublicaOk = true;
    notas.push("URL pública: confirmada");
  } catch (err) {
    notas.push(`validação da URL falhou: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (result.urlPublicaOk) {
    try {
      await validateUrlInSitemap(ctx, url);
      result.sitemapContemUrl = true;
      notas.push("URL no sitemap: confirmada");
    } catch (err) {
      notas.push(`validação do sitemap falhou: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (result.sitemapContemUrl) {
    try {
      await resubmitSitemap(ctx);
      result.sitemapOk = true;
      notas.push("sitemap enviado ao Search Console");
    } catch (err) {
      notas.push(`envio do sitemap falhou: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  notas.push("indexação: aguardando decisão do Google");
  result.detalhes = notas.join(" · ");
  return result;
}
