import type { ReelListEntry, ReelStatus } from "../../types/api";

export type ReelTab = "todos" | "em_producao" | "aguardando_aprovacao" | "publicados" | "rejeitados";

export const REEL_TABS: { id: ReelTab; label: string }[] = [
  { id: "todos", label: "Todos" },
  { id: "em_producao", label: "Em produção" },
  { id: "aguardando_aprovacao", label: "Aguardando aprovação" },
  { id: "publicados", label: "Publicados" },
  { id: "rejeitados", label: "Rejeitados" },
];

const TAB_STATUSES: Record<Exclude<ReelTab, "todos">, ReelStatus[]> = {
  em_producao: ["queued", "rendering", "approved", "publishing"],
  aguardando_aprovacao: ["pending_approval"],
  publicados: ["published"],
  rejeitados: ["rejected", "failed"],
};

export function filterReelsByTab(entries: ReelListEntry[], tab: ReelTab): ReelListEntry[] {
  if (tab === "todos") return entries;
  return entries.filter((e) => TAB_STATUSES[tab].includes(e.status));
}
