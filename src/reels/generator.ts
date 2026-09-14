import type { WorkspaceContext } from "../context.js";
import type { FinalPost } from "../agents/editorSeo.js";
import type { MarketingWorkspace } from "../workspace.js";
import { generateHeyGenMcpReel } from "../lib/heygen.js";
import { createHeyGenApiClient, pollHeyGenApiVideo, resolveHeyGenApiVideoId } from "../harness/heygenApi.js";
import { selectHeyGenProvider, type HeyGenProviderName } from "../lib/heygenProvider.js";
import { uploadReelVideo } from "../lib/storage.js";
import { createQueuedReel, findReel, patchStoredReel, planReelGeneration, transitionStoredReel, type ReelRecord } from "./state.js";

export interface ReelDraftInput {
  caption: string;
  prompt: string;
  /** Roteiro falado — exigido pelo provider heygen-api (`/v3/videos` usa `script`, não um prompt livre como o MCP). */
  script?: string;
}

type VideoStrategy = NonNullable<MarketingWorkspace["videoStrategy"]>;

function providerLabel(provider: HeyGenProviderName): string {
  return provider === "heygen-mcp" ? "HeyGen MCP" : "HeyGen API";
}

async function renderReelVideo(
  ctx: WorkspaceContext,
  reelId: string,
  provider: HeyGenProviderName,
  strategy: VideoStrategy,
  post: FinalPost,
  input: ReelDraftInput,
  record: ReelRecord,
): Promise<Buffer> {
  if (provider === "heygen-mcp") {
    return generateHeyGenMcpReel({
      title: `NextAssist - ${post.titulo}`,
      prompt: input.prompt,
      avatarId: strategy.avatarId,
      voiceId: strategy.voiceId,
      brandKitId: strategy.brandKitId,
      aspectRatio: strategy.format ?? "9:16",
      music: strategy.music ?? true,
      musicVolume: strategy.musicVolume,
    });
  }

  if (!input.script?.trim()) throw new Error("HeyGen API exige um script (roteiro falado) para gerar o vídeo.");
  const client = createHeyGenApiClient(ctx, ctx.workspace.id);
  // Reusa o videoId já persistido (retomada após falha/crash) — nunca inicia
  // um segundo vídeo só porque uma consulta de status demorou ou o processo
  // caiu no meio do polling.
  const videoId = await resolveHeyGenApiVideoId(
    client,
    {
      title: `NextAssist - ${post.titulo}`,
      script: input.script,
      avatarId: strategy.avatarId,
      voiceId: strategy.voiceId,
      aspectRatio: strategy.format ?? "9:16",
    },
    record.videoId,
    (id) => patchStoredReel(ctx, reelId, { videoId: id }).then(() => undefined),
  );
  const { videoUrl } = await pollHeyGenApiVideo(client, videoId);
  const response = await fetch(videoUrl);
  if (!response.ok) throw new Error(`HeyGen API: download do vídeo falhou (${response.status}).`);
  return Buffer.from(await response.arrayBuffer());
}

/**
 * Gera o Reel e persiste o rascunho como `pending_approval` — nunca publica
 * no Instagram. Publicação é uma ação humana separada (ver `reels/publisher.ts`).
 *
 * Idempotente por `${workspace.id}:${post.slug}`: uma reexecução do pipeline
 * para o mesmo slug NUNCA reseta um Reel que já está em pending_approval,
 * approved, publishing, published ou rejected (decisão humana ou publicação
 * em andamento) — devolve o registro existente sem tocar nele. Se estiver
 * rendering, retoma o mesmo `videoId` em vez de gerar outro vídeo. Se estiver
 * queued (nunca chegou a renderizar) ou failed, tenta de novo preservando o
 * histórico de audit.
 */
export async function generateInstagramReelDraft(
  ctx: WorkspaceContext,
  post: FinalPost,
  blogUrl: string,
  input: ReelDraftInput,
): Promise<ReelRecord> {
  const strategy = ctx.workspace.videoStrategy;
  if (!strategy) throw new Error("Workspace não configurado para HeyGen.");
  const provider = selectHeyGenProvider(strategy, "headless");
  if (!provider) throw new Error("Workspace não configurado para HeyGen.");
  if (!strategy.avatarId || !strategy.voiceId) throw new Error(`videoStrategy ${provider} exige avatarId e voiceId.`);
  if (strategy.fallback !== "none") throw new Error(`HeyGen ${provider} exige fallback=none.`);
  if (strategy.requiresApproval !== true) throw new Error("HeyGen exige aprovação humana obrigatória.");

  const reelId = `${ctx.workspace.id}:${post.slug}`;
  const plan = planReelGeneration(await findReel(ctx, reelId));

  if (plan.action === "protected") return plan.record;

  let record: ReelRecord;
  if (plan.action === "resume-rendering") {
    record = plan.record;
  } else if (plan.action === "retry") {
    if (plan.record.status === "failed") {
      await transitionStoredReel(ctx, reelId, "queued", "system", "Nova tentativa após falha anterior.", {
        caption: input.caption, provider, avatarId: strategy.avatarId, voiceId: strategy.voiceId, error: undefined, videoId: undefined,
      });
    }
    record = await transitionStoredReel(ctx, reelId, "rendering", "system", `Renderização iniciada no ${providerLabel(provider)}.`);
  } else {
    await createQueuedReel(ctx, {
      id: reelId,
      workspaceId: ctx.workspace.id,
      slug: post.slug,
      title: post.titulo,
      blogUrl,
      caption: input.caption,
      provider,
      avatarId: strategy.avatarId,
      voiceId: strategy.voiceId,
    });
    record = await transitionStoredReel(ctx, reelId, "rendering", "system", `Renderização iniciada no ${providerLabel(provider)}.`);
  }

  try {
    const videoBuffer = await renderReelVideo(ctx, reelId, provider, strategy, post, input, record);
    const videoUrl = await uploadReelVideo(ctx, videoBuffer, post.slug);
    return await transitionStoredReel(ctx, reelId, "pending_approval", "system", "Renderização concluída; aguardando revisão humana.", { videoUrl, error: undefined });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await transitionStoredReel(ctx, reelId, "failed", "system", "Falha na renderização do Reel.", { error: message });
    throw err;
  }
}
