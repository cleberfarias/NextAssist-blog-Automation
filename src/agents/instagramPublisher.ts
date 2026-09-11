import { publishReelToInstagram } from "../lib/instagram.js";
import { executeWithFallback } from "../lib/providerFallback.js";
import { uploadReelVideo } from "../lib/storage.js";
import { generateNarration } from "../lib/tts.js";
import { generateVeoReel } from "../lib/veo.js";
import { generateReelFromImage } from "../lib/video.js";
import { generateHeyGenAvatarReel, hasHeyGenConfig } from "../lib/heygen.js";
import { extractJson, runAgent } from "../lib/anthropic.js";
import type { WorkspaceContext } from "../context.js";
import type { FinalPost } from "./editorSeo.js";

function toHashtag(text: string): string {
  const clean = text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
  return clean ? `#${clean}` : "";
}

export interface ReelBrief {
  gancho: string;
  roteiro: string;
  textoTela: string[];
  cta: string;
  pergunta: string;
}

const REEL_SYSTEM = (ctx: WorkspaceContext) => `Você é o diretor de Reels do ${ctx.workspace.brand.name}.
Crie conteúdo nativo para Instagram, em português do Brasil, para donos de assistências técnicas de celular.
Seja direto, humano e específico. Não prometa viralização, não use clichês de marketing e não invente dados.
O Reel deve ter 20 a 35 segundos e existir para gerar conversa comercial, não apenas alcance.\nEstruture a fala como: dor real do dono da assistência → consequência → solução prática → conexão natural com o NextAssist → pergunta/CTA.\nFale como um fundador que conhece a rotina de uma assistência, não como locutor de propaganda.\nNão comece com "você sabia", não peça para "conferir o link na bio" como CTA principal e não despeje funcionalidades.\nQuando fizer sentido, convide a pessoa a comentar uma palavra curta ou responder a pergunta para iniciar conversa.
Responda SOMENTE em JSON neste formato:
{"gancho":"até 12 palavras","roteiro":"fala natural de 45 a 80 palavras","textoTela":["3 a 5 frases curtas para a tela"],"cta":"CTA curto de conversa","pergunta":"pergunta que convida o público a comentar"}`;

export async function createReelBrief(ctx: WorkspaceContext, post: FinalPost): Promise<ReelBrief> {
  const raw = extractJson<ReelBrief>(await runAgent(ctx, {
    system: REEL_SYSTEM(ctx),
    prompt: `Tema do artigo: ${post.titulo}\nResumo: ${post.resumo}\nTags: ${post.tags.join(", ")}\n\nTransforme o tema em uma situação real de balcão, bancada ou gestão. Priorize uma dor que custe tempo, dinheiro ou confiança do cliente. O conteúdo precisa funcionar sozinho no Instagram; o artigo é fonte, não o destino principal. Mostre como o NextAssist resolve a situação somente depois de tornar a dor concreta.`,
    maxTokens: 1200,
  }));
  const textoTela = Array.isArray(raw.textoTela) ? raw.textoTela.slice(0, 5).map((item) => String(item).trim()).filter(Boolean) : [];
  if (!raw.gancho?.trim() || !raw.roteiro?.trim() || textoTela.length < 3 || !raw.cta?.trim() || !raw.pergunta?.trim()) {
    throw new Error("O diretor de Reels retornou um roteiro incompleto.");
  }
  return { ...raw, textoTela };
}

export function buildCaption(ctx: WorkspaceContext, post: FinalPost, blogUrl: string, brief?: ReelBrief): string {
  const baseHashtag = toHashtag(ctx.workspace.brand.name);
  const hashtags = Array.from(new Set([...post.tags.map(toHashtag), baseHashtag])).filter(Boolean).slice(0, 30).join(" ");
  const caption = [brief?.gancho ?? post.titulo, "", brief?.pergunta ?? post.resumo, "", brief?.cta ?? "Comenta aqui como você controla isso hoje na sua assistência.", "", `Conteúdo completo: ${blogUrl}`, "", hashtags].join("\n");
  return caption.slice(0, 2200);
}

