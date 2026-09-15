import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useAgentData } from "../../../hooks/useAgentOperations";
import { formatDateTime, formatElapsed } from "../../../lib/formatters";
import { REEL_STATUS_LABEL, TIMELINE_STEP_LABEL, TIMELINE_STEP_ORDER, pickFeaturedReel } from "../../../lib/reelStatus";
import type { ReelDashboardResponse, ReelStatus } from "../../../types/api";

const CARD_HEADING: Record<ReelStatus, string> = {
  queued: "Reel na fila",
  rendering: "Reel em processamento",
  pending_approval: "Reel aguardando aprovação",
  approved: "Reel aprovado",
  rejected: "Reel rejeitado",
  publishing: "Publicando Reel",
  published: "Último Reel publicado",
  failed: "Reel com falha",
};

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-t border-border py-2 text-sm first:border-t-0">
      <span className="text-secondary">{label}</span>
      <span className="text-right text-primary">{value}</span>
    </div>
  );
}

export function SocialAgentOverview() {
  const reelsData = useAgentData<ReelDashboardResponse>("/api/reels");
  const featured = useMemo(() => pickFeaturedReel(reelsData?.entries ?? []), [reelsData]);

  if (reelsData === null) return <p className="text-sm text-secondary">Aguardando dados</p>;
  if (!featured) return <p className="text-sm text-secondary">Nenhum Reel foi gerado ainda.</p>;

  const steps = featured.timelineSteps ?? [];
  const stepAt = new Map(steps.map((s) => [s.step, s.at]));
  const lastRecordedStep = steps.length > 0 ? steps[steps.length - 1].step : null;
  const isFullyPublished = lastRecordedStep === "publicado";

  const statusAtual = lastRecordedStep ? TIMELINE_STEP_LABEL[lastRecordedStep] : REEL_STATUS_LABEL[featured.status];
  const avatarScenes = (featured.scenes ?? []).filter((s) => s.type === "avatar_video").length;
  const brollScenes = (featured.scenes ?? []).filter((s) => s.type === "video").length;

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <section className="rounded-lg border border-border bg-surface p-4">
        <h2 className="mb-3 text-sm font-semibold text-secondary">{CARD_HEADING[featured.status]}</h2>

        {featured.videoUrl ? (
          <video src={featured.videoUrl} controls className="w-full rounded-lg bg-app" />
        ) : (
          <div className="flex aspect-[9/16] max-h-64 items-center justify-center rounded-lg bg-app text-sm text-secondary">
            Vídeo ainda sendo gerado
          </div>
        )}

        <Link to={`/reels/${featured.id}`} className="mt-3 block text-sm font-semibold text-primary hover:text-accent">{featured.title}</Link>
        <p className="mt-1 text-sm text-secondary">{featured.caption}</p>

        <div className="mt-3">
          <MetaRow label="Status atual" value={statusAtual} />
          {featured.videoId ? <MetaRow label="Video ID" value={featured.videoId} /> : null}
          {featured.avatarId ? <MetaRow label="Avatar" value={featured.avatarId} /> : null}
          {featured.voiceId ? <MetaRow label="Voz" value={featured.voiceId} /> : null}
          {featured.scenes && featured.scenes.length > 0 ? (
            <MetaRow label="Cenas" value={`${avatarScenes} avatar + ${brollScenes} B-roll`} />
          ) : null}
        </div>

        {featured.error ? <p className="mt-3 text-sm text-status-error">{featured.error}</p> : null}
      </section>

      <section className="rounded-lg border border-border bg-surface p-4">
        <h2 className="mb-3 font-semibold text-primary">Linha do tempo</h2>
        <ol className="space-y-3">
          {TIMELINE_STEP_ORDER.map((step) => {
            const at = stepAt.get(step);
            const isCurrent = step === lastRecordedStep && !isFullyPublished;
            return (
              <li key={step} className="flex items-start gap-2 text-sm">
                <span aria-hidden="true" className={isCurrent ? "text-accent" : at ? "text-status-ok" : "text-secondary"}>
                  {isCurrent ? "◐" : at ? "✅" : "○"}
                </span>
                <div>
                  <div className={at ? "text-primary" : "text-secondary"}>{TIMELINE_STEP_LABEL[step]}</div>
                  {at ? (
                    <div className="text-xs text-secondary">
                      {isCurrent ? `Em andamento há ${formatElapsed(at)}` : formatDateTime(at)}
                    </div>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ol>
      </section>
    </div>
  );
}
