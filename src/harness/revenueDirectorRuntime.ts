import type { WorkspaceContext } from "../context.js";
import { computeAttribution } from "../attribution.js";
import { getSalesState } from "../sales/state.js";
import { buildRevenueSnapshot } from "../revenue/director.js";
import type { RevenueDecision, RevenueSnapshot } from "../revenue/types.js";
import { SkillRegistry } from "./registry.js";
import { AgentHarnessRuntime } from "./runtime.js";
import { saveHarnessTrace } from "./traceStore.js";
import {
  DECIDE_REVENUE_ACTION_SKILL,
  decideRevenueActionSkill,
} from "./skills/revenueDirectorSkills.js";

export interface RevenueDirectorResult {
  snapshot: RevenueSnapshot;
  decision: RevenueDecision;
  runId: string;
}

export async function runRevenueDirector(ctx: WorkspaceContext): Promise<RevenueDirectorResult> {
  const [attribution, sales] = await Promise.all([
    computeAttribution(ctx),
    getSalesState(ctx),
  ]);
  const snapshot = buildRevenueSnapshot(attribution, sales);

  const registry = new SkillRegistry().register(decideRevenueActionSkill);
  const runtime = new AgentHarnessRuntime({ registry });
  const result = await runtime.run<Record<string, never>, RevenueDecision>(
    {
      workspaceId: ctx.workspace.id,
      agent: "revenue-director",
      goal: "identify_revenue_bottleneck_and_choose_next_action",
      context: {},
      allowedSkills: [DECIDE_REVENUE_ACTION_SKILL],
      budget: { maxSteps: 1, maxCostUsd: 0.01 },
    },
    ({ invoke }) => invoke<RevenueSnapshot, RevenueDecision>(DECIDE_REVENUE_ACTION_SKILL, snapshot),
  );

  await saveHarnessTrace(ctx, result.trace);

  if (result.status !== "completed" || !result.output) {
    throw new Error(`Revenue Director bloqueado pelo Harness: ${result.trace.error ?? result.status}`);
  }

  return { snapshot, decision: result.output, runId: result.runId };
}