function buildNarration(post: FinalPost, brief?: ReelBrief): string {
  return brief ? `${brief.gancho}. ${brief.roteiro} ${brief.cta}` : `${post.titulo}. Confira o artigo completo, link na bio!`;
}

function buildVeoPrompt(ctx: WorkspaceContext, post: FinalPost, brief?: ReelBrief): string {
  const onScreen = brief?.textoTela.join(" | ") ?? post.titulo;
  return `Reel vertical 9:16, documental e autêntico, dentro de uma assistência técnica de celular no Brasil. Mostre bancada, ordem de serviço e celular sendo atendido; cortes rápidos e naturais, sem aparência de anúncio genérico. Texto na tela: ${onScreen}. Um narrador fala em português do Brasil: "${buildNarration(post, brief)}"`;
}

async function generateVeoReelWithFallback(ctx: WorkspaceContext, post: FinalPost, imagemCapaBuffer: Buffer, brief?: ReelBrief): Promise<Buffer> {
  const prompt = buildVeoPrompt(ctx, post, brief);
  const fallbackKey = await ctx.secrets.get(ctx.workspace.id, "GEMINI_API_KEY_FALLBACK");
  const { value } = await executeWithFallback({
    primary: () => generateVeoReel(ctx, imagemCapaBuffer, prompt),
    fallback: fallbackKey ? () => generateVeoReel(ctx, imagemCapaBuffer, prompt, fallbackKey) : undefined,
  });
  return value;
}

async function generateFallbackReel(ctx: WorkspaceContext, post: FinalPost, imagemCapaBuffer: Buffer, brief?: ReelBrief): Promise<Buffer> {
  let narrationBuffer: Buffer | undefined;
  try {
    narrationBuffer = await generateNarration(ctx, buildNarration(post, brief));
  } catch {
    narrationBuffer = undefined;
  }
  return generateReelFromImage(imagemCapaBuffer, narrationBuffer);
}

export interface InstagramResult { ok: boolean; mediaId?: string; permalink: string | null; detalhes: string; }

export async function publishToInstagram(ctx: WorkspaceContext, post: FinalPost, imagemCapaBuffer: Buffer, blogUrl: string): Promise<InstagramResult> {
  try {
    let brief: ReelBrief | undefined;
    try {
      brief = await createReelBrief(ctx, post);
    } catch {
      // A publicação continua com o formato legado se o diretor editorial falhar.
      brief = undefined;
    }
    const caption = buildCaption(ctx, post, blogUrl, brief);
    const geminiKey = await ctx.secrets.get(ctx.workspace.id, "GEMINI_API_KEY");
    const heygenConfigured = await hasHeyGenConfig(ctx);

    let videoBuffer: Buffer;
    if (heygenConfigured) {
      try {
        videoBuffer = await generateHeyGenAvatarReel(ctx, buildNarration(post, brief), brief?.gancho ?? post.titulo);
      } catch {
        if (geminiKey) {
          try {
            videoBuffer = await generateVeoReelWithFallback(ctx, post, imagemCapaBuffer, brief);
          } catch {
            videoBuffer = await generateFallbackReel(ctx, post, imagemCapaBuffer, brief);
          }
        } else {
          videoBuffer = await generateFallbackReel(ctx, post, imagemCapaBuffer, brief);
        }
      }
    } else if (geminiKey) {
      try {
        videoBuffer = await generateVeoReelWithFallback(ctx, post, imagemCapaBuffer, brief);
      } catch {
        videoBuffer = await generateFallbackReel(ctx, post, imagemCapaBuffer, brief);
      }
    } else {
      videoBuffer = await generateFallbackReel(ctx, post, imagemCapaBuffer, brief);
    }

    const videoUrl = await uploadReelVideo(ctx, videoBuffer, post.slug);
    const { mediaId, permalink } = await publishReelToInstagram(ctx, videoUrl, caption);
    return { ok: true, mediaId, permalink, detalhes: permalink ? `Reel publicado no Instagram: ${permalink}` : `Reel publicado no Instagram (media ${mediaId})` };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, permalink: null, detalhes: `Falha ao publicar no Instagram: ${message}` };
  }
}
