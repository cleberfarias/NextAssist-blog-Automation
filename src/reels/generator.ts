import type { WorkspaceContext } from "../context.js";
import type { FinalPost } from "../agents/editorSeo.js";
import type { MarketingWorkspace } from "../workspace.js";
import { generateHeyGenMcpReel } from "../lib/heygen.js";
import { createHeyGenApiClient } from "../harness/heygenApi.js";
import { selectHeyGenProvider, type HeyGenProviderName } from "../lib/heygenProvider.js";
import { uploadReelVideo } from "../lib/storage.js";
import { reconcileReelWithRemote } from "./reconciler.js";
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

/**
 * heygen-mcp é síncrono: gera, espera o buffer, sobe pro storage e volta
 * `pending_approval` na mesma chamada — o MCP já resolve isso do lado dele.
 */
async function renderWithHeyGenMcp(strategy: VideoStrategy, post: FinalPost, input: ReelDraftInput): Promise<Buffer> {
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

/**
 * Gera o Reel e persiste o rascunho — nunca publica no Instagram. Publicação
 * é uma ação humana separada (ver `reels/publisher.ts`).
 *
 * heygen-mcp continua síncrono (gera, espera, sobe pro storage, `pending_approval`
 * na mesma chamada). heygen-api é assíncrono: só ENVIA o vídeo pro HeyGen, persiste
 * `rendering` + `videoId` e retorna — quem confirma a conclusão é o reconciler
 * periódico (`src/reels/reconciler.ts`, `.github/workflows/reconcile-reels.yml`),
 * nunca o pipeline principal. Isso evita o pipeline ficar bloqueado esperando uma
 * renderização que pode levar vários minutos.
 *
 * Idempotente por `${workspace.id}:${post.slug}` (`planReelGeneration`, `src/reels/state.ts`):
 * pending_approval/approved/publishing/published/rejected nunca são tocados;
 * rendering/failed com `videoId` consultam o HeyGen antes de qualquer coisa —
 * nunca chamam `generate` de novo; só queued (nunca renderizou) ou failed sem
 * `videoId` partem pra um `generate` novo.
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

  if (plan.action === "check-remote") {
    // Nunca chama generate aqui — só consulta o HeyGen pelo videoId já existente
    // e reconcilia (ver reconciler.ts para a semântica completa dos estados).
    const client = createHeyGenApiClient(ctx, ctx.workspace.id);
    const { record } = await reconcileReelWithRemote(ctx, client, plan.record);
    return record;
  }

  let record: ReelRecord;
  if (plan.action === "retry") {
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

  if (provider === "heygen-mcp") {
    try {
      const videoBuffer = await renderWithHeyGenMcp(strategy, post, input);
      const videoUrl = await uploadReelVideo(ctx, videoBuffer, post.slug);
      return await transitionStoredReel(ctx, reelId, "pending_approval", "system", "Renderização concluída; aguardando revisão humana.", { videoUrl, error: undefined });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await transitionStoredReel(ctx, reelId, "failed", "system", "Falha na renderização do Reel.", { error: message });
      throw err;
    }
  }

  // heygen-api: só envia e retorna. Nunca espera o vídeo terminar aqui.
  if (!input.script?.trim()) throw new Error("HeyGen API exige um script (roteiro falado) para gerar o vídeo.");
  try {
    const client = createHeyGenApiClient(ctx, ctx.workspace.id);
    const { videoId } = await client.generate({
      title: `NextAssist - ${post.titulo}`,
      script: input.script,
      avatarId: strategy.avatarId,
      voiceId: strategy.voiceId,
      aspectRatio: strategy.format ?? "9:16",
    });
    return await patchStoredReel(ctx, reelId, { videoId });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await transitionStoredReel(ctx, reelId, "failed", "system", "Falha ao enviar o Reel para o HeyGen.", { error: message });
    throw err;
  }
}
