import { generateContentBacklog, type ContentOpportunity, type GenerateContentBacklogOptions } from "../../lib/marketingDirector.js";
import type { WorkspaceContext } from "../../context.js";
import type { SkillDefinition } from "../types.js";

export const GENERATE_CONTENT_BACKLOG_SKILL = "marketing.generate_content_backlog";

export interface MarketingDirectorHarnessContext {
  workspaceContext: WorkspaceContext;
}

/**
 * Skill adapter do Marketing Director existente.
 *
 * A lógica de decisão continua em lib/marketingDirector.ts; o Harness passa a
 * controlar autorização, budget e tracing. Isso permite migrar o pipeline sem
 * reescrever a regra de negócio que já está em produção.
 */
export const generateContentBacklogSkill: SkillDefinition<
  GenerateContentBacklogOptions,
  ContentOpportunity[],
  MarketingDirectorHarnessContext
> = {
  name: GENERATE_CONTENT_BACKLOG_SKILL,
  description: "Analisa sinais de SEO/conversão e gera oportunidades priorizadas de conteúdo.",
  async execute(input, execution) {
    return generateContentBacklog(execution.context.workspaceContext, input);
  },
};
