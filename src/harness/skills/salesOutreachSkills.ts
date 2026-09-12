import type { WorkspaceContext } from "../../context.js";
import { extractJson, runAgent } from "../../lib/anthropic.js";
import type { SalesAssessment, SalesLeadContext, SalesOutreachDraft } from "../../sales/types.js";
import type { SkillDefinition } from "../types.js";

export const COMPOSE_OUTREACH_SKILL = "sales.compose_outreach";

export interface SalesOutreachInput {
  lead: SalesLeadContext;
  assessment: SalesAssessment;
}

export interface SalesOutreachHarnessContext {
  workspaceContext: WorkspaceContext;
}

interface ModelDraft {
  message: string;
  rationale: string;
  subject?: string;
}

function parseDraft(raw: string): ModelDraft {
  const parsed = extractJson<Partial<ModelDraft>>(raw);
  if (!parsed || typeof parsed.message !== "string" || !parsed.message.trim()) {
    throw new Error("Sales Agent retornou abordagem sem mensagem válida.");
  }
  if (typeof parsed.rationale !== "string" || !parsed.rationale.trim()) {
    throw new Error("Sales Agent retornou abordagem sem justificativa válida.");
  }
  if (parsed.subject !== undefined && typeof parsed.subject !== "string") {
    throw new Error("Sales Agent retornou subject inválido.");
  }
  return {
    message: parsed.message.trim(),
    rationale: parsed.rationale.trim(),
    subject: parsed.subject?.trim() || undefined,
  };
}

function preferredChannel(lead: SalesLeadContext): SalesOutreachDraft["channel"] {
  const signals = new Set(lead.signals.map((signal) => signal.name));
  if (signals.has("whatsapp_click")) return "whatsapp";
  return "human";
}

export const composeOutreachSkill: SkillDefinition<
  SalesOutreachInput,
  SalesOutreachDraft,
  SalesOutreachHarnessContext
> = {
  name: COMPOSE_OUTREACH_SKILL,
  description: "Redige uma abordagem comercial contextual sem enviar nenhuma mensagem.",
  async execute(input, executionContext) {
    const ctx = executionContext.context.workspaceContext;
    const recentSignals = input.lead.signals
      .slice(-6)
      .map((signal) => `${signal.name}${signal.contentId ? ` (conteúdo: ${signal.contentId})` : ""}`)
      .join(", ");

    const system = `Você é o Sales Agent do ${ctx.workspace.brand.name}.
Produto: ${ctx.workspace.brand.description}
Público-alvo: ${ctx.workspace.brand.targetAudience.join(", ") || "não especificado"}
Propostas de valor: ${(ctx.workspace.brand.valuePropositions ?? []).join(", ") || "não especificado"}

Sua função nesta etapa é SOMENTE redigir uma sugestão de abordagem comercial curta, útil e não agressiva.
Não invente nome, empresa, telefone, e-mail, dor ou informação que não esteja nos sinais fornecidos.
Não prometa desconto, condição comercial ou funcionalidade não informada.
Não diga que a mensagem já foi enviada.
A saída será revisada por uma pessoa antes de qualquer contato externo.`;

    const prompt = `Lead: ${input.lead.leadId}
Origem: ${input.lead.source ?? "não informada"}
Score: ${input.assessment.score}/100
Intenção: ${input.assessment.intent}
Próxima ação recomendada: ${input.assessment.nextAction}
Motivos: ${input.assessment.reasons.join("; ") || "sem motivo adicional"}
Sinais recentes: ${recentSignals || "nenhum"}

Escreva uma abordagem em português do Brasil, de 2 a 5 frases, focada em ajudar e avançar um único próximo passo.
Responda SOMENTE JSON:
{
  "subject": "opcional; use apenas se fizer sentido para e-mail",
  "message": "...",
  "rationale": "por que esta abordagem é adequada para os sinais observados"
}`;

    const draft = parseDraft(await runAgent(ctx, { system, prompt, maxTokens: 700 }));
    const channel = preferredChannel(input.lead);

    return {
      leadId: input.lead.leadId,
      channel,
      subject: channel === "email" ? draft.subject : undefined,
      message: draft.message,
      rationale: draft.rationale,
      requiresHumanApproval: true,
    };
  },
};
