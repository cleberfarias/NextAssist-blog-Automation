import type { SalesEntry } from "../../types/api";

export type LeadTab = "todos" | "novos" | "em_contato" | "quentes" | "convertidos";

export const LEAD_TABS: { id: LeadTab; label: string }[] = [
  { id: "todos", label: "Todos" },
  { id: "novos", label: "Novos" },
  { id: "em_contato", label: "Em contato" },
  { id: "quentes", label: "Quentes" },
  { id: "convertidos", label: "Convertidos" },
];

export type LeadStatus = "novo" | "em_contato" | "quente" | "convertido";

export const LEAD_STATUS_LABEL: Record<LeadStatus, string> = {
  novo: "Novo",
  em_contato: "Em contato",
  quente: "Quente",
  convertido: "Convertido",
};

export const LEAD_STATUS_COLOR: Record<LeadStatus, { dot: string; text: string }> = {
  novo: { dot: "bg-accent", text: "text-accent" },
  em_contato: { dot: "bg-accent", text: "text-accent" },
  quente: { dot: "bg-status-error", text: "text-status-error" },
  convertido: { dot: "bg-status-ok", text: "text-status-ok" },
};

const TAB_STATUS: Record<Exclude<LeadTab, "todos">, LeadStatus> = {
  novos: "novo",
  em_contato: "em_contato",
  quentes: "quente",
  convertidos: "convertido",
};

/**
 * Classifica o lead num status de funil usando só dados reais: intenção
 * (calculada pelo agente) e se já existe um rascunho de contato (outreach).
 * Prioridade: cliente convertido > quente > já contatado > novo.
 */
export function leadStatus(entry: SalesEntry): LeadStatus {
  if (entry.assessment.intent === "customer") return "convertido";
  if (entry.assessment.intent === "high") return "quente";
  if (entry.outreach) return "em_contato";
  return "novo";
}

export function filterLeadsByTab(entries: SalesEntry[], tab: LeadTab): SalesEntry[] {
  if (tab === "todos") return entries;
  const target = TAB_STATUS[tab];
  return entries.filter((e) => leadStatus(e) === target);
}

/** Nome de exibição real do lead — nunca um nome inventado. */
export function leadDisplayName(entry: SalesEntry): string {
  return entry.lead.userId ?? entry.lead.anonymousId ?? entry.lead.leadId;
}

const SIGNAL_INTEREST_LABEL: Record<string, string> = {
  site_visit: "Site",
  pricing_view: "Preços",
  trial_started: "Teste grátis",
  signup_completed: "Cadastro",
  first_order_created: "Primeira OS",
  subscription_started: "Assinatura",
  whatsapp_click: "WhatsApp",
  contact_submit: "Contato",
};

/** O interesse mais recente demonstrado pelo lead, a partir do último sinal real registrado. */
export function leadInterest(entry: SalesEntry): string | null {
  const signals = entry.lead.signals;
  if (signals.length === 0) return null;
  const last = signals[signals.length - 1];
  return SIGNAL_INTEREST_LABEL[last.name] ?? last.name;
}

/** Data/hora do sinal mais recente — a última atividade real do lead. */
export function leadLastActivityAt(entry: SalesEntry): string | null {
  const signals = entry.lead.signals;
  if (signals.length === 0) return null;
  return signals[signals.length - 1].createdAt;
}
