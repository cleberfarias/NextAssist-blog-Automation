import { REEL_STATUS_LABEL } from "../../../lib/reelStatus";
import type { CalendarTopic, ReelListEntry } from "../../../types/api";

export type ContentEventType = "blog" | "reel";

export interface ContentCalendarEvent {
  id: string;
  type: ContentEventType;
  title: string;
  date: Date;
  statusLabel: string;
  href?: string;
}

/**
 * Projeta apenas conteúdo com data real (posts publicados e Reels com
 * histórico de atualização) num formato pronto pro calendário. Pautas sem
 * data agendada não entram aqui de propósito — não há data real pra plotar.
 */
export function buildContentCalendarEvents(topics: CalendarTopic[], reels: ReelListEntry[]): ContentCalendarEvent[] {
  const blogEvents: ContentCalendarEvent[] = topics
    .filter((t): t is CalendarTopic & { publicadoEm: string } => Boolean(t.publicado && t.publicadoEm))
    .map((t) => ({
      id: `blog-${t.tema}-${t.publicadoEm}`,
      type: "blog",
      title: t.tema,
      date: new Date(t.publicadoEm),
      statusLabel: "Publicado",
    }));

  const reelEvents: ContentCalendarEvent[] = reels
    .filter((r) => Boolean(r.updatedAt))
    .map((r) => ({
      id: `reel-${r.id}`,
      type: "reel",
      title: r.title,
      date: new Date(r.updatedAt),
      statusLabel: REEL_STATUS_LABEL[r.status],
      href: `/reels/${r.id}`,
    }));

  return [...blogEvents, ...reelEvents].sort((a, b) => a.date.getTime() - b.date.getTime());
}
