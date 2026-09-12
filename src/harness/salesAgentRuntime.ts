import type { SalesAssessment, SalesLeadContext } from "../sales/types.js";
import { SkillRegistry } from "./registry.js";
import { AgentHarnessRuntime } from "./runtime.js";
import { ASSESS_LEAD_SKILL, assessLeadSkill } from "./skills/salesSkills.js";

const SALES_AGENT_BUDGET = {
  maxSteps: 2,
  maxCostUsd: 0.05,
} as const;

/**
 * Primeira versão do Sales Agent: copilot read-only.
 *
 * Não envia mensagem, não chama CRM e não altera lead. Apenas transforma
 * sinais em uma recomendação auditável. As skills de outreach entrarão depois
 * marcadas com `requiresApproval: true`.
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
