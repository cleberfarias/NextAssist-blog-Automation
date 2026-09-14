/**
 * Reconciliação determinística e idempotente dos JSONs de estado por
 * workspace, usada quando duas execuções do pipeline (ex: workflows
 * concorrentes) tentam publicar mudanças na mesma branch. Nunca resolve
 * escolhendo --ours/--theirs cegamente: cada arquivo tem uma regra própria
 * que preserva informação dos dois lados. Puro (sem I/O) para ser testável
 * sem git nem filesystem — quem lê/escreve os arquivos é `mergeWorkspaceState.ts`.
 */
import type { CalendarTopic } from "../contentCalendar.js";
import type { ContentRegistryEntry } from "../contentRegistry.js";
import type { HistoryEntry } from "../history.js";
import type { RunRecord } from "../runsHistory.js";
import type { ReelAuditEvent, ReelRecord, ReelStateReport } from "../reels/state.js";

// ---- content-calendar.json — dedupe por `tema` (mesma chave que o app usa em markTopicPublished) ----

export function mergeContentCalendar(remote: CalendarTopic[], local: CalendarTopic[]): CalendarTopic[] {
  const byTema = new Map<string, CalendarTopic>();
  for (const t of [...remote, ...local]) {
    const existing = byTema.get(t.tema);
    if (!existing) { byTema.set(t.tema, t); continue; }
    if (t.publicado && !existing.publicado) { byTema.set(t.tema, t); continue; }
    if (!t.publicado && existing.publicado) continue; // nunca regride um tópico já publicado
    const existingTime = existing.publicadoEm ?? existing.createdAt ?? "";
    const time = t.publicadoEm ?? t.createdAt ?? "";
    if (time > existingTime) byTema.set(t.tema, t);
  }
  return [...byTema.values()];
}

// ---- post-history.json — dedupe por `slug`, mais recente por `publicadoEm` vence ----

export function mergePostHistory(remote: HistoryEntry[], local: HistoryEntry[], limit = 200): HistoryEntry[] {
  const bySlug = new Map<string, HistoryEntry>();
  for (const e of [...remote, ...local]) {
    const existing = bySlug.get(e.slug);
    if (!existing || e.publicadoEm > existing.publicadoEm) bySlug.set(e.slug, e);
  }
  return [...bySlug.values()].sort((a, b) => b.publicadoEm.localeCompare(a.publicadoEm)).slice(0, limit);
}

// ---- content-registry.json — dedupe por `contentId`; "published" nunca regride para draft ----

const REGISTRY_STATUS_RANK: Record<ContentRegistryEntry["status"], number> = {
  "draft-pending-approval": 0,
  published: 1,
};

export function mergeContentRegistry(remote: ContentRegistryEntry[], local: ContentRegistryEntry[]): ContentRegistryEntry[] {
  const byId = new Map<string, ContentRegistryEntry>();
  for (const e of [...remote, ...local]) {
    const existing = byId.get(e.contentId);
    if (!existing) { byId.set(e.contentId, e); continue; }
    const existingRank = REGISTRY_STATUS_RANK[existing.status];
    const rank = REGISTRY_STATUS_RANK[e.status];
    if (rank > existingRank || (rank === existingRank && e.publicadoEm > existing.publicadoEm)) byId.set(e.contentId, e);
  }
  return [...byId.values()];
}

// ---- runs-history.json — dedupe por `id`, mais recente por `finalizadoEm` vence, ordenado por iniciadoEm desc ----

export function mergeRunsHistory(remote: RunRecord[], local: RunRecord[], limit = 100): RunRecord[] {
  const byId = new Map<string, RunRecord>();
  for (const r of [...remote, ...local]) {
    const existing = byId.get(r.id);
    if (!existing || r.finalizadoEm > existing.finalizadoEm) byId.set(r.id, r);
  }
  return [...byId.values()].sort((a, b) => b.iniciadoEm.localeCompare(a.iniciadoEm)).slice(0, limit);
}

// ---- reel-state.json — dedupe por `id`, status nunca regride; funde audit e campos preenchidos de cada lado ----

const REEL_STATUS_RANK: Record<ReelRecord["status"], number> = {
  queued: 1,
  rendering: 2,
  failed: 2.5,
  pending_approval: 3,
  rejected: 3.5,
  approved: 4,
  publishing: 5,
  published: 6,
};

function auditKey(event: ReelAuditEvent): string {
  return `${event.from}->${event.to}@${event.at}`;
}

function mergeReelAudit(a: ReelRecord, b: ReelRecord): ReelAuditEvent[] {
  const byKey = new Map<string, ReelAuditEvent>();
  for (const event of [...a.audit, ...b.audit]) byKey.set(auditKey(event), event);
  return [...byKey.values()].sort((x, y) => x.at.localeCompare(y.at)).slice(-100);
}

function mergeTwoReelRecords(a: ReelRecord, b: ReelRecord): ReelRecord {
  const rankA = REEL_STATUS_RANK[a.status];
  const rankB = REEL_STATUS_RANK[b.status];
  const winner = rankA !== rankB ? (rankA > rankB ? a : b) : (a.updatedAt >= b.updatedAt ? a : b);
  const loser = winner === a ? b : a;
  return {
    ...loser,
    ...winner,
    videoId: winner.videoId ?? loser.videoId,
    videoUrl: winner.videoUrl ?? loser.videoUrl,
    mediaId: winner.mediaId ?? loser.mediaId,
    permalink: winner.permalink ?? loser.permalink,
    error: winner.error ?? loser.error,
    createdAt: winner.createdAt < loser.createdAt ? winner.createdAt : loser.createdAt,
    audit: mergeReelAudit(winner, loser),
  };
}

export function mergeReelState(remote: ReelStateReport | null | undefined, local: ReelStateReport | null | undefined): ReelStateReport {
  const byId = new Map<string, ReelRecord>();
  for (const entry of remote?.entries ?? []) byId.set(entry.id, entry);
  for (const entry of local?.entries ?? []) {
    const existing = byId.get(entry.id);
    byId.set(entry.id, existing ? mergeTwoReelRecords(existing, entry) : entry);
  }
  return { updatedAt: new Date().toISOString(), entries: [...byId.values()] };
}

// ---- orquestração ----

export interface WorkspaceStateFiles {
  contentCalendar?: { topicos: CalendarTopic[] } | null;
  contentRegistry?: ContentRegistryEntry[] | null;
  postHistory?: HistoryEntry[] | null;
  runsHistory?: RunRecord[] | null;
  reelState?: ReelStateReport | null;
}

export interface MergedWorkspaceState {
  contentCalendar: { topicos: CalendarTopic[] };
  contentRegistry: ContentRegistryEntry[];
  postHistory: HistoryEntry[];
  runsHistory: RunRecord[];
  reelState: ReelStateReport;
}

export function mergeWorkspaceState(remote: WorkspaceStateFiles, local: WorkspaceStateFiles): MergedWorkspaceState {
  return {
    contentCalendar: { topicos: mergeContentCalendar(remote.contentCalendar?.topicos ?? [], local.contentCalendar?.topicos ?? []) },
    contentRegistry: mergeContentRegistry(remote.contentRegistry ?? [], local.contentRegistry ?? []),
    postHistory: mergePostHistory(remote.postHistory ?? [], local.postHistory ?? []),
    runsHistory: mergeRunsHistory(remote.runsHistory ?? [], local.runsHistory ?? []),
    reelState: mergeReelState(remote.reelState, local.reelState),
  };
}
