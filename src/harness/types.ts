export type HarnessAgentId = "marketing-director" | "sales-agent" | "revenue-director";

export interface AgentBudget {
  maxSteps: number;
  maxCostUsd: number;
}

export type AgentRunStatus = "completed" | "blocked" | "failed";

export interface TraceStep {
  index: number;
  skill: string;
  startedAt: string;
  finishedAt: string;
  status: "completed" | "failed";
  error?: string;
}

export interface AgentTrace {
  runId: string;
  workspaceId: string;
  agent: HarnessAgentId;
  goal: string;
  startedAt: string;
  finishedAt?: string;
  status: AgentRunStatus;
  steps: TraceStep[];
  costUsd: number;
  error?: string;
}

export interface AgentRunRequest<TContext = unknown> {
  workspaceId: string;
  agent: HarnessAgentId;
  goal: string;
  context: TContext;
  allowedSkills: string[];
  budget: AgentBudget;
}

export interface AgentRunResult<TOutput = unknown> {
  runId: string;
  output?: TOutput;
  steps: number;
  costUsd: number;
  status: AgentRunStatus;
  trace: AgentTrace;
}

export interface SkillExecutionContext<TContext = unknown> {
  runId: string;
  workspaceId: string;
  agent: HarnessAgentId;
  goal: string;
  context: TContext;
}

export interface SkillDefinition<TInput = unknown, TOutput = unknown, TContext = unknown> {
  name: string;
  description?: string;
  requiresApproval?: boolean;
  execute(input: TInput, context: SkillExecutionContext<TContext>): Promise<TOutput>;
}

export interface ApprovalProvider {
  approve(input: {
    runId: string;
    workspaceId: string;
    agent: HarnessAgentId;
    skill: string;
  }): Promise<boolean>;
}
