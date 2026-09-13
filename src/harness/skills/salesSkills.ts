import type { SalesAssessment, SalesLeadContext } from "../../sales/types.js";
import type { SkillDefinition } from "../types.js";

export const ASSESS_LEAD_SKILL = "sales.assess_lead";

const WEIGHTS = {
  site_visit: 5,
  pricing_view: 15,
  trial_started: 30,
  signup_completed: 15,
  first_order_created: 25,
  subscription_started: 100,
  whatsapp_click: 20,
  contact_submit: 25,
} as const;

/**
 * P0 deliberadamente determinístico: o Sales Agent começa com scoring simples
 * e auditável. O LLM entra depois para interpretar contexto e redigir abordagem,
 * mas não deve ser responsável sozinho pela pontuação comercial.
 */
export function assessLead(lead: SalesLeadContext): SalesAssessment {
  const seen = new Set(lead.signals.map((signal) => signal.name));
  const score = Math.min(100, [...seen].reduce((total, signal) => total + WEIGHTS[signal], 0));
  const reasons: string[] = [];

  if (seen.has("subscription_started")) {
    reasons.push("Lead já converteu em assinatura.");
    return { leadId: lead.leadId, score: 100, intent: "customer", nextAction: "customer_success", reasons };
  }

  if (seen.has("first_order_created")) reasons.push("Usuário ativou o produto criando a primeira OS.");
  if (seen.has("trial_started")) reasons.push("Usuário iniciou trial.");
  if (seen.has("pricing_view")) reasons.push("Visitou página de preços.");
  if (seen.has("contact_submit")) reasons.push("Enviou contato comercial.");
  if (seen.has("whatsapp_click")) reasons.push("Demonstrou intenção de contato via WhatsApp.");

  if (score >= 70) {
    return { leadId: lead.leadId, score, intent: "high", nextAction: "request_human_contact", reasons };
  }
  if (score >= 35) {
    return { leadId: lead.leadId, score, intent: "medium", nextAction: "offer_help", reasons };
  }
  if (score >= 15) {
    return { leadId: lead.leadId, score, intent: "medium", nextAction: "invite_trial", reasons };
  }

  return { leadId: lead.leadId, score, intent: "low", nextAction: "nurture", reasons };
}

export const assessLeadSkill: SkillDefinition<SalesLeadContext, SalesAssessment, Record<string, never>> = {
  name: ASSESS_LEAD_SKILL,
  description: "Calcula intenção comercial de forma determinística a partir dos sinais do lead.",
  async execute(input) {
    return assessLead(input);
  },
};
