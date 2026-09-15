import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useWorkspace } from "../../hooks/useWorkspace";
import { apiGet } from "../../lib/api";
import { formatDateTime } from "../../lib/formatters";
import { TIMELINE_STEP_LABEL, TIMELINE_STEP_ORDER } from "../../lib/reelStatus";
import type { ReelDetail } from "../../types/api";

export function ReelDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { workspace } = useWorkspace();
  const [detail, setDetail] = useState<ReelDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!workspace || !id) return;
    const controller = new AbortController();
    apiGet<ReelDetail>(`/api/reels/${encodeURIComponent(id)}`, workspace, controller.signal, "Não foi possível carregar o Reel.")
      .then(setDetail)
      .catch((err) => { if ((err as Error).name !== "AbortError") setError((err as Error).message); });
    return () => controller.abort();
  }, [workspace, id]);

  if (error) return <div className="p-6 text-status-error">{error}</div>;
  if (!detail) return <div className="p-6 text-secondary">Aguardando dados</div>;

  const completedSteps = new Set((detail.timelineSteps ?? []).map((s) => s.step));

  return (
    <div className="p-6 text-primary">
      <h1 className="text-xl font-semibold">{detail.title}</h1>
      <p className="text-sm text-secondary">{detail.slug} · atualizado {formatDateTime(detail.updatedAt)}</p>

      <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-2">
        <section className="rounded-lg border border-border bg-surface p-4">
          <h2 className="mb-3 font-semibold">Linha do tempo</h2>
          <ol className="space-y-2">
            {TIMELINE_STEP_ORDER.map((step) => (
              <li key={step} className={`flex items-center gap-2 text-sm ${completedSteps.has(step) ? "text-primary" : "text-secondary"}`}>
                <span aria-hidden="true">{completedSteps.has(step) ? "✅" : "○"}</span>
                {TIMELINE_STEP_LABEL[step]}
              </li>
            ))}
          </ol>
        </section>

        <section className="rounded-lg border border-border bg-surface p-4">
          <h2 className="mb-3 font-semibold">B-rolls utilizados</h2>
          {detail.scenes && detail.scenes.length > 0 ? (
            <ul className="space-y-2">
              {detail.scenes.filter((s) => s.type === "video").map((scene, i) => (
                <li key={`${scene.assetId}-${i}`} className="text-sm">{scene.label}</li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-secondary">Sem cenas registradas para este Reel.</p>
          )}
        </section>
      </div>

      {detail.videoUrl ? <a className="mt-4 inline-block text-accent" href={detail.videoUrl} target="_blank" rel="noreferrer">Abrir vídeo</a> : null}
      {detail.error ? <p className="mt-4 text-status-error">{detail.error}</p> : null}
    </div>
  );
}
