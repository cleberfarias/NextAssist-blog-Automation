// src/scripts/runGrowthLoop.ts
//
// Entrypoint do Loop de Crescimento: roda o Revenue Director, roteia a
// decisão pra Marketing Director ou Sales Agent, e persiste o resultado.
// Nunca envia mensagem nem publica nada — só prepara trabalho para
// aprovação humana (ver docs/superpowers/specs/2026-09-16-growth-loop-design.md).
import { loadWorkspace } from "../workspace.js";
import { EnvSecretProvider } from "../lib/secrets.js";
import { buildWorkspaceContext } from "../context.js";
import { runGrowthLoop } from "../harness/growthLoopRuntime.js";

const workspaceId = process.env.WORKSPACE_ID ?? "nextassist";

try {
  const workspace = await loadWorkspace(workspaceId);
  const ctx = await buildWorkspaceContext(workspace, new EnvSecretProvider());
  const state = await runGrowthLoop(ctx, (event) => {
    console.log(`[${workspaceId}][${event.agent}] ${event.status}${event.message ? " — " + event.message : ""}`);
  });
  console.log(
    `[growth-loop] workspace=${workspaceId} runId=${state.runId} bottleneck=${state.decision.bottleneck} ` +
    `action=${state.decision.action} outcome=${state.outcome.type}`,
  );
  process.exit(0);
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[growth-loop] workspace=${workspaceId} erro:`, message);
  process.exit(1);
}
