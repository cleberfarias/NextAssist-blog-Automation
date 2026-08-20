// src/attribution.ts
import { getContentRegistry, type ContentRegistryEntry } from "./contentRegistry.js";
import { getConversionEvents, type ConversionEvent } from "./conversions.js";
import { getPerformance } from "./performance.js";
import type { WorkspaceContext } from "./context.js";

/** Amostra mínima de trials para uma taxa ser considerada confiável. Ponto de partida do P0, ajustável com mais dado real — não é verdade estatística. */
export const MIN_TRIALS_FOR_RATE = 5;

export interface AttributionRow {
  contentId: string;
  campaignId: string | null;
  tema: string;
  channel: string;
  formato: string;
  funnelStage: string;
  visits: number;
  trials: number;
  signups: number;
  activated: number;
  customers: number;
  visitToTrialRate: number;
  trialToActivationRate: number;
  activationToCustomerRate: number;
  rateReliable: boolean;
}

export interface AttributionResult {
  rows: AttributionRow[];
  unattributedEvents: number;
}

const FUNNEL_EVENT_NAMES = new Set<ConversionEvent["name"]>([
  "page_view", "trial_started", "signup_completed", "first_order_created", "subscription_started",
]);

/** userId -> anonymousId, construído a partir de eventos que carregam os dois (tipicamente signup_completed). */
function buildIdentityMap(events: ConversionEvent[]): Map<string, string> {
  const userToAnonymous = new Map<string, string>();
  for (const event of events) {
    if (event.anonymousId && event.userId) userToAnonymous.set(event.userId, event.anonymousId);
  }
  return userToAnonymous;
}

/** anonymousId -> primeiro contentId tocado (first-touch), por ordem de createdAt. */
function buildFirstTouchMap(events: ConversionEvent[]): Map<string, string> {
  const sorted = [...events].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const firstTouch = new Map<string, string>();
  for (const event of sorted) {
    if (event.anonymousId && event.content && !firstTouch.has(event.anonymousId)) {
      firstTouch.set(event.anonymousId, event.content);
    }
  }
  return firstTouch;
}

/**
 * Resolve o contentId de origem de um evento: prioriza a atribuição
 * first-touch via identidade (anonymousId direto, ou anonymousId ligado por
 * userId); só cai para o `content` direto do próprio evento quando não há
 * identidade resolvível.
 */
function resolveContentId(
  event: ConversionEvent,
  firstTouch: Map<string, string>,
  userToAnonymous: Map<string, string>,
): string | undefined {
  const anonymousId = event.anonymousId ?? (event.userId ? userToAnonymous.get(event.userId) : undefined);
  if (anonymousId && firstTouch.has(anonymousId)) return firstTouch.get(anonymousId);
  return event.content || undefined;
}

function entityKey(event: ConversionEvent, userToAnonymous: Map<string, string>): string | undefined {
  if (event.userId) return userToAnonymous.get(event.userId) ?? event.userId;
  return event.anonymousId;
}

/** Agrupa entidades únicas (Set<anonymousId|userId>) por contentId, para um nome de evento. Nunca conta eventos brutos. */
function uniqueEntitiesByContent(
  events: ConversionEvent[],
  name: ConversionEvent["name"],
  firstTouch: Map<string, string>,
  userToAnonymous: Map<string, string>,
): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const event of events) {
    if (event.name !== name) continue;
    const contentId = resolveContentId(event, firstTouch, userToAnonymous);
    const key = entityKey(event, userToAnonymous);
    if (!contentId || !key) continue;
    if (!map.has(contentId)) map.set(contentId, new Set());
    map.get(contentId)!.add(key);
  }
  return map;
}

function safeRate(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : 0;
}

export interface PerformanceLike {
  posts: Array<{ slug: string; clicks: number }>;
}

/**
 * Função pura, sem I/O: junta registro de conteúdo + eventos + performance
 * SEO em uma linha por contentId. Sem chamada a LLM, sem estado — não é um
 * agente.
 */
export function computeAttributionFromData(
  registry: ContentRegistryEntry[],
  events: ConversionEvent[],
  performance: PerformanceLike | null,
): AttributionResult {
  const userToAnonymous = buildIdentityMap(events);
  const firstTouch = buildFirstTouchMap(events);
  const registryIds = new Set(registry.map((e) => e.contentId));

  const pageViewsByContent = uniqueEntitiesByContent(events, "page_view", firstTouch, userToAnonymous);
  const trialsByContent = uniqueEntitiesByContent(events, "trial_started", firstTouch, userToAnonymous);
  const signupsByContent = uniqueEntitiesByContent(events, "signup_completed", firstTouch, userToAnonymous);
  const activatedByContent = uniqueEntitiesByContent(events, "first_order_created", firstTouch, userToAnonymous);
  const customersByContent = uniqueEntitiesByContent(events, "subscription_started", firstTouch, userToAnonymous);

  const performanceBySlug = new Map((performance?.posts ?? []).map((p) => [p.slug, p.clicks]));

  const rows = registry.map((entry): AttributionRow => {
    const clicks = performanceBySlug.get(entry.contentId);
    const visits = clicks && clicks > 0 ? clicks : (pageViewsByContent.get(entry.contentId)?.size ?? 0);
    const trials = trialsByContent.get(entry.contentId)?.size ?? 0;
    const signups = signupsByContent.get(entry.contentId)?.size ?? 0;
    const activated = activatedByContent.get(entry.contentId)?.size ?? 0;
    const customers = customersByContent.get(entry.contentId)?.size ?? 0;

    return {
      contentId: entry.contentId,
      campaignId: entry.campaignId,
      tema: entry.tema,
      channel: entry.channel,
      formato: entry.formato,
      funnelStage: entry.funnelStage,
      visits, trials, signups, activated, customers,
      visitToTrialRate: safeRate(trials, visits),
      trialToActivationRate: safeRate(activated, trials),
      activationToCustomerRate: safeRate(customers, activated),
      rateReliable: trials >= MIN_TRIALS_FOR_RATE,
    };
  });

  // Every funnel event lands in exactly one place: a row above, or here.
  // Never both, never neither — that's what makes unattributedEvents trustworthy.
  let unattributedEvents = 0;
  for (const event of events) {
    if (!FUNNEL_EVENT_NAMES.has(event.name)) continue;
    const contentId = resolveContentId(event, firstTouch, userToAnonymous);
    const key = entityKey(event, userToAnonymous);
    if (!contentId || !key || !registryIds.has(contentId)) unattributedEvents++;
  }

  return { rows, unattributedEvents };
}

/** Carrega registro + eventos + performance do workspace e computa a atribuição. Chamado sob demanda pelo dashboard e pelo Marketing Director. */
export async function computeAttribution(ctx: WorkspaceContext): Promise<AttributionResult> {
  const [registry, events, performance] = await Promise.all([
    getContentRegistry(ctx),
    getConversionEvents(ctx),
    getPerformance(ctx),
  ]);
  return computeAttributionFromData(registry, events, performance);
}
