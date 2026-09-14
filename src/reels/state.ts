import { readFile, writeFile } from "node:fs/promises";
import { config } from "../config.js";
import type { WorkspaceContext } from "../context.js";
import { readStoredStateJson, writeStateJson } from "../lib/storage.js";

const REEL_STATE_FILE = "reel-state.json";

export type ReelStatus = "queued" | "rendering" | "pending_approval" | "approved" | "rejected" | "publishing" | "published" | "failed";

export interface ReelAuditEvent {
  from: ReelStatus | null;
  to: ReelStatus;
  at: string;
  actor: "pipeline" | "human" | "system";
  note?: string;
}

export interface ReelRecord {
  id: string;
  workspaceId: string;
  slug: string;
  title: string;
  blogUrl: string;
  caption: string;
  provider: "heygen-mcp" | "heygen-api";
  avatarId: string;
  voiceId: string;
  status: ReelStatus;
  /** Id do job/render no provider (hoje só heygen-api) — permite retomar o mesmo polling em vez de gerar outro vídeo. */
  videoId?: string;
  videoUrl?: string;
  mediaId?: string;
  permalink?: string | null;
  error?: string;
  createdAt: string;
  updatedAt: string;
  audit: ReelAuditEvent[];
}

export interface ReelStateReport {
  updatedAt: string;
  entries: ReelRecord[];
}

const transitions: Record<ReelStatus, readonly ReelStatus[]> = {
  queued: ["rendering", "failed"],
  rendering: ["pending_approval", "failed"],
  pending_approval: ["approved", "rejected"],
  approved: ["publishing", "rejected"],
  rejected: [],
  publishing: ["published", "failed"],
  published: [],
  failed: ["queued"],
};

export function canTransitionReel(from: ReelStatus, to: ReelStatus): boolean {
  return transitions[from].includes(to);
}

export function transitionReel(record: ReelRecord, to: ReelStatus, actor: ReelAuditEvent["actor"], note?: string, patch: Partial<Omit<ReelRecord, "id" | "workspaceId" | "slug" | "status" | "audit">> = {}): ReelRecord {
  if (!canTransitionReel(record.status, to)) throw new Error(`Transição de Reel inválida: ${record.status} -> ${to}.`);
  const at = new Date().toISOString();
  return { ...record, ...patch, status: to, updatedAt: at, audit: [...record.audit, { from: record.status, to, at, actor, ...(note ? { note } : {}) }].slice(-100) };
}

function localFile(ctx: WorkspaceContext): URL { return new URL(REEL_STATE_FILE, ctx.paths.root); }

async function persist(ctx: WorkspaceContext, report: ReelStateReport): Promise<void> {
  if (config.dataSource === "github") await writeStateJson(ctx, REEL_STATE_FILE, report);
  else await writeFile(localFile(ctx), `${JSON.stringify(report, null, 2)}\n`);
}

export async function getReelState(ctx: WorkspaceContext): Promise<ReelStateReport | null> {
  try {
    if (config.dataSource === "github") return await readStoredStateJson<ReelStateReport | null>(ctx, REEL_STATE_FILE, null);
    return JSON.parse(await readFile(localFile(ctx), "utf-8")) as ReelStateReport;
  } catch { return null; }
}

export async function upsertReel(ctx: WorkspaceContext, record: ReelRecord): Promise<ReelRecord> {
  const current = await getReelState(ctx);
  const entries = [...(current?.entries ?? [])];
  const index = entries.findIndex((entry) => entry.id === record.id);
  if (index >= 0) entries[index] = record; else entries.unshift(record);
  await persist(ctx, { updatedAt: new Date().toISOString(), entries: entries.slice(0, 200) });
  return record;
}

export async function findReel(ctx: WorkspaceContext, reelId: string): Promise<ReelRecord | undefined> {
  const report = await getReelState(ctx);
  return report?.entries.find((entry) => entry.id === reelId);
}

export async function getReel(ctx: WorkspaceContext, reelId: string): Promise<ReelRecord> {
  const record = await findReel(ctx, reelId);
  if (!record) throw new Error("Reel não encontrado.");
  return record;
}

/**
 * Atualiza campos sem mudar `status` nem registrar evento de audit — não é
 * uma transição de estado, é progresso dentro do MESMO estado (ex: persistir
 * o `videoId` assim que o HeyGen aceita a renderização, para que uma
 * reexecução depois de uma falha/crash retome o mesmo polling em vez de
 * gerar um vídeo novo).
 */
export async function patchStoredReel(ctx: WorkspaceContext, reelId: string, patch: Partial<Omit<ReelRecord, "id" | "workspaceId" | "slug" | "status" | "audit">>): Promise<ReelRecord> {
  const record = await getReel(ctx, reelId);
  return upsertReel(ctx, { ...record, ...patch, updatedAt: new Date().toISOString() });
}

export async function createQueuedReel(ctx: WorkspaceContext, input: Omit<ReelRecord, "status" | "createdAt" | "updatedAt" | "audit">): Promise<ReelRecord> {
  const now = new Date().toISOString();
  return upsertReel(ctx, { ...input, status: "queued", createdAt: now, updatedAt: now, audit: [{ from: null, to: "queued", at: now, actor: "pipeline", note: "Reel enfileirado para renderização." }] });
}

/**
 * Estados em que o pipeline NUNCA pode resetar/regenerar um Reel sozinho: um
 * humano já decidiu (approved/rejected/published) ou uma publicação está em
 * andamento (publishing). Reexecutar o pipeline para o mesmo workspace+slug
 * (mesmo `${workspace.id}:${slug}`) devolve o registro existente, intocado.
 */
export const PROTECTED_REEL_STATUSES: ReadonlySet<ReelStatus> = new Set([
  "pending_approval", "approved", "publishing", "published", "rejected",
]);

export type ReelResumePlan =
  | { action: "fresh" }
  | { action: "protected"; record: ReelRecord }
  | { action: "resume-rendering"; record: ReelRecord }
  | { action: "retry"; record: ReelRecord };

/**
 * Decide o que fazer ao gerar um Reel para um id que pode já existir —
 * puro, sem I/O, pra ser testável sem mockar storage. `generator.ts` só
 * executa o plano.
 */
export function planReelGeneration(existing: ReelRecord | undefined): ReelResumePlan {
  if (!existing) return { action: "fresh" };
  if (PROTECTED_REEL_STATUSES.has(existing.status)) return { action: "protected", record: existing };
  if (existing.status === "rendering") return { action: "resume-rendering", record: existing };
  return { action: "retry", record: existing }; // queued (nunca chegou a renderizar) ou failed (nova tentativa)
}

export async function transitionStoredReel(ctx: WorkspaceContext, reelId: string, to: ReelStatus, actor: ReelAuditEvent["actor"], note?: string, patch?: Partial<Omit<ReelRecord, "id" | "workspaceId" | "slug" | "status" | "audit">>): Promise<ReelRecord> {
  const record = await getReel(ctx, reelId);
  return upsertReel(ctx, transitionReel(record, to, actor, note, patch));
}
