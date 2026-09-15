import { Link } from "react-router-dom";
import { formatDateTime } from "../../../lib/formatters";
import type { CalendarTopic, ReelListEntry } from "../../../types/api";
import { buildContentCalendarEvents } from "./contentCalendarEvents";

export function BibliotecaTab({ topics, reels, loading }: { topics: CalendarTopic[]; reels: ReelListEntry[]; loading: boolean }) {
  if (loading) return <p className="mt-6 text-sm text-secondary">Aguardando dados</p>;

  const published = buildContentCalendarEvents(topics, reels)
    .filter((e) => e.statusLabel === "Publicado")
    .sort((a, b) => b.date.getTime() - a.date.getTime());

  if (published.length === 0) return <p className="mt-6 text-sm text-secondary">Nenhum conteúdo publicado ainda.</p>;

  return (
    <ul className="mt-4 space-y-1">
      {published.map((item) => {
        const row = (
          <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-surface p-3 text-sm">
            <div className="flex items-center gap-2 min-w-0">
              <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] ${item.type === "blog" ? "bg-status-ok/15 text-status-ok" : "bg-reel/15 text-reel"}`}>
                {item.type === "blog" ? "Blog" : "Reel"}
              </span>
              <strong className="truncate text-primary">{item.title}</strong>
            </div>
            <span className="shrink-0 text-xs text-secondary">{formatDateTime(item.date.toISOString())}</span>
          </div>
        );
        return (
          <li key={item.id}>
            {item.href ? <Link to={item.href} className="block hover:opacity-80">{row}</Link> : row}
          </li>
        );
      })}
    </ul>
  );
}
