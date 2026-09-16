// src/harness/growthLoopRuntime.ts
import { randomUUID } from "node:crypto";
import type { WorkspaceContext } from "../context.js";
import type { OnEvent } from "../pipelineEvents.js";
import { getAllTopics } from "../contentCalendar.js";
import { replenishContentBacklog } from "../backlog.js";
import { runWorkspaceSalesCopilot, type SalesPipelineRunResult } from "../sales/pipeline.js";
import { runRevenueDirector } from "./revenueDirectorRuntime.js";
import { saveGrowthLoopState, type GrowthLoopOutcome, type GrowthLoopState } from "../growthLoop.js";
import type { RevenueDecision, RevenueSnapshot } from "../revenue/types.js";

const GROWTH_LOOP_CONTENT_COUNT = 3; // pautas por rodada quando acionado por gargalo — não é reabastecimento de calendário, é correção pontual

export type GrowthLoopRoute =
  | { owner: "marketing"; steering: string }
  | { owner: "sales"; steering: string }
  | { owner: "none"; note: string };

function buildSteering(decision: RevenueDecision): string {
  return `Gargalo identificado: ${decision.bottleneck}. Ação recomendada: ${decision.action}. Motivo: ${decision.reason} Evidência: ${decision.evidence.join("; ")}.`;
}

export function routeDecision(decision: RevenueDecision): GrowthLoopRoute {
  const steering = buildSteering(decision);
  switch (decision.action) {
    case "create_content":
    case "improve_cta":
      return { owner: "marketing", steering };
    case "prioritize_hot_leads":
    case "improve_sales_conversion":
      return { owner: "sales", steering };
    case "improve_activation":
      return { owner: "none", note: "Não existe agente de ativação/onboarding no Harness ainda." };
    case "do_nothing":
      return { owner: "none", note: "Revenue Director não identificou gargalo prioritário." };
  }
}

/**
 * Idempotência do branch de Marketing: se já existe algum tópico pendente
 * (não publicado) no calendário gerado para este MESMO bottleneck+action,
 * não gera de novo. Checa direto no calendário — não no histórico de
 * `growth-loop-state.json` — porque depois de um `marketing_skipped` o
 * último estado persistido deixaria de referenciar o `runId` original das
 * pautas ainda pendentes. Assim que uma pauta gerada é publicada (ou
 * removida), ela para de bloquear novas rodadas.
 */
export async function marketingAlreadyHandled(ctx: WorkspaceContext, decision: RevenueDecision): Promise<boolean> {
  const allTopics = await getAllTopics(ctx);
  return allTopics.some(
    (t) => !t.publicado && t.growthLoop?.bottleneck === decision.bottleneck && t.growthLoop?.action === decision.action,
  );
}

export interface RunGrowthLoopOptions {
  /** Pontos de injeção para teste — evitam IA/rede real. Padrão: as implementações reais. */
  revenueDecision?: RevenueDecision;
  revenueSnapshot?: RevenueSnapshot;
  replenish?: typeof replenishContentBacklog;
  composeSales?: (ctx: WorkspaceContext, options: Parameters<typeof runWorkspaceSalesCopilot>[1]) => Promise<SalesPipelineRunResult>;
  generate?: Parameters<typeof replenishContentBacklog>[1]["generate"];
}

export async function runGrowthLoop(
  ctx: WorkspaceContext,
  onEvent?: OnEvent,
  options: RunGrowthLoopOptions = {},
): Promise<GrowthLoopState> {
  const runId = randomUUID();
  const startedAt = new Date().toISOString();

  let snapshot: RevenueSnapshot;
  let decision: RevenueDecision;
  if (options.revenueDecision && options.revenueSnapshot) {
    snapshot = options.revenueSnapshot;
    decision = options.revenueDecision;
  } else {
    const revenue = await runRevenueDirector(ctx);
    snapshot = revenue.snapshot;
    decision = revenue.decision;
  }

  const route = routeDecision(decision);
  const replenish = options.replenish ?? replenishContentBacklog;
  const composeSales = options.composeSales ?? runWorkspaceSalesCopilot;

  const outcome: GrowthLoopOutcome = await (async () => {
    if (route.owner === "marketing") {
      if (await marketingAlreadyHandled(ctx, decision)) {
        return { type: "marketing_skipped", reason: "Mesmo gargalo já tratado e pautas anteriores ainda pendentes." };
      }
      const growthLoopMeta = { bottleneck: decision.bottleneck, action: decision.action, runId };
      const result = await replenish(
        ctx,
        { count: GROWTH_LOOP_CONTENT_COUNT, steering: route.steering, growthLoopMeta, causedBy: runId, generate: options.generate },
        onEvent,
      );
      return { type: "marketing", ...result };
    }
    if (route.owner === "sales") {
      const { entries, outreachCreated, outreachReused } = await composeSales(ctx, { composeOutreach: true, steering: route.steering, causedBy: runId });
      return { type: "sales", leadsAssessed: entries.length, outreachCreated, outreachReused };
    }
    if (decision.action === "do_nothing") return { type: "no_action" };
    return { type: "no_owner", note: route.note };
  })();

  const state: GrowthLoopState = {
    runId, startedAt, completedAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    snapshot, decision, outcome,
  };
  await saveGrowthLoopState(ctx, state);
  return state;
}
