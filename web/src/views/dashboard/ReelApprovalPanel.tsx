import { useEffect, useMemo, useState } from "react";
import { useWorkspace } from "../../hooks/useWorkspace";
import { apiGet, apiPost } from "../../lib/api";
import { formatDateTime, nf } from "../../lib/formatters";

type ReelStatus = "queued" | "rendering" | "pending_approval" | "approved" | "rejected" | "publishing" | "published" | "failed";

interface ReelAuditEvent {
  from: ReelStatus | null;
  to: ReelStatus;
  at: string;
  actor: "pipeline" | "human" | "system";
  note?: string;
}

interface ReelRecord {
  id: string;
  slug: string;
  title: string;
  blogUrl: string;
  caption: string;
  status: ReelStatus;
  videoUrl?: string;
  permalink?: string | null;
  error?: string;
  updatedAt: string;
  audit: ReelAuditEvent[];
}

interface ReelDashboardResponse {
  updatedAt: string | null;
  summary: { total: number; pendingApproval: number; approved: number; published: number; failed: number };
  entries: ReelRecord[];
}

function statusLabel(status: ReelStatus): string {
  const labels: Record<ReelStatus, string> = {
    queued: "Na fila",
    rendering: "Renderizando",
    pending_approval: "Aguardando aprovação",
    approved: "Aprovado",
    rejected: "Rejeitado",
    publishing: "Publicando",
    published: "Publicado",
    failed: "Falhou",
  };
  return labels[status];
}

function Kpi({ label, value }: { label: string; value: string }) {
  return <div className="kpi"><div className="kpi-label">{label}</div><div className="kpi-value">{value}</div></div>;
}

export function ReelApprovalPanel() {
  const { workspace } = useWorkspace();
  const [data, setData] = useState<ReelDashboardResponse | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load(signal?: AbortSignal) {
    if (!workspace) return;
    try {
      setData(await apiGet<ReelDashboardResponse>("/api/reels", workspace, signal));
    } catch (err) {
      if ((err as Error).name !== "AbortError") setError(err instanceof Error ? err.message : String(err));
    }
  }

  useEffect(() => {
    if (!workspace) return;
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [workspace]);

  const entries = useMemo(
    () => [...(data?.entries ?? [])].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 12),
    [data],
  );

  async function review(reelId: string, decision: "approved" | "rejected") {
    setBusyId(reelId);
    setError(null);
    try {
      await apiPost("/api/reels/review", { workspaceId: workspace, reelId, decision });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  }

  async function publish(reelId: string) {
    setBusyId(reelId);
    setError(null);
    try {
      await apiPost("/api/reels/publish", { workspaceId: workspace, reelId });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  }

  if (!data || !workspace) {
    return (
      <section className="usage-panel sales-panel">
        <div className="usage-header">
          <div><h2>Reels para aprovação</h2><p>Vídeos do HeyGen ficam bloqueados até revisão humana.</p></div>
          <span>Aguardando dados</span>
        </div>
      </section>
    );
  }

  return (
    <section className="usage-panel sales-panel">
      <div className="usage-header">
        <div><h2>Reels para aprovação</h2><p>Gerar, revisar e publicar são etapas separadas. Só Reel aprovado pode ir ao Instagram.</p></div>
        <span>{data.updatedAt ? `Atualizado ${formatDateTime(data.updatedAt)}` : "Sem drafts"}</span>
      </div>

      <div className="kpi-row">
        <Kpi label="Total" value={nf.format(data.summary.total)} />
        <Kpi label="Aguardando aprovação" value={nf.format(data.summary.pendingApproval)} />
        <Kpi label="Aprovados" value={nf.format(data.summary.approved)} />
        <Kpi label="Publicados" value={nf.format(data.summary.published)} />
        <Kpi label="Falhas" value={nf.format(data.summary.failed)} />
      </div>

      {error ? <p className="error-text">{error}</p> : null}
      {entries.length === 0 ? <p className="empty-state">Nenhum Reel foi gerado ainda.</p> : (
        <div className="perf-table-wrap">
          <table>
            <thead><tr><th>Conteúdo</th><th>Status</th><th>Prévia</th><th>Ações</th></tr></thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id}>
                  <td>
                    <strong>{entry.title}</strong>
                    <div className="muted">{entry.slug}</div>
                    <div className="muted">{formatDateTime(entry.updatedAt)}</div>
                    {entry.error ? <div className="error-text">{entry.error}</div> : null}
                  </td>
                  <td>{statusLabel(entry.status)}</td>
                  <td>
                    {entry.videoUrl ? <a href={entry.videoUrl} target="_blank" rel="noreferrer">Abrir vídeo</a> : "—"}
                    {entry.permalink ? <div><a href={entry.permalink} target="_blank" rel="noreferrer">Ver no Instagram</a></div> : null}
                  </td>
                  <td>
                    <div className="sales-review-actions">
                      <button type="button" disabled={busyId === entry.id || entry.status !== "pending_approval"} onClick={() => void review(entry.id, "approved")}>Aprovar</button>
                      <button type="button" disabled={busyId === entry.id || entry.status !== "pending_approval"} onClick={() => void review(entry.id, "rejected")}>Rejeitar</button>
                      <button type="button" disabled={busyId === entry.id || entry.status !== "approved"} onClick={() => void publish(entry.id)}>Publicar</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
