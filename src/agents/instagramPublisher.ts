import { publishImageToInstagram } from "../lib/instagram.js";
import type { FinalPost } from "./editorSeo.js";

/** Marcas fixas que acompanham todo post do NextAssist. */
const HASHTAGS_BASE = ["nextassist", "assistenciatecnica", "consertodecelular"];

/** Converte um texto livre em hashtag (sem acento, sem espaço, minúsculo). */
function toHashtag(text: string): string {
  const clean = text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // tira acentos
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  return clean ? `#${clean}` : "";
}

/**
 * Monta a legenda: título, resumo, chamada para o blog e hashtags. O Instagram
 * não torna links clicáveis na legenda (por isso o "link na bio"), mas a URL
 * fica visível/copiável. Limite da API: 2200 caracteres e 30 hashtags.
 */
export function buildCaption(post: FinalPost, blogUrl: string): string {
  const hashtags = Array.from(
    new Set([...post.tags.map(toHashtag), ...HASHTAGS_BASE.map((t) => `#${t}`)]),
  )
    .filter(Boolean)
    .slice(0, 30)
    .join(" ");

  const caption = [
    post.titulo,
    "",
    post.resumo,
    "",
    `📖 Leia o artigo completo no blog (link na bio):`,
    blogUrl,
    "",
    hashtags,
  ].join("\n");

  return caption.slice(0, 2200);
}

export interface InstagramResult {
  ok: boolean;
  permalink: string | null;
  detalhes: string;
}

/**
 * Publica o post no Instagram reaproveitando a imagem de capa já gerada.
 * É melhor esforço: captura os próprios erros e nunca lança, para não derrubar
 * o pipeline depois que o post do blog já foi publicado.
 */
export async function publishToInstagram(
  post: FinalPost,
  imagemCapa: string,
  blogUrl: string,
): Promise<InstagramResult> {
  try {
    const caption = buildCaption(post, blogUrl);
    const { mediaId, permalink } = await publishImageToInstagram(imagemCapa, caption);
    return {
      ok: true,
      permalink,
      detalhes: permalink
        ? `Publicado no Instagram: ${permalink}`
        : `Publicado no Instagram (media ${mediaId})`,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, permalink: null, detalhes: `Falha ao publicar no Instagram: ${message}` };
  }
}
