import { readFile, writeFile } from "node:fs/promises";

const PATH = new URL("../conversion-events.json", import.meta.url);
export type ConversionEventName = "demo_view" | "demo_submit" | "contact_submit" | "whatsapp_click";
export interface ConversionEvent { name: ConversionEventName; path?: string; source?: string; medium?: string; campaign?: string; content?: string; createdAt: string; }

async function load(): Promise<ConversionEvent[]> {
  try { return JSON.parse(await readFile(PATH, "utf8")) as ConversionEvent[]; } catch { return []; }
}
export async function recordConversion(event: Omit<ConversionEvent, "createdAt">): Promise<void> {
  const events = await load();
  events.unshift({ ...event, createdAt: new Date().toISOString() });
  await writeFile(PATH, JSON.stringify(events.slice(0, 10000), null, 2) + "\n");
}
export async function getConversionSummary() {
  const events = await load();
  const count = (name: ConversionEventName) => events.filter((event) => event.name === name).length;
  const demoViews = count("demo_view");
  const demoSubmits = count("demo_submit");
  return { total: events.length, demoViews, demoSubmits, contactSubmits: count("contact_submit"), whatsappClicks: count("whatsapp_click"), demoRate: demoViews ? demoSubmits / demoViews : 0, updatedAt: new Date().toISOString() };
}
