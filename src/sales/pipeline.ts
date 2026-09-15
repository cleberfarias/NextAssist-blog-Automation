import type { WorkspaceContext } from "../context.js";
import { runSalesCopilot, runSalesOutreachCopilot } from "../harness/salesAgentRuntime.js";
import { getSalesLeads } from "./funnel.js";
import { saveSalesState } from "./state.js";
import type { SalesAssessment, SalesPipelineEntry } from "./types.js";

export interface SalesPipelineOptions {
  composeOutreach?: boolean;
  maxLeads?: number;
}

export function shouldComposeOutreach(assessment: SalesAssessment): boolean {
  return assessment.intent === "high" && assessment.nextAction === "request_human_contact";
}

/**
 * Analisa o funil comercial real do workspace.
 *
 * - lê conversion-events existentes;
 * - reconstrói leads por identidade;
 * - aplica scoring determinístico via Harness;
 * - opcionalmente gera rascunho com IA somente para leads de alta intenção;
 * - persiste o snapshot comercial por workspace para consumo do painel;
 * - nunca envia mensagem nem altera CRM/lead.
 */
export async function runWorkspaceSalesCopilot(
  ctx: WorkspaceContext,
  options: SalesPipelineOptions = {},
): Promise<SalesPipelineEntry[]> {
  const maxLeads = Math.max(1, options.maxLeads ?? 50);
  const leads = (await getSalesLeads(ctx)).slice(0, maxLeads);
  const results: SalesPipelineEntry[] = [];

  // Sequencial de propósito: evita burst de chamadas de IA caso vários leads
  // quentes sejam encontrados ao mesmo tempo.
  for (const lead of leads) {
    const assessment = await runSalesCopilot(ctx.workspace.id, lead);
    const entry: SalesPipelineEntry = { lead, assessment };

    if (options.composeOutreach && shouldComposeOutreach(assessment)) {
      entry.outreach = await runSalesOutreachCopilot(ctx, lead, assessment);
    }

    results.push(entry);
  }

  const sorted = results.sort((a, b) => b.assessment.score - a.assessment.score);
  await saveSalesState(ctx, sorted);
  return sorted;
}
