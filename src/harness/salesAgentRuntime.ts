import type { WorkspaceContext } from "../context.js";
import type { SalesAssessment, SalesLeadContext, SalesOutreachDraft } from "../sales/types.js";
import { SkillRegistry } from "./registry.js";
import { AgentHarnessRuntime } from "./runtime.js";
import { ASSESS_LEAD_SKILL, assessLeadSkill } from "./skills/salesSkills.js";
import {
  COMPOSE_OUTREACH_SKILL,
  composeOutreachSkill,
  type SalesOutreachHarnessContext,
} from "./skills/salesOutreachSkills.js";

const SALES_AGENT_BUDGET = {
  maxSteps: 3,
  maxCostUsd: 0.15,
} as const;

/**
 * Primeira versão do Sales Agent: scoring read-only e abordagem em modo
 * copilot. Nenhuma skill de envio está registrada neste runtime.
 */
export async function runSalesCopilot(
  workspaceId: string,
  lead: SalesLeadContext,
): Promise<SalesAssessment> {
  const registry = new SkillRegistry().register(assessLeadSkill);
  const runtime = new AgentHarnessRuntime({ registry });

  const result = await runtime.run<Record<string, never>, SalesAssessment>(
    {
      workspaceId,
      agent: "sales-agent",
      goal: "assess_lead_and_recommend_next_action",
      context: {},
      allowedSkills: [ASSESS_LEAD_SKILL],
      budget: SALES_AGENT_BUDGET,
    },
    ({ invoke }) => invoke<SalesLeadContext, SalesAssessment>(ASSESS_LEAD_SKILL, lead),
  );

  if (result.status !== "completed" || !result.output) {
    throw new Error(`Sales Agent bloqueado pelo Harness: ${result.trace.error ?? result.status}`);
  }

  return result.output;
}

/**
 * Usa o LLM apenas para redigir uma sugestão de abordagem depois que o score
 * determinístico já foi calculado. A saída é sempre um rascunho marcado para
 * aprovação humana; nenhuma integração externa é chamada aqui.
 */
export async function runSalesOutreachCopilot(
  ctx: WorkspaceContext,
  lead: SalesLeadContext,
  assessment: SalesAssessment,
): Promise<SalesOutreachDraft> {
  const registry = new SkillRegistry()
    .register(assessLeadSkill)
    .register(composeOutreachSkill);
  const runtime = new AgentHarnessRuntime({
    registry,
    getCostUsd: () => ctx.usage.get().estimatedUsd,
  });
  const harnessContext: SalesOutreachHarnessContext = { workspaceContext: ctx };

  const result = await runtime.run<SalesOutreachHarnessContext, SalesOutreachDraft>(
    {
      workspaceId: ctx.workspace.id,
      agent: "sales-agent",
      goal: "compose_contextual_outreach_for_human_approval",
      context: harnessContext,
      allowedSkills: [COMPOSE_OUTREACH_SKILL],
      budget: SALES_AGENT_BUDGET,
    },
    ({ invoke }) => invoke(COMPOSE_OUTREACH_SKILL, { lead, assessment }),
  );

  if (result.status !== "completed" || !result.output) {
    throw new Error(`Sales Agent não conseguiu compor abordagem: ${result.trace.error ?? result.status}`);
  }

  return result.output;
}
