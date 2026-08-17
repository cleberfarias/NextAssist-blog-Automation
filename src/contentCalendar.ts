// src/contentCalendar.ts
import { readFile, writeFile } from "node:fs/promises";
import type { WorkspaceContext } from "./context.js";

export interface CalendarTopic {
  tema: string;
  palavraChaveAlvo: string;
  publicado: boolean;
  publicadoEm?: string;
  /** Presente quando o tópico foi gerado pelo Marketing Director em vez de curado manualmente. */
  generatedBy?: "marketing-director";
  createdAt?: string;
  reason?: string;
  priority?: "high" | "medium" | "low";
}

/** O que o Marketing Director (ou qualquer outro gerador futuro) precisa fornecer para virar um `CalendarTopic`. */
export interface NewTopicInput {
  tema: string;
  palavraChaveAlvo: string;
  reason?: string;
  priority?: "high" | "medium" | "low";
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

/** Conta quantos tópicos ainda não foram publicados — usado por `ensureContentBacklog` para decidir se reabastece. */
export async function countPendingTopics(ctx: WorkspaceContext): Promise<number> {
  const calendar = await load(ctx);
  return calendar.topicos.filter((t) => !t.publicado).length;
}

/** Todos os tópicos (pendentes e publicados) — base para deduplicar novas pautas geradas pelo Marketing Director. */
export async function getAllTopics(ctx: WorkspaceContext): Promise<CalendarTopic[]> {
  return (await load(ctx)).topicos;
}

/**
 * Acrescenta novos tópicos ao calendário. Quem chama (`ensureContentBacklog`)
 * já validou duplicidade/qualidade — esta função só persiste, marcando a
 * origem para diferenciar de tópicos curados manualmente.
 */
export async function addTopics(ctx: WorkspaceContext, inputs: NewTopicInput[]): Promise<CalendarTopic[]> {
  if (inputs.length === 0) return [];
  const calendar = await load(ctx);
  const createdAt = new Date().toISOString();
  const newTopics: CalendarTopic[] = inputs.map((input) => ({
    tema: input.tema,
    palavraChaveAlvo: input.palavraChaveAlvo,
    publicado: false,
    generatedBy: "marketing-director",
    createdAt,
    reason: input.reason,
    priority: input.priority,
  }));
  calendar.topicos.push(...newTopics);
  await save(ctx, calendar);
  return newTopics;
}
