// src/scripts/reconcileReels.ts
//
// Entrypoint do reconciler periódico: consulta o HeyGen pelos Reels
// heygen-api que ficaram "rendering" (ver src/reels/reconciler.ts para a
// semântica completa) e persiste o resultado. Nunca chama generate, nunca
// publica no Instagram, nunca roda o pipeline de blog.
import { loadWorkspace } from "../workspace.js";
import { EnvSecretProvider } from "../lib/secrets.js";
import { buildWorkspaceContext } from "../context.js";
import { reconcileWorkspaceReels } from "../reels/reconciler.js";

const workspaceId = process.env.WORKSPACE_ID ?? "nextassist";

try {
  const workspace = await loadWorkspace(workspaceId);
  // requireAiProvider: false — o reconciler não chama runAgent nem depende de
  // OPENAI/ANTHROPIC/Firebase; só precisa de HEYGEN_API_KEY, lido sob demanda
  // por createHeyGenApiClient via ctx.secrets.get.
  const ctx = await buildWorkspaceContext(workspace, new EnvSecretProvider(), { requireAiProvider: false });
  const result = await reconcileWorkspaceReels(ctx);
  console.log(
    `[reel-reconciler] workspace=${workspaceId} checked=${result.checked} ` +
    `completed=${result.completed} failed=${result.failed} stillRendering=${result.stillRendering} inconclusive=${result.inconclusive}`,
  );
  process.exit(0);
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[reel-reconciler] workspace=${workspaceId} erro:`, message);
  process.exit(1);
}
