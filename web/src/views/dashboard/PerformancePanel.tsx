import { useEffect, useState } from "react";
import { useWorkspace } from "../../hooks/useWorkspace";
import { useToast } from "../../components/ui/Toast";
import { apiGet, apiPost } from "../../lib/api";
import { usePagination } from "../../hooks/usePagination";
import { nf, formatDateTime } from "../../lib/formatters";
import type { PerformanceReport, PostPerformance } from "../../types/api";

const PAGE_SIZE = 6;

function isoDateWithOffset(offsetDays: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

function Kpi({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="kpi">
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
    </div>
  );
}

function Kpis({ posts }: { posts: PostPerformance[] }) {
  const totalClicks = posts.reduce((s, p) => s + (p.clicks || 0), 0);
  const totalImpr = posts.reduce((s, p) => s + (p.impressions || 0), 0);
  const ctr = totalImpr > 0 ? (totalClicks / totalImpr) * 100 : 0;
  const comPos = posts.filter((p) => p.position > 0 && p.impressions > 0);
  const somaImpr = comPos.reduce((s, p) => s + p.impressions, 0);
  const posMedia = somaImpr > 0 ? comPos.reduce((s, p) => s + p.position * p.impressions, 0) / somaImpr : 0;
  const indexados = posts.filter((p) => p.indexado).length;

  return (
    <div className="kpi-row">
      <Kpi label="Cliques" value={nf.format(totalClicks)} />
      <Kpi label="Impressões" value={nf.format(totalImpr)} />
      <Kpi label="CTR médio" value={`${ctr.toFixed(1)}%`} />
      <Kpi label="Posição média" value={posMedia > 0 ? posMedia.toFixed(1) : "—"} />
      <Kpi label="Indexados" value={<>{indexados}<span className="kpi-of">/{posts.length}</span></>} />
    </div>
  );
}

function Chart({ posts }: { posts: PostPerformance[] }) {
  const top = [...posts].filter((p) => p.impressions > 0).sort((a, b) => b.impressions - a.impressions).slice(0, 8);
  if (!top.length) {
    return <div className="chart-empty">Nenhuma impressão registrada no período ainda — os dados aparecem alguns dias após a publicação.</div>;
  }
  const max = top[0].impressions;
  return (
    <>
      {top.map((p) => {
        const pct = Math.max(2, (p.impressions / max) * 100);
        return (
          <div key={p.slug} className="bar-row" title={`${p.titulo} — ${nf.format(p.impressions)} impressões · ${p.clicks} cliques`}>
            <div className="bar-label"><a href={p.url} target="_blank" rel="noopener noreferrer">{p.titulo}</a></div>
            <div className="bar-track">
              <div className="bar-fill" style={{ width: `${pct}%` }}></div>
              <span className="bar-value">{nf.format(p.impressions)}</span>
            </div>
          </div>
        );
      })}
    </>
  );
}

export function PerformancePanel() {
  const { workspace } = useWorkspace();
  const { showToast } = useToast();
  const [report, setReport] = useState<PerformanceReport | null>(null);
  const [start, setStart] = useState(isoDateWithOffset(-28));
  const [end, setEnd] = useState(isoDateWithOffset(0));
  const [refreshing, setRefreshing] = useState(false);
  const { page, totalPages, pageItems, next, previous } = usePagination(report?.posts ?? [], PAGE_SIZE);

  useEffect(() => {
    if (!workspace) return;
    const controller = new AbortController();
    apiGet<PerformanceReport>("/api/performance", workspace, controller.signal)
      .then((data) => {
        setReport(data);
        if (data.posts.length) {
          setStart(data.periodo.inicio);
          setEnd(data.periodo.fim);
        }
      })
      .catch((err) => { if ((err as Error).name !== "AbortError") showToast((err as Error).message, "error"); });
    return () => controller.abort();
  }, [workspace]);

  const refresh = async () => {
    if (!start || !end) { showToast("Informe as datas de início e fim."); return; }
    if (start > end) { showToast("A data inicial não pode ser posterior à data final."); return; }
    setRefreshing(true);
    try {
      const data = await apiPost<PerformanceReport>("/api/performance/refresh", { inicio: start, fim: end, workspaceId: workspace });
      setReport(data);
      setStart(data.periodo.inicio);
      setEnd(data.periodo.fim);
      showToast("Métricas atualizadas com sucesso.", "success");
    } catch (err) {
      showToast((err as Error).message ?? "Falha ao atualizar métricas.", "error");
    } finally {
      setRefreshing(false);
    }
  };

  const today = isoDateWithOffset(0);
  const posts = report?.posts ?? [];

  return (
    <section className="performance-panel">
      <div className="perf-header">
        <h2>Desempenho no Google</h2>
        <div className="perf-meta">
          <span id="perf-updated">{report && posts.length ? `Atualizado ${formatDateTime(report.atualizadoEm)} · período ${report.periodo.inicio} a ${report.periodo.fim} · ${posts.length} posts` : "Nunca atualizado"}</span>
          <div className="perf-period">
            <label htmlFor="perf-start">De</label>
            <input id="perf-start" type="date" value={start} max={today} onChange={(e) => setStart(e.target.value)} />
            <label htmlFor="perf-end">até</label>
            <input id="perf-end" type="date" value={end} max={today} onChange={(e) => setEnd(e.target.value)} />
          </div>
          <button id="refresh-perf-btn" onClick={() => void refresh()} disabled={refreshing}>
            {refreshing ? "⏳ Consultando o Google..." : "↻ Atualizar métricas"}
          </button>
        </div>
      </div>

      <div>{posts.length > 0 && <Kpis posts={posts} />}</div>

      <div className="perf-chart-card">
        <div className="perf-chart-title">Top posts por impressões</div>
        <div className="perf-chart">
          {posts.length > 0 ? <Chart posts={posts} /> : <div className="chart-empty">Sem dados ainda.</div>}
        </div>
      </div>

      <div className="perf-table-wrap">
        <table id="perf-table">
          <thead><tr><th>Post</th><th>Indexado</th><th>Cliques</th><th>Impressões</th><th>CTR</th><th>Posição</th></tr></thead>
          <tbody>
            {posts.length === 0 ? (
              <tr className="empty"><td colSpan={6}>Sem dados ainda. Clique em &quot;Atualizar métricas&quot;.</td></tr>
            ) : (
              pageItems.map((p) => (
                <tr key={p.slug}>
                  <td><a href={p.url} target="_blank" rel="noopener noreferrer">{p.titulo}</a></td>
                  <td>
                    {p.erro ? (
                      <span className="idx idx-err" title={p.erro}>erro</span>
                    ) : p.indexado ? (
                      <span className="idx idx-ok" title={p.coverageState}>sim</span>
                    ) : (
                      <span className="idx idx-no" title={p.coverageState}>não</span>
                    )}
                  </td>
                  <td>{p.clicks}</td>
                  <td>{p.impressions}</td>
                  <td>{(p.ctr * 100).toFixed(1)}%</td>
                  <td>{p.position ? p.position.toFixed(1) : "—"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {totalPages > 1 && (
        <div className="pagination" aria-label="Paginação do desempenho">
          <button onClick={previous} disabled={page === 1}>Anterior</button>
          <span className="page-label">Página {page} de {totalPages}</span>
          <button onClick={next} disabled={page === totalPages}>Próxima</button>
        </div>
      )}
    </section>
  );
}
