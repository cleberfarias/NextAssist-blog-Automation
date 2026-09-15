import type { ConversionEvent, ConversionEventName } from "./conversions.js";

const LEAD_EVENT_NAMES: ConversionEventName[] = ["demo_submit", "contact_submit", "whatsapp_click"];

function isLeadEvent(event: ConversionEvent): boolean {
  return (LEAD_EVENT_NAMES as string[]).includes(event.name);
}

function countName(events: ConversionEvent[], name: ConversionEventName): number {
  return events.filter((e) => e.name === name).length;
}

function countLeads(events: ConversionEvent[]): number {
  return events.filter(isLeadEvent).length;
}

/** Variação percentual real entre dois períodos — null quando não há base real pra comparar (nunca inventa uma tendência). */
function pctChange(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return ((current - previous) / previous) * 100;
}

export interface AnalyticsOverviewKpi {
  value: number;
  changePct: number | null;
}

export interface AnalyticsOverviewSeriesPoint {
  date: string;
  visits: number;
  leads: number;
}

export interface AnalyticsOverviewLeadSource {
  source: string;
  count: number;
  pct: number;
}

export interface AnalyticsOverview {
  rangeDays: number;
  visits: AnalyticsOverviewKpi;
  leads: AnalyticsOverviewKpi;
  conversionRate: { value: number; changePoints: number | null };
  customers: AnalyticsOverviewKpi;
  series: AnalyticsOverviewSeriesPoint[];
  leadSources: AnalyticsOverviewLeadSource[];
}

/**
 * Agrega o log bruto de eventos reais (`conversion-events.json`) num resumo
 * pronto pra tela de Relatórios — período atual vs período anterior de
 * mesmo tamanho, série diária e origem dos leads. Nunca inventa uma
 * variação: sem período anterior real pra comparar, `changePct`/
 * `changePoints` ficam `null` em vez de um número fabricado.
 */
export function summarizeOverview(events: ConversionEvent[], days: number, now: Date): AnalyticsOverview {
  const dayMs = 24 * 60 * 60 * 1000;
  const periodEnd = now.getTime();
  const periodStart = periodEnd - days * dayMs;
  const previousStart = periodStart - days * dayMs;

  const inRange = (event: ConversionEvent, start: number, end: number): boolean => {
    const t = new Date(event.createdAt).getTime();
    return t > start && t <= end;
  };

  const current = events.filter((e) => inRange(e, periodStart, periodEnd));
  const previous = events.filter((e) => inRange(e, previousStart, periodStart));

  const curVisits = countName(current, "page_view");
  const prevVisits = countName(previous, "page_view");
  const curLeads = countLeads(current);
  const prevLeads = countLeads(previous);
  const curCustomers = countName(current, "first_customer_created");
  const prevCustomers = countName(previous, "first_customer_created");
  const curRate = curVisits ? curLeads / curVisits : 0;
  const prevRate = prevVisits ? prevLeads / prevVisits : 0;

  const series: AnalyticsOverviewSeriesPoint[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const dayStart = periodEnd - (i + 1) * dayMs;
    const dayEnd = periodEnd - i * dayMs;
    const bucket = current.filter((e) => inRange(e, dayStart, dayEnd));
    series.push({
      date: new Date(dayEnd).toISOString().slice(0, 10),
      visits: countName(bucket, "page_view"),
      leads: countLeads(bucket),
    });
  }

  const leadEvents = current.filter(isLeadEvent);
  const bySource = new Map<string, number>();
  for (const event of leadEvents) {
    const key = event.source?.trim() || "Outros";
    bySource.set(key, (bySource.get(key) ?? 0) + 1);
  }
  const leadSources: AnalyticsOverviewLeadSource[] = [...bySource.entries()]
    .map(([source, count]) => ({ source, count, pct: leadEvents.length ? (count / leadEvents.length) * 100 : 0 }))
    .sort((a, b) => b.count - a.count);

  return {
    rangeDays: days,
    visits: { value: curVisits, changePct: pctChange(curVisits, prevVisits) },
    leads: { value: curLeads, changePct: pctChange(curLeads, prevLeads) },
    conversionRate: { value: curRate, changePoints: prevVisits ? (curRate - prevRate) * 100 : null },
    customers: { value: curCustomers, changePct: pctChange(curCustomers, prevCustomers) },
    series,
    leadSources,
  };
}
