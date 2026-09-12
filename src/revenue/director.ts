import type { AttributionResult } from "../attribution.js";
import type { SalesStateReport } from "../sales/state.js";
import type { RevenueDecision, RevenueSnapshot } from "./types.js";

function safeRate(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : 0;
}

export function buildRevenueSnapshot(
  attribution: AttributionResult,
  sales: SalesStateReport | null,
): RevenueSnapshot {
  const visits = attribution.rows.reduce((sum, row) => sum + row.visits, 0);
  const trials = attribution.rows.reduce((sum, row) => sum + row.trials, 0);
  const activated = attribution.rows.reduce((sum, row) => sum + row.activated, 0);
  const customers = attribution.rows.reduce((sum, row) => sum + row.customers, 0);
  const entries = sales?.entries ?? [];
  const hotLeads = entries.filter((entry) => entry.assessment.intent === "high").length;
  const pendingSalesApprovals = entries.filter(
    (entry) => entry.outreach && (!entry.review || entry.review.status === "pending"),
  ).length;

  return {
    visits,
    trials,
    activated,
    customers,
    hotLeads,
    pendingSalesApprovals,
    visitToTrialRate: safeRate(trials, visits),
    trialToActivationRate: safeRate(activated, trials),
    activationToCustomerRate: safeRate(customers, activated),
  };
}

/**
 * P0 auditável do Revenue Director.
 * Regras determinísticas antes de introduzir LLM na decisão econômica.
 */
export function decideRevenueAction(snapshot: RevenueSnapshot): RevenueDecision {
  const evidence = [
    `${snapshot.visits} visitas`,
    `${snapshot.trials} trials`,
    `${snapshot.activated} ativações`,
    `${snapshot.customers} clientes`,
    `${snapshot.hotLeads} leads quentes`,
  ];

  if (snapshot.pendingSalesApprovals > 0) {
    return {
      objective: "increase_paying_customers",
      bottleneck: "sales_followup",
      action: "prioritize_hot_leads",
      priority: "high",
      reason: `Existem ${snapshot.pendingSalesApprovals} abordagens comerciais aguardando decisão humana; gerar mais demanda agora pode aumentar o acúmulo no fundo do funil.`,
      evidence,
      requiresHumanApproval: true,
    };
  }

  if (snapshot.hotLeads > 0 && snapshot.customers === 0) {
    return {
      objective: "increase_paying_customers",
      bottleneck: "sales_conversion",
      action: "improve_sales_conversion",
      priority: "high",
      reason: "Já existem leads de alta intenção, mas nenhum cliente atribuído. O gargalo está mais próximo de fechamento do que de aquisição.",
      evidence,
      requiresHumanApproval: true,
    };
  }

  if (snapshot.trials >= 5 && snapshot.trialToActivationRate < 0.4) {
    return {
      objective: "increase_paying_customers",
      bottleneck: "activation",
      action: "improve_activation",
      priority: "high",
      reason: `Há volume mínimo de trials, mas somente ${(snapshot.trialToActivationRate * 100).toFixed(1)}% chegam à ativação.`,
      evidence,
      requiresHumanApproval: true,
    };
  }

  if (snapshot.activated >= 5 && snapshot.activationToCustomerRate < 0.3) {
    return {
      objective: "increase_paying_customers",
      bottleneck: "sales_conversion",
      action: "improve_sales_conversion",
      priority: "high",
      reason: `Usuários estão ativando, mas somente ${(snapshot.activationToCustomerRate * 100).toFixed(1)}% viram clientes.`,
      evidence,
      requiresHumanApproval: true,
    };
  }

  if (snapshot.visits >= 20 && snapshot.visitToTrialRate < 0.05) {
    return {
      objective: "increase_paying_customers",
      bottleneck: "trial_conversion",
      action: "improve_cta",
      priority: "medium",
      reason: `Existe tráfego, mas a conversão visita → trial está em ${(snapshot.visitToTrialRate * 100).toFixed(1)}%.`,
      evidence,
      requiresHumanApproval: true,
    };
  }

  if (snapshot.visits < 20) {
    return {
      objective: "increase_paying_customers",
      bottleneck: "traffic",
      action: "create_content",
      priority: "medium",
      reason: "Ainda há pouco volume de tráfego para concluir que o gargalo principal está nas etapas posteriores do funil.",
      evidence,
      requiresHumanApproval: false,
    };
  }

  return {
    objective: "increase_paying_customers",
    bottleneck: "none",
    action: "do_nothing",
    priority: "low",
    reason: "Os sinais disponíveis não justificam uma intervenção prioritária neste momento.",
    evidence,
    requiresHumanApproval: false,
  };
}
