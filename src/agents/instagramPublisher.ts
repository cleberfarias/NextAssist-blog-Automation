import { publishReelToInstagram } from "../lib/instagram.js";
import { executeWithFallback } from "../lib/providerFallback.js";
import { uploadReelVideo } from "../lib/storage.js";
import { generateNarration } from "../lib/tts.js";
import { generateVeoReel } from "../lib/veo.js";
import { generateReelFromImage } from "../lib/video.js";
import type { WorkspaceContext } from "../context.js";
import type { FinalPost } from "./editorSeo.js";

function toHashtag(text: string): string {
  const clean = text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
  return clean ? `#${clean}` : "";
}

export function buildCaption(ctx: WorkspaceContext, post: FinalPost, blogUrl: string): string {
  const baseHashtag = toHashtag(ctx.workspace.brand.name);
  const hashtags = Array.from(new Set([...post.tags.map(toHashtag), baseHashtag])).filter(Boolean).slice(0, 30).join(" ");
  const caption = [post.titulo, "", post.resumo, "", `📖 Leia o artigo completo no blog (link na bio):`, blogUrl, "", hashtags].join("\n");
  return caption.slice(0, 2200);
}

function buildNarration(post: FinalPost): string {
  return `${post.titulo}. Confira o artigo completo, link na bio!`;
}

function buildVeoPrompt(ctx: WorkspaceContext, post: FinalPost): string {
  return `Vídeo promocional cinematográfico e realista: ${ctx.workspace.brand.description} Um narrador confiante diz em português do Brasil: "${buildNarration(post)}"`;
}

async function generateVeoReelWithFallback(ctx: WorkspaceContext, post: FinalPost, imagemCapaBuffer: Buffer): Promise<Buffer> {
  const prompt = buildVeoPrompt(ctx, post);
  const fallbackKey = await ctx.secrets.get(ctx.workspace.id, "GEMINI_API_KEY_FALLBACK");
  const { value } = await executeWithFallback({
    primary: () => generateVeoReel(ctx, imagemCapaBuffer, prompt),
    fallback: fallbackKey ? () => generateVeoReel(ctx, imagemCapaBuffer, prompt, fallbackKey) : undefined,
  });
  return value;
}

async function generateFallbackReel(ctx: WorkspaceContext, post: FinalPost, imagemCapaBuffer: Buffer): Promise<Buffer> {
  let narrationBuffer: Buffer | undefined;
  try {
    narrationBuffer = await generateNarration(ctx, buildNarration(post));
  } catch {
    narrationBuffer = undefined;
  }
  return generateReelFromImage(imagemCapaBuffer, narrationBuffer);
}

export interface InstagramResult { ok: boolean; permalink: string | null; detalhes: string; }

export async function publishToInstagram(ctx: WorkspaceContext, post: FinalPost, imagemCapaBuffer: Buffer, blogUrl: string): Promise<InstagramResult> {
  try {
    const caption = buildCaption(ctx, post, blogUrl);
    const geminiKey = await ctx.secrets.get(ctx.workspace.id, "GEMINI_API_KEY");

    let videoBuffer: Buffer;
    if (geminiKey) {
      try {
        videoBuffer = await generateVeoReelWithFallback(ctx, post, imagemCapaBuffer);
      } catch {
        videoBuffer = await generateFallbackReel(ctx, post, imagemCapaBuffer);
      }
    } else {
      videoBuffer = await generateFallbackReel(ctx, post, imagemCapaBuffer);
    }

    const videoUrl = await uploadReelVideo(ctx, videoBuffer, post.slug);
    const { mediaId, permalink } = await publishReelToInstagram(ctx, videoUrl, caption);
    return { ok: true, permalink, detalhes: permalink ? `Reel publicado no Instagram: ${permalink}` : `Reel publicado no Instagram (media ${mediaId})` };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, permalink: null, detalhes: `Falha ao publicar no Instagram: ${message}` };
  }
}
