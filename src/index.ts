// src/index.ts
import { runPipeline, type PipelineEvent } from "./pipeline.js";
import { appendRun, type RunRecord, type RunStatus } from "./runsHistory.js";
import { loadWorkspace } from "./workspace.js";
import { EnvSecretProvider } from "./lib/secrets.js";
import { buildWorkspaceContext, type AnthropicUsage } from "./context.js";
import { pushEventToPanel } from "./lib/panelIngest.js";

const workspaceId = process.env.WORKSPACE_ID ?? "nextassist";
const eventos: PipelineEvent[] = [];
const iniciadoEm = new Date().toISOString();
const origem = process.env.GITHUB_ACTIONS === "true" ? "action" : "manual";

const ctx = await (async () => {
  try {
    const workspace = await loadWorkspace(workspaceId);
    return await buildWorkspaceContext(workspace, new EnvSecretProvider());
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Falha ao resolver o workspace "${workspaceId}":`, message);
    process.exit(1);
  }
})();

/** Grava o registro de execução, reaproveitando o mesmo WorkspaceContext da execução. */
function finalize(status: RunStatus, tema: string | null, slug: string | null, erro: string | null, usage?: AnthropicUsage) {
  const record: RunRecord = {
    id: iniciadoEm, origem, iniciadoEm, finalizadoEm: new Date().toISOString(),
    tema, status, slug, erro, eventos, usage,
  };
  return appendRun(ctx, record);
}

try {
  const result = await runPipeline(ctx, (event) => {
    console.log(`[${workspaceId}][${event.agent}] ${event.status}${event.message ? " — " + event.message : ""}`);
    eventos.push(event);
    void pushEventToPanel(workspaceId, event);
  });

  if (result) {
    console.log(`Post publicado: /blog/${result.slugPublicado}`);
    await finalize("publicado", result.tema, result.slugPublicado, null, result.usage);
  } else {
    console.log("Nenhum tópico pendente no calendário.");
    await finalize("sem-tema", null, null, null, undefined);
  }
  process.exit(0);
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  console.error("Falha no pipeline:", message);
  const tema = eventos.find((e) => e.tema)?.tema ?? null;
  const usage = (err as Error & { usage?: AnthropicUsage }).usage;
  await finalize("falhou", tema, null, message, usage);
  process.exit(1);
}
