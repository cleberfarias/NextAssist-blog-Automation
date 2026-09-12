import { randomUUID } from "node:crypto";
import { SkillRegistry } from "./registry.js";
import type {
  AgentRunRequest,
  AgentRunResult,
  AgentTrace,
  ApprovalProvider,
  SkillExecutionContext,
} from "./types.js";

export interface HarnessRuntimeOptions {
  registry: SkillRegistry;
  approvalProvider?: ApprovalProvider;
  getCostUsd?: () => number;
}

export interface AgentExecutionApi<TContext> {
  invoke<TInput, TOutput>(skillName: string, input: TInput): Promise<TOutput>;
  context: SkillExecutionContext<TContext>;
}

export class AgentHarnessRuntime {
  constructor(private readonly options: HarnessRuntimeOptions) {}

  async run<TContext, TOutput>(
    request: AgentRunRequest<TContext>,
    executor: (api: AgentExecutionApi<TContext>) => Promise<TOutput>,
  ): Promise<AgentRunResult<TOutput>> {
    const runId = randomUUID();
    const startedAt = new Date().toISOString();
    const startingCost = this.options.getCostUsd?.() ?? 0;
    let steps = 0;

    const trace: AgentTrace = {
      runId,
      workspaceId: request.workspaceId,
      agent: request.agent,
      goal: request.goal,
      startedAt,
      status: "completed",
      steps: [],
      costUsd: 0,
    };

    const executionContext: SkillExecutionContext<TContext> = {
      runId,
      workspaceId: request.workspaceId,
      agent: request.agent,
      goal: request.goal,
      context: request.context,
    };

    const currentCost = () => Math.max(0, (this.options.getCostUsd?.() ?? startingCost) - startingCost);

    const invoke = async <TInput, TSkillOutput>(skillName: string, input: TInput): Promise<TSkillOutput> => {
      if (!request.allowedSkills.includes(skillName)) {
        throw new Error(`Skill não autorizada para ${request.agent}: ${skillName}`);
      }
      if (steps >= request.budget.maxSteps) {
        throw new Error(`Budget de steps excedido (${request.budget.maxSteps}).`);
      }
      if (currentCost() >= request.budget.maxCostUsd) {
        throw new Error(`Budget de custo excedido (US$ ${request.budget.maxCostUsd.toFixed(4)}).`);
      }

      const skill = this.options.registry.get(skillName);
      if (skill.requiresApproval) {
        if (!this.options.approvalProvider) throw new Error(`Skill ${skillName} exige aprovação humana.`);
        const approved = await this.options.approvalProvider.approve({
          runId,
          workspaceId: request.workspaceId,
          agent: request.agent,
          skill: skillName,
        });
        if (!approved) throw new Error(`Execução bloqueada por aprovação: ${skillName}`);
      }

      const index = ++steps;
      const stepStartedAt = new Date().toISOString();
      try {
        const output = await skill.execute(input, executionContext);
        trace.steps.push({
          index,
          skill: skillName,
          startedAt: stepStartedAt,
          finishedAt: new Date().toISOString(),
          status: "completed",
        });
        if (currentCost() > request.budget.maxCostUsd) {
          throw new Error(`Budget de custo excedido após ${skillName} (US$ ${request.budget.maxCostUsd.toFixed(4)}).`);
        }
        return output as TSkillOutput;
      } catch (error) {
        trace.steps.push({
          index,
          skill: skillName,
          startedAt: stepStartedAt,
          finishedAt: new Date().toISOString(),
          status: "failed",
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    };

    try {
      const output = await executor({ invoke, context: executionContext });
      trace.finishedAt = new Date().toISOString();
      trace.costUsd = currentCost();
      return { runId, output, steps, costUsd: trace.costUsd, status: "completed", trace };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      trace.finishedAt = new Date().toISOString();
      trace.costUsd = currentCost();
      trace.error = message;
      trace.status = /não autorizada|aprovação|Budget/.test(message) ? "blocked" : "failed";
      return { runId, steps, costUsd: trace.costUsd, status: trace.status, trace };
    }
  }
}
