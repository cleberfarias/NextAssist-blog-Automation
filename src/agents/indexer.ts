import { config } from "../config.js";
import { googleFetch } from "../lib/google.js";

/** URL pública completa de um post a partir do slug. */
export function postUrl(slug: string): string {
  return `${config.siteBaseUrl}/blog/${slug}`;
}

async function validatePublishedUrl(url: string): Promise<void> {
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) {
    throw new Error(`URL pública respondeu HTTP ${response.status}`);
  }
}

async function validateUrlInSitemap(url: string): Promise<void> {
  const response = await fetch(config.sitemapUrl, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`sitemap respondeu HTTP ${response.status}`);
  }

  const sitemap = await response.text();
  if (!sitemap.includes(`<loc>${url}</loc>`)) {
    throw new Error("URL publicada ainda não aparece no sitemap");
  }
}

/**
 * Reenvia o sitemap ao Search Console para provocar um recrawl. O sitemap em
 * si é servido pelo frontend do blog (gerado dinamicamente) — aqui só pedimos
 * ao Google para lê-lo de novo.
 */
async function resubmitSitemap(): Promise<void> {
  const site = encodeURIComponent(config.searchConsoleSiteUrl);
  const sitemap = encodeURIComponent(config.sitemapUrl);
  await googleFetch(
    `https://www.googleapis.com/webmasters/v3/sites/${site}/sitemaps/${sitemap}`,
    { method: "PUT" },
  );
}

export interface IndexResult {
  url: string;
  urlPublicaOk: boolean;
  sitemapContemUrl: boolean;
  sitemapOk: boolean;
  detalhes: string;
}

/**
 * Confirma que o post está público e presente no sitemap antes de reenviá-lo
 * ao Search Console. Não promete indexação imediata: o Google decide quando
 * rastrear e indexar cada URL.
 */
export async function indexPublishedPost(slug: string): Promise<IndexResult> {
  const url = postUrl(slug);
  const result: IndexResult = {
    url,
    urlPublicaOk: false,
    sitemapContemUrl: false,
    sitemapOk: false,
    detalhes: "",
  };
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
      await validateUrlInSitemap(url);
      result.sitemapContemUrl = true;
      notas.push("URL no sitemap: confirmada");
    } catch (err) {
      notas.push(`validação do sitemap falhou: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (result.sitemapContemUrl) {
    try {
      await resubmitSitemap();
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
