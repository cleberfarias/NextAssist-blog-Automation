import type { WorkspaceContext } from "../context.js";
import type { ContentOpportunity, GenerateContentBacklogOptions } from "../lib/marketingDirector.js";
import { SkillRegistry } from "./registry.js";
import { AgentHarnessRuntime } from "./runtime.js";
import { saveHarnessTrace } from "./traceStore.js";
import {
  GENERATE_CONTENT_BACKLOG_SKILL,
  generateContentBacklogSkill,
  type MarketingDirectorHarnessContext,
} from "./skills/marketingDirectorSkills.js";

const MARKETING_DIRECTOR_BUDGET = {
  maxSteps: 3,
  maxCostUsd: 0.5,
} as const;

export interface MarketingDirectorHarnessResult {
  opportunities: ContentOpportunity[];
  runId: string;
  costUsd: number;
}

/**
 * Executa o Marketing Director existente dentro do Harness.
 *
 * Nesta primeira migração ele possui uma única skill explícita. O ganho aqui é
 * estrutural: autorização, budget e tracing passam a existir antes de ampliar
 * o agente para update_article/change_cta/etc.
 */
export async function runMarketingDirectorBacklog(
  ctx: WorkspaceContext,
  options: GenerateContentBacklogOptions,
): Promise<MarketingDirectorHarnessResult> {
  const registry = new SkillRegistry().register(generateContentBacklogSkill);
  const runtime = new AgentHarnessRuntime({
    registry,
    getCostUsd: () => ctx.usage.get().estimatedUsd,
  });

  const harnessContext: MarketingDirectorHarnessContext = { workspaceContext: ctx };
  const result = await runtime.run<MarketingDirectorHarnessContext, ContentOpportunity[]>(
    {
      workspaceId: ctx.workspace.id,
      agent: "marketing-director",
      goal: "replenish_content_backlog",
      context: harnessContext,
      allowedSkills: [GENERATE_CONTENT_BACKLOG_SKILL],
      budget: MARKETING_DIRECTOR_BUDGET,
    },
    ({ invoke }) => invoke<GenerateContentBacklogOptions, ContentOpportunity[]>(GENERATE_CONTENT_BACKLOG_SKILL, options),
  );

  await saveHarnessTrace(ctx, result.trace);

  if (result.status !== "completed" || !result.output) {
    throw new Error(`Marketing Director bloqueado pelo Harness: ${result.trace.error ?? result.status}`);
  }

  return {
    opportunities: result.output,
    runId: result.runId,
    costUsd: result.costUsd,
  };
}
