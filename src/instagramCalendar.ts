import { readFile, writeFile } from "node:fs/promises";
import type { WorkspaceContext } from "./context.js";

export interface InstagramTopic { id: string; tema: string; pilar: string; formato: "reel" | "carrossel" | "story"; publicado: boolean; criadoEm?: string; publicadoEm?: string; }
async function load(ctx: WorkspaceContext): Promise<InstagramTopic[]> { try { return JSON.parse(await readFile(ctx.paths.instagramCalendar, "utf-8")) as InstagramTopic[]; } catch { return []; } }
export async function getNextInstagramTopic(ctx: WorkspaceContext): Promise<InstagramTopic | null> { return (await load(ctx)).find((topic) => !topic.publicado) ?? null; }
export async function markInstagramTopicPublished(ctx: WorkspaceContext, id: string): Promise<void> { const next = (await load(ctx)).map((topic) => topic.id === id ? { ...topic, publicado: true, publicadoEm: new Date().toISOString() } : topic); await writeFile(ctx.paths.instagramCalendar, JSON.stringify(next, null, 2) + "\n"); }
