import type { WorkspaceContext } from "../context.js";
import { getReelState, transitionStoredReel, type ReelRecord } from "./state.js";

export interface ApprovedReelPublisher {
  publish(input: { videoUrl: string; caption: string }): Promise<{ mediaId: string; permalink: string | null }>;
}

export async function reviewInstagramReel(
  ctx: WorkspaceContext,
  reelId: string,
  decision: "approved" | "rejected",
  note?: string,
): Promise<ReelRecord> {
  return transitionStoredReel(ctx, reelId, decision, "human", note);
}

export async function publishApprovedInstagramReel(
  ctx: WorkspaceContext,
  reelId: string,
  publisher: ApprovedReelPublisher,
): Promise<ReelRecord> {
  const report = await getReelState(ctx);
  const current = report?.entries.find((entry) => entry.id === reelId);
  if (!current) throw new Error("Reel não encontrado.");
  if (current.status !== "approved") throw new Error(`Reel precisa estar approved antes de publicar; status atual: ${current.status}.`);
  if (!current.videoUrl) throw new Error("Reel aprovado não possui videoUrl.");

  await transitionStoredReel(ctx, reelId, "publishing", "system", "Publicação iniciada.");
  try {
    const result = await publisher.publish({ videoUrl: current.videoUrl, caption: current.caption });
    return await transitionStoredReel(ctx, reelId, "published", "system", "Reel publicado.", {
      mediaId: result.mediaId,
      permalink: result.permalink,
      error: undefined,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await transitionStoredReel(ctx, reelId, "failed", "system", "Falha na publicação.", { error: message });
    throw err;
  }
}
