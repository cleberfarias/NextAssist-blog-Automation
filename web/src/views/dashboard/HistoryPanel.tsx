import { useEffect, useState } from "react";
import { useWorkspace } from "../../hooks/useWorkspace";
import { useToast } from "../../components/ui/Toast";
import { apiGet } from "../../lib/api";
import { usePagination } from "../../hooks/usePagination";
import { formatDateTime } from "../../lib/formatters";
import type { HistoryEntry } from "../../types/api";

const PAGE_SIZE = 6;

export function HistoryPanel() {
  const { workspace } = useWorkspace();
  const { showToast } = useToast();
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const { page, totalPages, pageItems, next, previous } = usePagination(entries, PAGE_SIZE);

  useEffect(() => {
    if (!workspace) return;
    const controller = new AbortController();
    apiGet<HistoryEntry[]>("/api/history", workspace, controller.signal)
      .then(setEntries)
      .catch((err) => { if ((err as Error).name !== "AbortError") showToast((err as Error).message, "error"); });
    return () => controller.abort();
  }, [workspace]);

  return (
    <aside className="history-panel">
      <h2>Posts publicados</h2>
      {entries.length === 0 ? (
        <ul><li className="empty">Nenhum post publicado ainda.</li></ul>
      ) : (
        <ul>
          {pageItems.map((entry) => (
            <li key={entry.slug}>
              <span className="h-title">{entry.titulo}</span>
              <span className="h-date">{formatDateTime(entry.publicadoEm)}</span>
            </li>
          ))}
        </ul>
      )}
      {totalPages > 1 && (
        <div className="pagination" aria-label="Paginação dos posts">
          <button onClick={previous} disabled={page === 1}>Anterior</button>
          <span className="page-label">Página {page} de {totalPages}</span>
          <button onClick={next} disabled={page === totalPages}>Próxima</button>
        </div>
      )}
    </aside>
  );
}
