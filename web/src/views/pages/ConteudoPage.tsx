import { useEffect, useState } from "react";
import { useWorkspace } from "../../hooks/useWorkspace";
import { apiGet } from "../../lib/api";
import type { CalendarTopic } from "../../types/api";

export function ConteudoPage() {
  const { workspace } = useWorkspace();
  const [topics, setTopics] = useState<CalendarTopic[] | null>(null);

  useEffect(() => {
    if (!workspace) return;
    const controller = new AbortController();
    apiGet<CalendarTopic[]>("/api/content-calendar", workspace, controller.signal, "Não foi possível carregar o calendário.")
      .then(setTopics)
      .catch((err) => { if ((err as Error).name !== "AbortError") setTopics([]); });
    return () => controller.abort();
  }, [workspace]);

  if (!topics) return <div className="p-6 text-secondary">Aguardando dados</div>;

  const pending = topics.filter((t) => !t.publicado);
  const published = topics.filter((t) => t.publicado);

  return (
    <div className="p-6 text-primary">
      <h1 className="text-xl font-semibold">Conteúdo</h1>
      <p className="text-sm text-secondary">Backlog de pautas — publicadas aparecem também em Blog.</p>

      <section className="mt-6">
        <h2 className="mb-2 font-semibold">Pendentes ({pending.length})</h2>
        <ul className="space-y-1">
          {pending.map((t) => (
            <li key={t.tema} className="rounded-md border border-border bg-surface p-3 text-sm">
              <strong>{t.tema}</strong> <span className="text-secondary">— {t.palavraChaveAlvo}</span>
              {t.priority ? <span className="ml-2 text-xs text-accent">{t.priority}</span> : null}
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-6">
        <h2 className="mb-2 font-semibold">Publicadas ({published.length})</h2>
        <ul className="space-y-1">
          {published.map((t) => (
            <li key={t.tema} className="rounded-md border border-border bg-surface p-3 text-sm text-secondary">
              {t.tema}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
