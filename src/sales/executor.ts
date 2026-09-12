import type { WorkspaceContext } from "../context.js";
import { runApprovedSalesExecution, type SalesExecutionRequest } from "../harness/salesExecutionRuntime.js";
import { getSalesState, recordSalesExecution } from "./state.js";
import type { SalesExecutionRecord } from "./types.js";
import type { SalesTransports } from "./transports.js";

export async function executeSalesAction(input: {
  ctx: WorkspaceContext;
  leadId: string;
  request: SalesExecutionRequest;
  transports: SalesTransports;
}): Promise<SalesExecutionRecord> {
  const report = await getSalesState(input.ctx);
  if (!report) throw new Error("Estado comercial ainda não foi gerado para este workspace.");
  const entry = report.entries.find((item) => item.lead.leadId === input.leadId);
  if (!entry) throw new Error("Lead não encontrado no estado comercial.");
  if (entry.review?.status !== "approved") throw new Error("Execução comercial exige aprovação humana prévia.");

  const execution = await runApprovedSalesExecution({
    workspaceId: input.ctx.workspace.id,
    entry,
    request: input.request,
    transports: input.transports,
  });

  await recordSalesExecution(input.ctx, input.leadId, execution);
  return execution;
}
