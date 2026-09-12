import type { SalesExecutionRecord, SalesPipelineEntry } from "../sales/types.js";
import type { SalesTransports } from "../sales/transports.js";
import { AgentHarnessRuntime } from "./runtime.js";
import { SkillRegistry } from "./registry.js";
import type { AgentTrace } from "./types.js";
import {
  SEND_EMAIL_SKILL,
  SEND_WHATSAPP_SKILL,
  sendEmailSkill,
  sendWhatsAppSkill,
  type SalesExecutionHarnessContext,
} from "./skills/salesExecutionSkills.js";

export type SalesExecutionRequest =
  | { action: "send_email"; to: string }
  | { action: "send_whatsapp"; to: string };

export async function runApprovedSalesExecution(input: {
  workspaceId: string;
  entry: SalesPipelineEntry;
  request: SalesExecutionRequest;
  transports: SalesTransports;
  onTrace?: (trace: AgentTrace) => Promise<void>;
}): Promise<SalesExecutionRecord> {
  const registry = new SkillRegistry()
    .register(sendEmailSkill)
    .register(sendWhatsAppSkill);

  const allowedSkill = input.request.action === "send_email" ? SEND_EMAIL_SKILL : SEND_WHATSAPP_SKILL;
  const context: SalesExecutionHarnessContext = { entry: input.entry, transports: input.transports };

  const runtime = new AgentHarnessRuntime({
    registry,
    approvalProvider: {
      async approve() {
        return input.entry.review?.status === "approved";
      },
    },
  });

  const result = await runtime.run<SalesExecutionHarnessContext, SalesExecutionRecord>(
    {
      workspaceId: input.workspaceId,
      agent: "sales-agent",
      goal: "execute_human_approved_sales_outreach",
      context,
      allowedSkills: [allowedSkill],
      budget: { maxSteps: 1, maxCostUsd: 0.01 },
    },
    ({ invoke }) => invoke<{ to: string }, SalesExecutionRecord>(allowedSkill, { to: input.request.to }),
  );

  if (input.onTrace) await input.onTrace(result.trace);

  if (result.status !== "completed" || !result.output) {
    throw new Error(`Execução comercial bloqueada pelo Harness: ${result.trace.error ?? result.status}`);
  }

  return result.output;
}
