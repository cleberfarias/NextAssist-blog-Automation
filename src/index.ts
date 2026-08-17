// src/index.ts
import { runPipeline, type PipelineEvent } from "./pipeline.js";
import { appendRun, type RunRecord } from "./runsHistory.js";
import { loadWorkspace } from "./workspace.js";
import { EnvSecretProvider } from "./lib/secrets.js";
import { buildWorkspaceContext, type AnthropicUsage } from "./context.js";
import { pushEventToPanel } from "./lib/panelIngest.js";

const workspaceId = process.env.WORKSPACE_ID ?? "nextassist";
const eventos: PipelineEvent[] = [];
const iniciadoEm = new Date().toISOString();
const origem = process.env.GITHUB_ACTIONS === "true" ? "action" : "manual";

/** Grava o registro de execução para os dois desfechos que não lançam (publicado / sem tópico). */
async function finalize(status: "publicado" | "sem-tema", tema: string | null, slug: string | null, usage?: AnthropicUsage) {
  const workspace = await loadWorkspace(workspaceId);
  const ctx = await buildWorkspaceContext(workspace, new EnvSecretProvider());
  const record: RunRecord = {
    id: iniciadoEm, origem, iniciadoEm, finalizadoEm: new Date().toISOString(),
    tema, status, slug, erro: null, eventos, usage,
  };
  return appendRun(ctx, record);
}

try {
  const result = await runPipeline(workspaceId, (event) => {
    console.log(`[${workspaceId}][${event.agent}] ${event.status}${event.message ? " — " + event.message : ""}`);
    eventos.push(event);
    void pushEventToPanel(workspaceId, event);
  });

  if (result) {
    console.log(`Post publicado: /blog/${result.slugPublicado}`);
    await finalize("publicado", result.tema, result.slugPublicado, result.usage);
  } else {
    console.log("Nenhum tópico pendente no calendário.");
    await finalize("sem-tema", null, null, undefined);
  }
  process.exit(0);
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  console.error("Falha no pipeline:", message);
  const tema = eventos.find((e) => e.tema)?.tema ?? null;
  const usage = (err as Error & { usage?: AnthropicUsage }).usage;
  // Se a falha original foi justamente workspace inválido / credencial ausente,
  // essa recuperação também falha — não deixe isso virar unhandled rejection.
  try {
    const workspace = await loadWorkspace(workspaceId);
    const ctx = await buildWorkspaceContext(workspace, new EnvSecretProvider());
    await appendRun(ctx, {
      id: iniciadoEm, origem, iniciadoEm, finalizadoEm: new Date().toISOString(),
      tema, status: "falhou", slug: null, erro: message, eventos, usage,
    });
  } catch (recoveryErr) {
    const recoveryMessage = recoveryErr instanceof Error ? recoveryErr.message : String(recoveryErr);
    console.error("Não foi possível registrar a execução que falhou:", recoveryMessage);
    console.error("Erro original do pipeline:", message);
  }
  process.exit(1);
}
