export type LeadSignalName =
  | "site_visit"
  | "pricing_view"
  | "trial_started"
  | "signup_completed"
  | "first_order_created"
  | "subscription_started"
  | "whatsapp_click"
  | "contact_submit";

export interface LeadSignal {
  name: LeadSignalName;
  createdAt: string;
  contentId?: string;
  channel?: string;
}

export interface SalesLeadContext {
  leadId: string;
  anonymousId?: string;
  userId?: string;
  source?: string;
  signals: LeadSignal[];
}

export type SalesIntent = "low" | "medium" | "high" | "customer";
export type SalesNextAction =
  | "nurture"
  | "invite_trial"
  | "offer_help"
  | "request_human_contact"
  | "customer_success";

export interface SalesAssessment {
  leadId: string;
  score: number;
  intent: SalesIntent;
  nextAction: SalesNextAction;
  reasons: string[];
}

export type SalesOutreachChannel = "email" | "whatsapp" | "human";

export interface SalesOutreachDraft {
  leadId: string;
  channel: SalesOutreachChannel;
  subject?: string;
  message: string;
  rationale: string;
  requiresHumanApproval: true;
}

export interface SalesPipelineEntry {
  lead: SalesLeadContext;
  assessment: SalesAssessment;
  outreach?: SalesOutreachDraft;
}
