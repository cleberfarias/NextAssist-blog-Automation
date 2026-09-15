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
