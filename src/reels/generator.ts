import type { WorkspaceContext } from "../context.js";
import type { FinalPost } from "../agents/editorSeo.js";
import { generateHeyGenMcpReel } from "../lib/heygen.js";
import { uploadReelVideo } from "../lib/storage.js";
import { createQueuedReel, transitionStoredReel, type ReelRecord } from "./state.js";

export interface ReelDraftInput {
  caption: string;
  prompt: string;
}

export async function generateInstagramReelDraft(
  ctx: WorkspaceContext,
  post: FinalPost,
  blogUrl: string,
  input: ReelDraftInput,
): Promise<ReelRecord> {
  const strategy = ctx.workspace.videoStrategy;
  if (!strategy || strategy.provider !== "heygen-mcp") throw new Error("Workspace não configurado para HeyGen MCP.");
  if (!strategy.avatarId || !strategy.voiceId) throw new Error("videoStrategy heygen-mcp exige avatarId e voiceId.");
  if (strategy.fallback !== "none") throw new Error("HeyGen MCP exige fallback=none.");
  if (strategy.requiresApproval !== true) throw new Error("HeyGen MCP exige aprovação humana obrigatória.");

  const reelId = `${ctx.workspace.id}:${post.slug}`;
  await createQueuedReel(ctx, {
    id: reelId,
    workspaceId: ctx.workspace.id,
    slug: post.slug,
    title: post.titulo,
    blogUrl,
    caption: input.caption,
    provider: "heygen-mcp",
    avatarId: strategy.avatarId,
    voiceId: strategy.voiceId,
  });

  await transitionStoredReel(ctx, reelId, "rendering", "system", "Renderização iniciada no HeyGen MCP.");
  try {
    const videoBuffer = await generateHeyGenMcpReel({
      title: `NextAssist - ${post.titulo}`,
      prompt: input.prompt,
      avatarId: strategy.avatarId,
      voiceId: strategy.voiceId,
      brandKitId: strategy.brandKitId,
      aspectRatio: strategy.format ?? "9:16",
      music: strategy.music ?? true,
      musicVolume: strategy.musicVolume,
    });
    const videoUrl = await uploadReelVideo(ctx, videoBuffer, post.slug);
    return await transitionStoredReel(ctx, reelId, "pending_approval", "system", "Renderização concluída; aguardando revisão humana.", { videoUrl, error: undefined });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await transitionStoredReel(ctx, reelId, "failed", "system", "Falha na renderização do Reel.", { error: message });
    throw err;
  }
}
