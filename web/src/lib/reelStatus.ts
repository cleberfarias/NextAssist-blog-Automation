import type { ReelStatus } from "../types/api";

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
