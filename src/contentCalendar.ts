import { readFile, writeFile } from "node:fs/promises";

const CALENDAR_PATH = new URL("../content-calendar.json", import.meta.url);

export interface CalendarTopic {
  tema: string;
  palavraChaveAlvo: string;
  publicado: boolean;
  publicadoEm?: string;
}

interface Calendar {
  topicos: CalendarTopic[];
}

async function load(): Promise<Calendar> {
  const raw = await readFile(CALENDAR_PATH, "utf-8");
  return JSON.parse(raw) as Calendar;
}

async function save(calendar: Calendar): Promise<void> {
  await writeFile(CALENDAR_PATH, JSON.stringify(calendar, null, 2) + "\n");
}

/** Pega o próximo tópico não publicado. */
export async function getNextTopic(): Promise<CalendarTopic | null> {
  const calendar = await load();
  return calendar.topicos.find((t) => !t.publicado) ?? null;
}

/** Marca um tópico como publicado. */
export async function markTopicPublished(tema: string): Promise<void> {
  const calendar = await load();
  const topic = calendar.topicos.find((t) => t.tema === tema);
  if (topic) {
    topic.publicado = true;
    topic.publicadoEm = new Date().toISOString();
    await save(calendar);
  }
}

/** Adiciona novos tópicos descobertos pelo agente de pesquisa de mercado. */
export async function addTopics(newTopics: CalendarTopic[]): Promise<void> {
  const calendar = await load();
  const existing = new Set(calendar.topicos.map((t) => t.tema.toLowerCase()));
  const toAdd = newTopics.filter((t) => !existing.has(t.tema.toLowerCase()));
  calendar.topicos.push(...toAdd);
  await save(calendar);
}
