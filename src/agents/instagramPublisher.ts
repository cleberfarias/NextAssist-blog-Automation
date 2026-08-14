import { config } from "../config.js";
import { publishReelToInstagram } from "../lib/instagram.js";
import { executeWithFallback } from "../lib/providerFallback.js";
import { uploadReelVideo } from "../lib/storage.js";
import { generateNarration } from "../lib/tts.js";
import { generateVeoReel } from "../lib/veo.js";
import { generateReelFromImage } from "../lib/video.js";
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

/** Texto curto narrado no áudio do Reel. */
function buildNarration(post: FinalPost): string {
  return `${post.titulo}. Confira o artigo completo, link na bio!`;
}

/** Prompt de cena para o Veo, com a narração embutida como fala. */
function buildVeoPrompt(post: FinalPost): string {
  return (
    `Vídeo promocional cinematográfico e realista para uma assistência ` +
    `técnica de celular: câmera lenta, boa iluminação, ambiente de loja/ ` +
    `oficina profissional e organizada, foco em ferramentas e smartphones ` +
    `sendo consertados. Um narrador confiante diz em português do Brasil: ` +
    `"${buildNarration(post)}"`
  );
}

/**
 * Gera o vídeo com o Veo, tentando a conta principal e, se ela falhar por um
 * motivo recuperável (cota estourada, rate limit, erro 5xx), a conta de
 * fallback (`GEMINI_API_KEY_FALLBACK`), quando configurada.
 */
async function generateVeoReelWithFallback(post: FinalPost, imagemCapaBuffer: Buffer): Promise<Buffer> {
  const prompt = buildVeoPrompt(post);
  const { value } = await executeWithFallback({
    primary: () => generateVeoReel(imagemCapaBuffer, prompt, config.geminiApiKey),
    fallback: config.geminiApiKeyFallback
      ? () => generateVeoReel(imagemCapaBuffer, prompt, config.geminiApiKeyFallback)
      : undefined,
  });
  return value;
}

/** Reel de fallback: zoom/pan local (ffmpeg) + narração TTS. */
async function generateFallbackReel(post: FinalPost, imagemCapaBuffer: Buffer): Promise<Buffer> {
  // A narração é melhor esforço à parte: se o TTS falhar, o Reel ainda sai,
  // só que mudo.
  let narrationBuffer: Buffer | undefined;
  try {
    narrationBuffer = await generateNarration(buildNarration(post));
  } catch {
    narrationBuffer = undefined;
  }
  return generateReelFromImage(imagemCapaBuffer, narrationBuffer);
}

export interface InstagramResult {
  ok: boolean;
  permalink: string | null;
  detalhes: string;
}

/**
 * Publica o post no Instagram como Reel. Se `GEMINI_API_KEY` estiver
 * configurada, usa o Veo (vídeo criativo gerado por IA) — com uma segunda
 * conta (`GEMINI_API_KEY_FALLBACK`) como reserva se a primeira estourar
 * cota; senão, ou se o Veo falhar nas duas contas, cai no fallback local
 * (zoom/pan + narração TTS). É melhor esforço: captura os próprios erros e
 * nunca lança, para não derrubar o pipeline depois que o post do blog já
 * foi publicado.
 */
export async function publishToInstagram(
  post: FinalPost,
  imagemCapaBuffer: Buffer,
  blogUrl: string,
): Promise<InstagramResult> {
  try {
    const caption = buildCaption(post, blogUrl);

    let videoBuffer: Buffer;
    if (config.geminiApiKey) {
      try {
        videoBuffer = await generateVeoReelWithFallback(post, imagemCapaBuffer);
      } catch {
        videoBuffer = await generateFallbackReel(post, imagemCapaBuffer);
      }
    } else {
      videoBuffer = await generateFallbackReel(post, imagemCapaBuffer);
    }

    const videoUrl = await uploadReelVideo(videoBuffer, post.slug);
    const { mediaId, permalink } = await publishReelToInstagram(videoUrl, caption);
    return {
      ok: true,
      permalink,
      detalhes: permalink
        ? `Reel publicado no Instagram: ${permalink}`
        : `Reel publicado no Instagram (media ${mediaId})`,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, permalink: null, detalhes: `Falha ao publicar no Instagram: ${message}` };
  }
}
