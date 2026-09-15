export type RevenueBottleneck =
  | "traffic"
  | "trial_conversion"
  | "activation"
  | "sales_conversion"
  | "sales_followup"
  | "none";

export type RevenueAction =
  | "create_content"
  | "improve_cta"
  | "improve_activation"
  | "prioritize_hot_leads"
  | "improve_sales_conversion"
  | "do_nothing";

export interface RevenueSnapshot {
  visits: number;
  trials: number;
  activated: number;
  customers: number;
  hotLeads: number;
  pendingSalesApprovals: number;
  visitToTrialRate: number;
  trialToActivationRate: number;
  activationToCustomerRate: number;
}

export interface RevenueDecision {
  objective: "increase_paying_customers";
  bottleneck: RevenueBottleneck;
  action: RevenueAction;
  priority: "low" | "medium" | "high";
  reason: string;
  evidence: string[];
  requiresHumanApproval: boolean;
}
