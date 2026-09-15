import type { CalendarTopic } from "../../../types/api";

const PRIORITY_LABEL: Record<NonNullable<CalendarTopic["priority"]>, string> = {
  high: "Alta prioridade",
  medium: "Média prioridade",
  low: "Baixa prioridade",
};

export function IdeiasTab({ topics, loading }: { topics: CalendarTopic[]; loading: boolean }) {
  if (loading) return <p className="mt-6 text-sm text-secondary">Aguardando dados</p>;

  const pending = topics.filter((t) => !t.publicado);
  if (pending.length === 0) return <p className="mt-6 text-sm text-secondary">Nenhuma pauta pendente no backlog.</p>;

  return (
    <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {pending.map((t) => (
        <div key={t.tema} className="rounded-lg border border-border bg-surface p-3">
          <strong className="text-sm text-primary">{t.tema}</strong>
          <p className="mt-1 text-xs text-secondary">{t.palavraChaveAlvo}</p>
          {t.priority ? <span className="mt-2 inline-block rounded-full bg-accent/15 px-2 py-0.5 text-[10px] text-accent">{PRIORITY_LABEL[t.priority]}</span> : null}
        </div>
      ))}
    </div>
  );
}
