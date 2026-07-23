import { config } from "../config.js";
import { googleFetch } from "../lib/google.js";

/** URL pública completa de um post a partir do slug. */
export function postUrl(slug: string): string {
  return `${config.siteBaseUrl}/blog/${slug}`;
}

/**
 * Notifica a Google Indexing API que a URL foi criada/atualizada, para
 * acelerar o rastreamento. Observação honesta: oficialmente o Google só
 * suporta a Indexing API para JobPosting/BroadcastEvent — para posts de
 * blog costuma funcionar como um empurrão, mas não é garantido.
 */
async function notifyIndexingApi(url: string): Promise<void> {
  await googleFetch("https://indexing.googleapis.com/v3/urlNotifications:publish", {
    method: "POST",
    body: { url, type: "URL_UPDATED" },
  });
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
  indexingApiOk: boolean;
  sitemapOk: boolean;
  detalhes: string;
}

/**
 * Roda os dois nudges de indexação para o post recém-publicado. Não lança
 * erro: indexação é "melhor esforço" e não deve derrubar o pipeline se o
 * post já foi publicado com sucesso — apenas reporta o que deu certo.
 */
export async function indexPublishedPost(slug: string): Promise<IndexResult> {
  const url = postUrl(slug);
  const result: IndexResult = { url, indexingApiOk: false, sitemapOk: false, detalhes: "" };
  const notas: string[] = [];

  try {
    await notifyIndexingApi(url);
    result.indexingApiOk = true;
    notas.push("Indexing API: notificada");
  } catch (err) {
    notas.push(`Indexing API falhou: ${err instanceof Error ? err.message : String(err)}`);
  }

  try {
    await resubmitSitemap();
    result.sitemapOk = true;
    notas.push("sitemap reenviado");
  } catch (err) {
    notas.push(`sitemap falhou: ${err instanceof Error ? err.message : String(err)}`);
  }

  result.detalhes = notas.join(" · ");
  return result;
}
