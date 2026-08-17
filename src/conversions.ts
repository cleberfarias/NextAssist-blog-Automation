import { readFile, writeFile } from "node:fs/promises";
import type { WorkspaceContext } from "./context.js";

export type ConversionEventName = "demo_view" | "demo_submit" | "contact_submit" | "whatsapp_click";
export interface ConversionEvent {
  name: ConversionEventName;
  path?: string;
  source?: string;
  medium?: string;
  campaign?: string;
  content?: string;
  createdAt: string;
}

interface AttributionRow {
  demoViews: number;
  demoSubmits: number;
  contactSubmits: number;
  whatsappClicks: number;
}

async function load(ctx: WorkspaceContext): Promise<ConversionEvent[]> {
  try {
    return JSON.parse(await readFile(ctx.paths.conversions, "utf8")) as ConversionEvent[];
  } catch {
    return [];
  }
}

export async function recordConversion(ctx: WorkspaceContext, event: Omit<ConversionEvent, "createdAt">): Promise<void> {
  const events = await load(ctx);
  const updated = [{ ...event, createdAt: new Date().toISOString() }, ...events].slice(0, 10000);
  await writeFile(ctx.paths.conversions, `${JSON.stringify(updated, null, 2)}\n`);
}

function attribution(
  events: ConversionEvent[],
  field: "campaign" | "content",
): Array<AttributionRow & { demoRate: number; leads: number } & Record<typeof field, string>> {
  const grouped = events.reduce<Array<[string, AttributionRow]>>((result, event) => {
    const key = event[field]?.trim() || "(não informado)";
    const current = result.find(([storedKey]) => storedKey === key)?.[1] ?? {
      demoViews: 0,
      demoSubmits: 0,
      contactSubmits: 0,
      whatsappClicks: 0,
    };
    const next = {
      demoViews: current.demoViews + (event.name === "demo_view" ? 1 : 0),
      demoSubmits: current.demoSubmits + (event.name === "demo_submit" ? 1 : 0),
      contactSubmits: current.contactSubmits + (event.name === "contact_submit" ? 1 : 0),
      whatsappClicks: current.whatsappClicks + (event.name === "whatsapp_click" ? 1 : 0),
    };
    return [...result.filter(([storedKey]) => storedKey !== key), [key, next]];
  }, []);

  return grouped
    .map(([key, values]) => ({
      [field]: key,
      ...values,
      leads: values.demoSubmits + values.contactSubmits + values.whatsappClicks,
      demoRate: values.demoViews ? values.demoSubmits / values.demoViews : 0,
    }) as AttributionRow & { demoRate: number; leads: number } & Record<typeof field, string>)
    .sort((a, b) => b.leads - a.leads || b.demoViews - a.demoViews);
}

export function summarizeConversions(events: ConversionEvent[]) {
  const count = (name: ConversionEventName) =>
    events.filter((event) => event.name === name).length;
  const demoViews = count("demo_view");
  const demoSubmits = count("demo_submit");
  return {
    total: events.length,
    demoViews,
    demoSubmits,
    contactSubmits: count("contact_submit"),
    whatsappClicks: count("whatsapp_click"),
    demoRate: demoViews ? demoSubmits / demoViews : 0,
    byCampaign: attribution(events, "campaign"),
    byContent: attribution(events, "content"),
    updatedAt: new Date().toISOString(),
  };
}

export async function getConversionSummary(ctx: WorkspaceContext) {
  return summarizeConversions(await load(ctx));
}
