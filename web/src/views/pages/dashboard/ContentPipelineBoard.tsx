import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useWorkspace } from "../../../hooks/useWorkspace";
import { usePipeline } from "../../../hooks/usePipeline";
import { apiGet } from "../../../lib/api";
import { PIPELINE_STAGES, type PipelineStage } from "../../../lib/pipelineStages";
import { STATUS_LABEL } from "../../dashboard/LiveStatus";
import { computePipelineStats } from "./contentPipelineStats";
import { STATUS_DOT } from "./AgentBubble";
import { pipelineStatusToOperational, type AgentOperationalStatus } from "../../../hooks/useAgentOperations";
import type { AgentStatus, RunRecord, CalendarTopic } from "../../../types/api";

/**
 * Imagem de cenário da equipe de conteúdo — decorativa. Os 8 cards logo
 * abaixo ficam alinhados com a posição de cada pessoa na foto (pessoas
 * praticamente equidistantes, por isso uma grade de 8 colunas iguais já
 * alinha sem precisar de posicionamento por porcentagem). Se o arquivo não
 * existir em `web/public/content-pipeline-bg.png`, cai para um gradiente.
 */
const BACKGROUND_SRC = "/content-pipeline-bg.png";
const BACKGROUND_ASPECT = "1942 / 809";

const STATUS_PILL: Record<AgentOperationalStatus, string> = {
  completed: "bg-status-ok/15 text-status-ok",
  working: "bg-accent/15 text-accent",
  waiting: "bg-status-warn/15 text-status-warn",
  needs_attention: "bg-status-warn/15 text-status-warn",
  failed: "bg-status-error/15 text-status-error",
  idle: "bg-secondary/15 text-secondary",
};

const RUN_MODE_LABEL: Record<string, string> = {
  local: "Execução manual (local)",
  dispatch: "GitHub Actions",
  disabled: "Execução manual desabilitada",
};

function useWorkspaceData<T>(path: string): T | null {
  const { workspace } = useWorkspace();
  const [data, setData] = useState<T | null>(null);
  useEffect(() => {
    if (!workspace) return;
    const controller = new AbortController();
    apiGet<T>(path, workspace, controller.signal).then(setData).catch((err) => {
      if ((err as Error).name !== "AbortError") setData(null);
    });
    return () => controller.abort();
  }, [workspace, path]);
  return data;
}

function KpiCard({ icon, label, value, hint }: { icon: string; label: string; value: string; hint: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="flex items-center gap-2 text-secondary"><span aria-hidden="true">{icon}</span><span className="text-sm">{label}</span></div>
      <div className="mt-1 text-xl font-semibold text-primary">{value}</div>
      <div className="text-xs text-secondary">{hint}</div>
    </div>
  );
}

function StageCard({ index, stage, status, count }: { index: number; stage: PipelineStage; status: AgentStatus; count: number }) {
  const operational = pipelineStatusToOperational(status);
  return (
    <Link
      to={`/agentes/${stage.id}`}
      className="rounded-b-lg border border-t-0 border-border bg-surface p-2.5 hover:border-accent sm:rounded-none sm:first:rounded-bl-lg sm:last:rounded-br-lg"
    >
      <div className="flex items-center gap-1.5">
        <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white ${STATUS_DOT[operational]}`}>{index + 1}</span>
        <span aria-hidden="true">{stage.icon}</span>
      </div>
      <div className="mt-2 text-xs font-semibold text-primary">{stage.label}</div>
      <p className="mt-1 text-[11px] leading-snug text-secondary">{stage.description}</p>
      <span className={`mt-2 inline-block rounded-full px-2 py-0.5 text-[10px] ${STATUS_PILL[operational]}`}>{STATUS_LABEL[status]}</span>
      <div className="mt-2 text-[10px] text-secondary">{count} concluído(s) · 7 dias</div>
    </Link>
  );
}

export function ContentPipelineBoard() {
  const { desks, running, topicLine, runMode } = usePipeline();
  const runs = useWorkspaceData<RunRecord[]>("/api/runs");
  const topics = useWorkspaceData<CalendarTopic[]>("/api/content-calendar");
  const stats = computePipelineStats(runs ?? [], topics ?? [], new Date());
  const [imageFailed, setImageFailed] = useState(false);

  const completedStages = PIPELINE_STAGES.filter((s) => desks[s.id]?.status === "done").length;
  const currentStage = PIPELINE_STAGES.find((s) => desks[s.id]?.status === "working");
  const progressPct = Math.round((completedStages / PIPELINE_STAGES.length) * 100);

  return (
    <div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard icon="📄" label="Conteúdos no pipeline" value={String(stats.pendingContent)} hint="em processamento" />
        <KpiCard icon="✅" label="Concluídos" value={String(stats.completedLast7Days)} hint="nos últimos 7 dias" />
        <KpiCard icon="⏱️" label="Tempo médio" value={stats.avgDurationMinutes != null ? `${stats.avgDurationMinutes} min` : "—"} hint="por conteúdo" />
        <KpiCard icon="📈" label="Taxa de publicação" value={stats.publishRate != null ? `${stats.publishRate}%` : "—"} hint="dos conteúdos criados" />
      </div>

      <div className="mt-6 flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-primary">Fluxo da sua equipe de {PIPELINE_STAGES.length} agentes</h3>
          <p className="text-sm text-secondary">Cada agente tem uma função específica no processo de criação e publicação de conteúdo.</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full border border-border bg-surface px-3 py-1 text-xs text-secondary">{RUN_MODE_LABEL[runMode] ?? runMode}</span>
          <Link to="/relatorios" className="rounded-md border border-border px-3 py-1.5 text-sm text-primary hover:border-accent">Ver detalhes →</Link>
        </div>
      </div>

      <div className="relative mt-4 overflow-hidden rounded-t-lg bg-gradient-to-br from-app to-surface" style={{ aspectRatio: BACKGROUND_ASPECT }}>
        {!imageFailed && (
          <img
            src={BACKGROUND_SRC}
            alt=""
            aria-hidden="true"
            className="absolute inset-0 h-full w-full object-cover"
            onError={() => setImageFailed(true)}
          />
        )}
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8">
        {PIPELINE_STAGES.map((stage, index) => (
          <StageCard key={stage.id} index={index} stage={stage} status={desks[stage.id]?.status ?? "idle"} count={stats.stageCounts[stage.id]} />
        ))}
      </div>

      <section className="mt-6 rounded-lg border border-border bg-surface p-4">
        <h3 className="mb-3 font-semibold text-primary">Conteúdo em andamento</h3>
        {running ? (
          <div>
            <div className="flex justify-between text-sm"><span className="text-primary">{topicLine}</span><span className="text-secondary">{currentStage?.label ?? "—"} · {progressPct}%</span></div>
            <div className="mt-1 h-2 rounded-full bg-app"><div className="h-2 rounded-full bg-accent" style={{ width: `${progressPct}%` }} /></div>
          </div>
        ) : (
          <p className="text-sm text-secondary">Nenhum conteúdo em produção no momento.</p>
        )}
      </section>
    </div>
  );
}
