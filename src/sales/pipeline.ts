import type { WorkspaceContext } from "../context.js";
import { runSalesCopilot, runSalesOutreachCopilot } from "../harness/salesAgentRuntime.js";
import { getSalesLeads } from "./funnel.js";
import { getSalesState, saveSalesState } from "./state.js";
import type { SalesAssessment, SalesOutreachDraft, SalesPipelineEntry } from "./types.js";

export interface SalesPipelineOptions {
  composeOutreach?: boolean;
  maxLeads?: number;
  /** Texto do Revenue Director quando este run foi disparado por um gargalo do funil (Loop de Crescimento). */
  steering?: string;
  /** `GrowthLoopState.runId`, propagado até o trace do Harness. */
  causedBy?: string;
  /** Ponto de injeção para testes — evita chamar IA de verdade. Padrão: `runSalesOutreachCopilot`. */
  composeOutreachFn?: typeof runSalesOutreachCopilot;
}

export interface SalesPipelineRunResult {
  entries: SalesPipelineEntry[];
  outreachCreated: number;
  outreachReused: number;
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
 * - opcionalmente gera rascunho com IA somente para leads de alta intenção
 *   que ainda não têm um rascunho pendente/aprovado — nunca sobrescreve o
 *   que um humano está prestes a revisar;
 * - persiste o snapshot comercial por workspace para consumo do painel;
 * - nunca envia mensagem nem altera CRM/lead.
 */
export async function runWorkspaceSalesCopilot(
  ctx: WorkspaceContext,
  options: SalesPipelineOptions = {},
): Promise<SalesPipelineRunResult> {
  const maxLeads = Math.max(1, options.maxLeads ?? 50);
  const composeOutreachFn = options.composeOutreachFn ?? runSalesOutreachCopilot;
  const leads = (await getSalesLeads(ctx)).slice(0, maxLeads);
  const previous = await getSalesState(ctx);
  const previousByLead = new Map((previous?.entries ?? []).map((e) => [e.lead.leadId, e] as const));

  const results: SalesPipelineEntry[] = [];
  let outreachCreated = 0;
  let outreachReused = 0;

  // Sequencial de propósito: evita burst de chamadas de IA caso vários leads
  // quentes sejam encontrados ao mesmo tempo.
  for (const lead of leads) {
    const assessment = await runSalesCopilot(ctx.workspace.id, lead);
    const entry: SalesPipelineEntry = { lead, assessment };

    if (options.composeOutreach && shouldComposeOutreach(assessment)) {
      const prior = previousByLead.get(lead.leadId);
      const hasUnresolvedDraft = Boolean(prior?.outreach) && prior?.review?.status !== "rejected";

      if (hasUnresolvedDraft) {
        entry.outreach = prior!.outreach;
        outreachReused++;
      } else {
        entry.outreach = await composeOutreachFn(ctx, lead, assessment, options.steering, options.causedBy);
        outreachCreated++;
      }
    }

    results.push(entry);
  }

  const sorted = results.sort((a, b) => b.assessment.score - a.assessment.score);
  await saveSalesState(ctx, sorted);
  return { entries: sorted, outreachCreated, outreachReused };
}
