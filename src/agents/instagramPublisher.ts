import { publishReelToInstagram } from "../lib/instagram.js";
import { executeWithFallback } from "../lib/providerFallback.js";
import { uploadReelVideo } from "../lib/storage.js";
import { generateNarration } from "../lib/tts.js";
import { generateVeoReel } from "../lib/veo.js";
import { generateReelFromImage } from "../lib/video.js";
import { generateHeyGenMcpReel } from "../lib/heygen.js";
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

type VideoStrategy = {
  provider?: "heygen-mcp" | string;
  avatarId?: string;
  voiceId?: string;
  brandKitId?: string;
  format?: "9:16" | "16:9";
  music?: boolean;
  musicVolume?: number;
  requiresApproval?: boolean;
  fallback?: "none" | string;
};

function getVideoStrategy(ctx: WorkspaceContext): VideoStrategy | undefined {
  return (ctx.workspace as typeof ctx.workspace & { videoStrategy?: VideoStrategy }).videoStrategy;
}

const REEL_SYSTEM = (ctx: WorkspaceContext) => `Você é o diretor de Reels do ${ctx.workspace.brand.name}.
Crie conteúdo nativo para Instagram, em português do Brasil, para donos de assistências técnicas de celular.
Seja direto, humano e específico. Não prometa viralização, não use clichês de marketing e não invente dados.
O Reel deve ensinar algo útil em 20 a 35 segundos e estimular comentários.
Responda SOMENTE em JSON neste formato:
{"gancho":"até 12 palavras","roteiro":"fala natural de 45 a 80 palavras","textoTela":["3 a 5 frases curtas para a tela"],"cta":"CTA curto de conversa","pergunta":"pergunta que convida o público a comentar"}`;

export async function createReelBrief(ctx: WorkspaceContext, post: FinalPost): Promise<ReelBrief> {
  const raw = extractJson<ReelBrief>(await runAgent(ctx, {
    system: REEL_SYSTEM(ctx),
    prompt: `Tema do artigo: ${post.titulo}\nResumo: ${post.resumo}\nTags: ${post.tags.join(", ")}\n\nTransforme o tema em uma situação real de balcão, bancada ou gestão. Priorize uma dica aplicável hoje.`,
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
  const caption = [brief?.gancho ?? post.titulo, "", brief?.pergunta ?? post.resumo, "", brief?.cta ?? "Salve para consultar depois e compartilhe com alguém da sua equipe.", "", `📖 Aprofunde no blog (link na bio): ${blogUrl}`, "", hashtags].join("\n");
  return caption.slice(0, 2200);
}

function buildNarration(post: FinalPost, brief?: ReelBrief): string {
  return brief ? `${brief.gancho}. ${brief.roteiro} ${brief.cta}` : `${post.titulo}. Confira o artigo completo, link na bio!`;
}

function buildHeyGenPrompt(ctx: WorkspaceContext, post: FinalPost, brief?: ReelBrief): string {
  const onScreen = brief?.textoTela.join(" | ") ?? post.titulo;
  return [
    "Crie um Reel vertical 9:16 de 25 a 35 segundos em português do Brasil.",
    `Use exclusivamente o avatar e a voz enviados na requisição para representar ${ctx.workspace.brand.name}.`,
    "O apresentador aparece apenas na abertura, em uma passagem curta no meio e no fechamento; evite monólogo estático.",
    "Intercale cenas dinâmicas de assistência técnica, bancada, ordem de serviço, peças, estoque e uso do sistema, com cortes a cada 2 a 4 segundos.",
    `Narração: ${buildNarration(post, brief)}`,
    `Textos de tela: ${onScreen}`,
    "Use legendas dinâmicas, ritmo de Reel e trilha instrumental discreta sem cobrir a voz.",
    "Não invente funcionalidades, métricas, preços ou depoimentos.",
    "Feche convidando o público a conhecer o NextAssist e testar por sete dias, sem publicar o vídeo automaticamente.",
  ].join(" ");
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

export interface InstagramResult {
  ok: boolean;
  mediaId?: string;
  permalink: string | null;
  detalhes: string;
  pendingApproval?: boolean;
  videoUrl?: string;
}

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
    const videoStrategy = getVideoStrategy(ctx);

    if (videoStrategy?.provider === "heygen-mcp") {
      if (!videoStrategy.avatarId || !videoStrategy.voiceId) {
        throw new Error("videoStrategy heygen-mcp exige avatarId e voiceId.");
      }
      if (videoStrategy.fallback !== "none") {
        throw new Error("NextAssist com HeyGen MCP precisa usar fallback=none para proteger avatar e voz configurados.");
      }

      const videoBuffer = await generateHeyGenMcpReel({
        title: `NextAssist - ${post.titulo}`,
        prompt: buildHeyGenPrompt(ctx, post, brief),
        avatarId: videoStrategy.avatarId,
        voiceId: videoStrategy.voiceId,
        brandKitId: videoStrategy.brandKitId,
        aspectRatio: videoStrategy.format ?? "9:16",
        music: videoStrategy.music ?? true,
        musicVolume: videoStrategy.musicVolume,
      });
      const videoUrl = await uploadReelVideo(ctx, videoBuffer, post.slug);

      if (videoStrategy.requiresApproval !== false) {
        return {
          ok: true,
          permalink: null,
          pendingApproval: true,
          videoUrl,
          detalhes: "Reel gerado pelo HeyGen MCP e salvo como rascunho. Aguardando aprovação humana antes de publicar no Instagram.",
        };
      }

      const { mediaId, permalink } = await publishReelToInstagram(ctx, videoUrl, caption);
      return {
        ok: true,
        mediaId,
        permalink,
        videoUrl,
        detalhes: permalink ? `Reel publicado no Instagram: ${permalink}` : `Reel publicado no Instagram (media ${mediaId})`,
      };
    }

    // Fluxo legado permanece disponível apenas para workspaces que NÃO optaram por HeyGen MCP.
    const geminiKey = await ctx.secrets.get(ctx.workspace.id, "GEMINI_API_KEY");
    let videoBuffer: Buffer;
    if (geminiKey) {
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
    return { ok: true, mediaId, permalink, videoUrl, detalhes: permalink ? `Reel publicado no Instagram: ${permalink}` : `Reel publicado no Instagram (media ${mediaId})` };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, permalink: null, detalhes: `Falha ao publicar no Instagram: ${message}` };
  }
}
