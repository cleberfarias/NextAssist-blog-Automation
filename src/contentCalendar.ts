import { readFile, writeFile } from "node:fs/promises";
import type { WorkspaceContext } from "./context.js";

export interface CalendarTopic {
  tema: string;
  palavraChaveAlvo: string;
  publicado: boolean;
  publicadoEm?: string;
}

interface Calendar {
  topicos: CalendarTopic[];
}

async function load(ctx: WorkspaceContext): Promise<Calendar> {
  const raw = await readFile(ctx.paths.calendar, "utf-8");
  return JSON.parse(raw) as Calendar;
}

async function save(ctx: WorkspaceContext, calendar: Calendar): Promise<void> {
  await writeFile(ctx.paths.calendar, JSON.stringify(calendar, null, 2) + "\n");
}

/** Pega o próximo tópico não publicado. */
export async function getNextTopic(ctx: WorkspaceContext): Promise<CalendarTopic | null> {
  const calendar = await load(ctx);
  return calendar.topicos.find((t) => !t.publicado) ?? null;
}

/** Marca um tópico como publicado. */
export async function markTopicPublished(ctx: WorkspaceContext, tema: string): Promise<void> {
  const calendar = await load(ctx);
  const topic = calendar.topicos.find((t) => t.tema === tema);
  if (topic) {
    topic.publicado = true;
    topic.publicadoEm = new Date().toISOString();
    await save(ctx, calendar);
  }
}

/** Adiciona novos tópicos descobertos pelo agente de pesquisa de mercado. */
export async function addTopics(ctx: WorkspaceContext, newTopics: CalendarTopic[]): Promise<void> {
  const calendar = await load(ctx);
  const existing = new Set(calendar.topicos.map((t) => t.tema.toLowerCase()));
  const toAdd = newTopics.filter((t) => !existing.has(t.tema.toLowerCase()));
  calendar.topicos.push(...toAdd);
  await save(ctx, calendar);
}
