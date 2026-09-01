import { useEffect, useState } from "react";
import { useWorkspace } from "../../hooks/useWorkspace";
import { useToast } from "../../components/ui/Toast";
import { apiGet, apiPost } from "../../lib/api";
import { nf } from "../../lib/formatters";
import type { InstagramPerformance } from "../../types/api";

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="kpi">
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
    </div>
  );
}

export function InstagramPerformancePanel() {
  const { workspace } = useWorkspace();
  const { showToast } = useToast();
  const [items, setItems] = useState<InstagramPerformance[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    if (!workspace) return;
    const controller = new AbortController();
    apiGet<InstagramPerformance[]>(
      "/api/instagram-performance",
      workspace,
      controller.signal,
      "Não foi possível carregar as métricas do Instagram.",
    )
      .then(setItems)
      .catch((err) => { if ((err as Error).name !== "AbortError") showToast((err as Error).message, "error"); });
    return () => controller.abort();
  }, [workspace]);

  const refresh = async () => {
    setRefreshing(true);
    try {
      const data = await apiPost<InstagramPerformance[]>(
        "/api/instagram-performance/refresh",
        { workspaceId: workspace },
        undefined,
        "Não foi possível atualizar as métricas do Instagram.",
      );
      setItems(data);
    } catch (err) {
      showToast((err as Error).message, "error");
    } finally {
      setRefreshing(false);
    }
  };

  const total = (key: keyof InstagramPerformance) => (items ?? []).reduce((sum, item) => sum + ((item[key] as number) || 0), 0);

  return (
    <section className="usage-panel instagram-performance-panel">
      <div className="usage-header">
        <div><h2>Desempenho no Instagram</h2><p>Insights dos Reels publicados.</p></div>
        <button id="refresh-instagram-btn" onClick={() => void refresh()} disabled={refreshing}>↻ Atualizar métricas</button>
      </div>
      <div className="kpi-row">
        <Kpi label="Reproduções" value={nf.format(total("plays"))} />
        <Kpi label="Alcance" value={nf.format(total("reach"))} />
        <Kpi label="Curtidas" value={nf.format(total("likes"))} />
        <Kpi label="Comentários" value={nf.format(total("comments"))} />
        <Kpi label="Compartilhamentos" value={nf.format(total("shares"))} />
      </div>
      {items && items.length > 0 ? (
        <div className="perf-table-wrap">
          <table>
            <thead><tr><th>Reel</th><th>Reproduções</th><th>Alcance</th><th>Curtidas</th><th>Comentários</th><th>Salvos</th></tr></thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.contentId}>
                  <td>{item.tema}</td>
                  <td>{nf.format(item.plays)}</td>
                  <td>{nf.format(item.reach)}</td>
                  <td>{nf.format(item.likes)}</td>
                  <td>{nf.format(item.comments)}</td>
                  <td>{nf.format(item.saved)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="empty">Nenhum Reel medido ainda.</p>
      )}
    </section>
  );
}
