import type { WorkspaceContext } from "../context.js";
import { createHeyGenApiClient, type HeyGenApiClient } from "../harness/heygenApi.js";
import { getReelState, transitionStoredReel, type ReelRecord } from "./state.js";

export type ReconcileOutcome = "still-rendering" | "completed" | "failed" | "inconclusive";

/**
 * Consulta o HeyGen pelo MESMO `videoId` de um Reel e reconcilia o estado
 * local — nunca chama `generate` (nunca cria um vídeo novo) e nunca publica
 * no Instagram. Usado pelo reconciler periódico (`reconcileWorkspaceReels`)
 * e pelo pipeline principal quando encontra um Reel `rendering`/`failed` com
 * `videoId` já existente (`generator.ts`, plano `check-remote`).
 *
 * `pending`/`processing`, timeout de polling, erro de rede — nunca viram
 * `failed` aqui. Só `completed`, `failed`, `cancelled` e `not_found`
 * (respostas terminais confirmadas pelo HeyGen) decidem o resultado.
 */
export async function reconcileReelWithRemote(
  ctx: WorkspaceContext,
  client: HeyGenApiClient,
  record: ReelRecord,
): Promise<{ record: ReelRecord; outcome: ReconcileOutcome }> {
  if (!record.videoId) throw new Error("reconcileReelWithRemote exige um Reel com videoId.");

  let remote: { status: Awaited<ReturnType<HeyGenApiClient["getStatus"]>>["status"]; videoUrl?: string };
  try {
    remote = await client.getStatus(record.videoId);
  } catch {
    // Erro nosso (rede, timeout, HTTP não-404) — nunca decide failed por conta disso.
    // Tenta de novo na próxima execução do reconciler.
    return { record, outcome: "inconclusive" };
  }

  // Recuperação: um `failed` local com o HeyGen respondendo qualquer coisa não-terminal
  // (ou até já `completed`) prova que a falha era nossa (timeout de polling, processo
  // encerrado) — nunca do HeyGen. Sempre passa por `rendering` primeiro, preservando o
  // audit trail (queued -> rendering -> failed -> rendering -> ...) em vez de pular
  // direto pra `pending_approval`, o que a máquina de estados não permite de qualquer forma.
  let current = record;
  if (current.status === "failed" && remote.status !== "failed" && remote.status !== "cancelled" && remote.status !== "not_found") {
    current = await transitionStoredReel(
      ctx, current.id, "rendering", "system",
      "HeyGen ainda processando — falha anterior era de timeout/encerramento local, não do HeyGen.",
      { error: undefined },
    );
  }

  if (remote.status === "queued" || remote.status === "rendering") {
    return { record: current, outcome: "still-rendering" };
  }

  if (remote.status === "completed") {
    if (!remote.videoUrl) return { record: current, outcome: "inconclusive" }; // resposta incompleta — tenta de novo depois.
    const done = await transitionStoredReel(
      ctx, current.id, "pending_approval", "system", "HeyGen concluiu a renderização.",
      { videoUrl: remote.videoUrl, error: undefined },
    );
    return { record: done, outcome: "completed" };
  }

  // failed | cancelled | not_found — falha terminal confirmada pelo HeyGen.
  if (current.status === "failed") return { record: current, outcome: "failed" }; // já estava failed, nada a transicionar de novo.
  const failedRecord = await transitionStoredReel(
    ctx, current.id, "failed", "system", `HeyGen reportou falha terminal (${remote.status}).`,
    { error: `HeyGen: renderização terminou como "${remote.status}".` },
  );
  return { record: failedRecord, outcome: "failed" };
}

export interface ReconcileWorkspaceReelsResult {
  checked: number;
  stillRendering: number;
  completed: number;
  failed: number;
  inconclusive: number;
}

export interface ReconcileWorkspaceReelsOptions {
  client?: HeyGenApiClient;
  log?: (line: string) => void;
}

/** Reconcilia todos os Reels `rendering` do provider `heygen-api` com `videoId` presente. */
export async function reconcileWorkspaceReels(
  ctx: WorkspaceContext,
  options: ReconcileWorkspaceReelsOptions = {},
): Promise<ReconcileWorkspaceReelsResult> {
  const client = options.client ?? createHeyGenApiClient(ctx, ctx.workspace.id);
  const log = options.log ?? console.log;

  const report = await getReelState(ctx);
  const candidates = (report?.entries ?? []).filter(
    (r): r is ReelRecord & { videoId: string } => r.status === "rendering" && r.provider === "heygen-api" && Boolean(r.videoId),
  );

  const result: ReconcileWorkspaceReelsResult = { checked: 0, stillRendering: 0, completed: 0, failed: 0, inconclusive: 0 };
  for (const record of candidates) {
    result.checked++;
    log(`[reel-reconciler] checking workspace=${ctx.workspace.id} reelId=${record.id} videoId=${record.videoId}`);
    const { outcome } = await reconcileReelWithRemote(ctx, client, record);
    if (outcome === "still-rendering") { result.stillRendering++; log("[reel-reconciler] unchanged — still rendering"); }
    else if (outcome === "completed") { result.completed++; log("[reel-reconciler] completed — moved to pending_approval"); }
    else if (outcome === "failed") { result.failed++; log("[reel-reconciler] failed — remote terminal failure"); }
    else { result.inconclusive++; log("[reel-reconciler] inconclusive — will retry next run"); }
  }
  return result;
}
