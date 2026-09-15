import type { ReelListEntry, ReelStatus, TimelineStepName } from "../types/api";

export const REEL_STATUS_LABEL: Record<ReelStatus, string> = {
  queued: "Na fila",
  rendering: "Renderizando",
  pending_approval: "Aguardando aprovação",
  approved: "Aprovado",
  rejected: "Rejeitado",
  publishing: "Publicando",
  published: "Publicado",
  failed: "Falhou",
};

export const TIMELINE_STEP_LABEL: Record<TimelineStepName, string> = {
  roteiro_gerado: "Roteiro gerado pela IA",
  cenas_montadas: "Cenas montadas (Studio)",
  enviado_heygen: "Enviado para HeyGen",
  processando: "Processando na HeyGen",
  video_concluido: "Vídeo concluído",
  aguardando_aprovacao: "Aguardando sua aprovação",
  publicado: "Publicado no Instagram",
};

export const TIMELINE_STEP_ORDER: TimelineStepName[] = [
  "roteiro_gerado", "cenas_montadas", "enviado_heygen", "processando",
  "video_concluido", "aguardando_aprovacao", "publicado",
];

/**
 * Escolhe qual Reel merece destaque numa visão executiva: falha > em
 * processamento > aguardando aprovação > o mais recente. Nunca inventa um
 * Reel — retorna null se não houver nenhum.
 */
export function pickFeaturedReel(entries: ReelListEntry[]): ReelListEntry | null {
  if (entries.length === 0) return null;
  const failed = entries.find((e) => e.status === "failed");
  if (failed) return failed;
  const rendering = entries.find((e) => e.status === "rendering");
  if (rendering) return rendering;
  const pending = entries.find((e) => e.status === "pending_approval");
  if (pending) return pending;
  return [...entries].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
}

/** Extrai o código HTTP real de uma mensagem de erro do backend, se houver. */
export function extractHttpCode(error?: string): string | null {
  const match = error?.match(/HTTP\s+(\d+)/i);
  return match ? match[1] : null;
}

/** Rótulo do passo mais recente da timeline real, ou o status bruto quando não há timeline. */
export function currentStepLabel(entry: Pick<ReelListEntry, "status" | "timelineSteps">): string {
  const steps = entry.timelineSteps ?? [];
  const last = steps[steps.length - 1];
  return last ? TIMELINE_STEP_LABEL[last.step] : REEL_STATUS_LABEL[entry.status];
}

/** Rótulo de status pra um card de Reel: falha mostra o código HTTP real; os demais usam o passo atual. */
export function reelCardStatusLabel(entry: Pick<ReelListEntry, "status" | "timelineSteps" | "error">): string {
  if (entry.status === "failed") {
    const code = extractHttpCode(entry.error);
    return code ? `Falhou (${code})` : "Falhou";
  }
  return currentStepLabel(entry);
}

export const REEL_STATUS_COLOR: Record<ReelStatus, { dot: string; text: string }> = {
  queued: { dot: "bg-secondary", text: "text-secondary" },
  rendering: { dot: "bg-accent", text: "text-accent" },
  pending_approval: { dot: "bg-status-warn", text: "text-status-warn" },
  approved: { dot: "bg-status-ok", text: "text-status-ok" },
  rejected: { dot: "bg-status-error", text: "text-status-error" },
  publishing: { dot: "bg-accent", text: "text-accent" },
  published: { dot: "bg-status-ok", text: "text-status-ok" },
  failed: { dot: "bg-status-error", text: "text-status-error" },
};
