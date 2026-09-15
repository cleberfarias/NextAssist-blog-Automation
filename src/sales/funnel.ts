import type { WorkspaceContext } from "../context.js";
import { getConversionEvents, type ConversionEvent } from "../conversions.js";
import type { LeadSignal, LeadSignalName, SalesLeadContext } from "./types.js";

function buildIdentityMap(events: ConversionEvent[]): Map<string, string> {
  const userToAnonymous = new Map<string, string>();
  for (const event of events) {
    if (event.userId && event.anonymousId) userToAnonymous.set(event.userId, event.anonymousId);
  }
  return userToAnonymous;
}

function identityKey(event: ConversionEvent, userToAnonymous: Map<string, string>): string | undefined {
  if (event.anonymousId) return event.anonymousId;
  if (event.userId) return userToAnonymous.get(event.userId) ?? `user:${event.userId}`;
  return undefined;
}

function signalName(event: ConversionEvent): LeadSignalName | null {
  if (event.name === "page_view") {
    const path = event.path?.toLowerCase() ?? "";
    if (/pre[cç]o|pricing|plano|planos/.test(path)) return "pricing_view";
    return "site_visit";
  }
  if (event.name === "trial_started") return "trial_started";
  if (event.name === "signup_completed") return "signup_completed";
  if (event.name === "first_order_created") return "first_order_created";
  if (event.name === "subscription_started") return "subscription_started";
  if (event.name === "whatsapp_click") return "whatsapp_click";
  if (event.name === "contact_submit") return "contact_submit";
  return null;
}

/**
 * Transforma os eventos reais de conversão do workspace em leads comerciais.
 * A identidade reaproveita o mesmo princípio de ligação anonymousId -> userId
 * usado pela atribuição: um signup/evento contendo os dois IDs conecta a
 * navegação anônima ao usuário autenticado.
 */
export function buildSalesLeadsFromEvents(events: ConversionEvent[]): SalesLeadContext[] {
  const userToAnonymous = buildIdentityMap(events);
  const grouped = new Map<string, SalesLeadContext>();

  for (const event of [...events].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    const key = identityKey(event, userToAnonymous);
    const name = signalName(event);
    if (!key || !name) continue;

    const current = grouped.get(key) ?? {
      leadId: key,
      anonymousId: event.anonymousId ?? (event.userId ? userToAnonymous.get(event.userId) : undefined),
      userId: event.userId,
      source: event.source,
      signals: [],
    };

    if (event.userId) current.userId = event.userId;
    if (!current.source && event.source) current.source = event.source;

    const signal: LeadSignal = {
      name,
      createdAt: event.createdAt,
      contentId: event.content,
      channel: event.medium ?? event.source,
    };
    current.signals.push(signal);
    grouped.set(key, current);
  }

  return [...grouped.values()]
    .map((lead) => ({ ...lead, signals: [...lead.signals].sort((a, b) => a.createdAt.localeCompare(b.createdAt)) }))
    .sort((a, b) => {
      const aLast = a.signals.at(-1)?.createdAt ?? "";
      const bLast = b.signals.at(-1)?.createdAt ?? "";
      return bLast.localeCompare(aLast);
    });
}

export async function getSalesLeads(ctx: WorkspaceContext): Promise<SalesLeadContext[]> {
  return buildSalesLeadsFromEvents(await getConversionEvents(ctx));
}
