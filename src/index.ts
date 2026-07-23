import { runPipeline, type PipelineEvent } from "./pipeline.js";
import { appendRun, type RunRecord, type RunStatus } from "./runsHistory.js";

/**
 * Entrada da CLI (usada pelo GitHub Actions). Além de rodar o pipeline,
 * grava um registro detalhado da execução em `runs-history.json` — tanto em
 * sucesso quanto em falha — para o painel acompanhar cada agente e confirmar
 * se o post foi publicado. A Action commita esse arquivo de volta.
 */
const eventos: PipelineEvent[] = [];
const iniciadoEm = new Date().toISOString();
const origem = process.env.GITHUB_ACTIONS === "true" ? "action" : "manual";

function finalize(status: RunStatus, tema: string | null, slug: string | null, erro: string | null) {
  const record: RunRecord = {
    id: iniciadoEm,
    origem,
    iniciadoEm,
    finalizadoEm: new Date().toISOString(),
    tema,
    status,
    slug,
    erro,
    eventos,
  };
  return appendRun(record);
}

try {
  const result = await runPipeline((event) => {
    console.log(`[${event.agent}] ${event.status}${event.message ? " — " + event.message : ""}`);
    eventos.push(event);
  });

  if (result) {
    console.log(`Post publicado: /blog/${result.slugPublicado}`);
    await finalize("publicado", result.tema, result.slugPublicado, null);
  } else {
    console.log("Nenhum tópico pendente no calendário.");
    await finalize("sem-tema", null, null, null);
  }
  process.exit(0);
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  console.error("Falha no pipeline:", message);
  const tema = eventos.find((e) => e.tema)?.tema ?? null;
  await finalize("falhou", tema, null, message);
  process.exit(1);
}
