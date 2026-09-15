import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useWorkspace } from "../../hooks/useWorkspace";
import { apiGet, apiPost } from "../../lib/api";
import { formatDateTime } from "../../lib/formatters";
import { REEL_STATUS_COLOR, reelCardStatusLabel } from "../../lib/reelStatus";
import { REEL_TABS, filterReelsByTab, type ReelTab } from "./reelTabs";
import type { ReelDashboardResponse, ReelListEntry } from "../../types/api";

function ReelThumbnail({ entry }: { entry: ReelListEntry }) {
  if (entry.videoUrl) {
    return <video src={entry.videoUrl} muted className="h-20 w-14 shrink-0 rounded-md bg-app object-cover" />;
  }
  return (
    <div className="flex h-20 w-14 shrink-0 items-center justify-center rounded-md bg-app text-lg text-secondary" aria-hidden="true">
      🎬
    </div>
  );
}

function ReelActions({ entry, busyId, onReview, onPublish }: {
  entry: ReelListEntry;
  busyId: string | null;
  onReview: (id: string, decision: "approved" | "rejected") => void;
  onPublish: (id: string) => void;
}) {
  const busy = busyId === entry.id;
  if (entry.status === "pending_approval") {
    return (
      <div className="flex shrink-0 gap-2">
        <button type="button" disabled={busy} onClick={() => onReview(entry.id, "approved")} className="rounded-md bg-accent px-3 py-1.5 text-sm text-white disabled:opacity-50">Aprovar</button>
        <button type="button" disabled={busy} onClick={() => onReview(entry.id, "rejected")} className="rounded-md border border-border px-3 py-1.5 text-sm text-secondary disabled:opacity-50">Rejeitar</button>
      </div>
    );
  }
  if (entry.status === "approved") {
    return (
      <button type="button" disabled={busy} onClick={() => onPublish(entry.id)} className="shrink-0 rounded-md bg-accent px-3 py-1.5 text-sm text-white disabled:opacity-50">Publicar</button>
    );
  }
  if (entry.status === "published" && entry.permalink) {
    return <a href={entry.permalink} target="_blank" rel="noreferrer" className="shrink-0 text-sm font-semibold text-accent hover:underline">Ver no Instagram</a>;
  }
  return null;
}

function ReelCard({ entry, busyId, onReview, onPublish }: {
  entry: ReelListEntry;
  busyId: string | null;
  onReview: (id: string, decision: "approved" | "rejected") => void;
  onPublish: (id: string) => void;
}) {
  const color = REEL_STATUS_COLOR[entry.status];
  return (
    <div className="flex items-center gap-4 rounded-lg border border-border bg-surface p-3">
      <ReelThumbnail entry={entry} />
      <div className="min-w-0 flex-1">
        <Link to={`/reels/${entry.id}`} className="block truncate text-sm font-semibold text-primary hover:text-accent">{entry.title}</Link>
        <div className="mt-1 flex items-center gap-1.5 text-sm">
          <span className={`h-2 w-2 shrink-0 rounded-full ${color.dot}`} aria-hidden="true" />
          <span className={color.text}>{reelCardStatusLabel(entry)}</span>
        </div>
        <div className="mt-1 text-xs text-secondary">
          {entry.createdAt ? `Criado em ${formatDateTime(entry.createdAt)}` : `Atualizado em ${formatDateTime(entry.updatedAt)}`}
        </div>
      </div>
      <ReelActions entry={entry} busyId={busyId} onReview={onReview} onPublish={onPublish} />
    </div>
  );
}

export function ReelApprovalPanel() {
  const { workspace } = useWorkspace();
  const [data, setData] = useState<ReelDashboardResponse | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<ReelTab>("todos");

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
    () => [...(data?.entries ?? [])].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [data],
  );
  const visible = useMemo(() => filterReelsByTab(entries, tab), [entries, tab]);

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

  return (
    <div className="p-6 text-primary">
      <h1 className="text-xl font-semibold">Reels</h1>
      <p className="text-sm text-secondary">Gerencie a produção e publicação dos seus vídeos</p>

      <div role="tablist" className="mb-4 mt-4 flex flex-wrap gap-2 border-b border-border" aria-label="Filtro de Reels">
        {REEL_TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            className={`px-3 py-2 text-sm ${tab === t.id ? "border-b-2 border-accent text-primary" : "text-secondary"}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {error ? <p className="mb-3 text-sm text-status-error">{error}</p> : null}

      {!data ? (
        <p className="text-sm text-secondary">Aguardando dados</p>
      ) : visible.length === 0 ? (
        <p className="text-sm text-secondary">Nenhum Reel nesta categoria.</p>
      ) : (
        <div className="space-y-3">
          {visible.map((entry) => (
            <ReelCard key={entry.id} entry={entry} busyId={busyId} onReview={review} onPublish={publish} />
          ))}
        </div>
      )}
    </div>
  );
}
