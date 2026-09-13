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
  provider: "heygen-mcp";
  avatarId: string;
  voiceId: string;
  status: ReelStatus;
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

export async function getReel(ctx: WorkspaceContext, reelId: string): Promise<ReelRecord> {
  const report = await getReelState(ctx);
  const record = report?.entries.find((entry) => entry.id === reelId);
  if (!record) throw new Error("Reel não encontrado.");
  return record;
}

export async function createQueuedReel(ctx: WorkspaceContext, input: Omit<ReelRecord, "status" | "createdAt" | "updatedAt" | "audit">): Promise<ReelRecord> {
  const now = new Date().toISOString();
  return upsertReel(ctx, { ...input, status: "queued", createdAt: now, updatedAt: now, audit: [{ from: null, to: "queued", at: now, actor: "pipeline", note: "Reel enfileirado para renderização." }] });
}

export async function transitionStoredReel(ctx: WorkspaceContext, reelId: string, to: ReelStatus, actor: ReelAuditEvent["actor"], note?: string, patch?: Partial<Omit<ReelRecord, "id" | "workspaceId" | "slug" | "status" | "audit">>): Promise<ReelRecord> {
  const record = await getReel(ctx, reelId);
  return upsertReel(ctx, transitionReel(record, to, actor, note, patch));
}
