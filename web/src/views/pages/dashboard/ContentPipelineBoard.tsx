import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useWorkspace } from "../../../hooks/useWorkspace";
import { usePipeline } from "../../../hooks/usePipeline";
import { apiGet } from "../../../lib/api";
import { STATUS_LABEL } from "../../dashboard/LiveStatus";
import { computePipelineStats } from "./contentPipelineStats";
import type { AgentId, AgentStatus, RunRecord, CalendarTopic } from "../../../types/api";

const STAGES: { id: AgentId; label: string; icon: string; photoLeft: string }[] = [
  { id: "marketing-director", label: "Marketing Director", icon: "📊", photoLeft: "11%" },
  { id: "pesquisa-mercado", label: "Pesquisa de mercado", icon: "🔍", photoLeft: "23%" },
  { id: "pesquisa-pauta", label: "Pesquisa de pauta", icon: "🗂️", photoLeft: "35%" },
  { id: "redator", label: "Redação", icon: "✍️", photoLeft: "47%" },
  { id: "editor-seo", label: "Editor / SEO", icon: "🧐", photoLeft: "59%" },
  { id: "publicador", label: "Publicação", icon: "🚀", photoLeft: "71%" },
  { id: "instagram", label: "Instagram", icon: "📸", photoLeft: "83%" },
  { id: "indexador", label: "Indexação / Google", icon: "📈", photoLeft: "95%" },
];

/**
 * Imagem de cenário da equipe de conteúdo — decorativa, os 8 estágios já
 * são desenhados como componentes React sobre ela. Se o arquivo não
 * existir em `web/public/content-pipeline-bg.png`, cai para um gradiente.
 */
const BACKGROUND_SRC = "/content-pipeline-bg.png";
const BACKGROUND_ASPECT = "1942 / 809";

const STATUS_DOT: Record<AgentStatus, string> = {
  idle: "bg-secondary", working: "bg-accent", done: "bg-status-ok", error: "bg-status-error",
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

export function ContentPipelineBoard() {
  const { desks, running, topicLine, runMode } = usePipeline();
  const runs = useWorkspaceData<RunRecord[]>("/api/runs");
  const topics = useWorkspaceData<CalendarTopic[]>("/api/content-calendar");
  const stats = computePipelineStats(runs ?? [], topics ?? [], new Date());
  const [imageFailed, setImageFailed] = useState(false);

  const completedStages = STAGES.filter((s) => desks[s.id]?.status === "done").length;
  const currentStage = STAGES.find((s) => desks[s.id]?.status === "working");
  const progressPct = Math.round((completedStages / STAGES.length) * 100);

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
          <h3 className="font-semibold text-primary">Fluxo da sua equipe de {STAGES.length} agentes</h3>
          <p className="text-sm text-secondary">Cada agente tem uma função específica no processo de criação e publicação de conteúdo.</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full border border-border bg-surface px-3 py-1 text-xs text-secondary">{RUN_MODE_LABEL[runMode] ?? runMode}</span>
          <Link to="/relatorios" className="rounded-md border border-border px-3 py-1.5 text-sm text-primary hover:border-accent">Ver detalhes →</Link>
        </div>
      </div>

      <div className="relative mt-4 overflow-hidden rounded-lg bg-gradient-to-br from-app to-surface" style={{ aspectRatio: BACKGROUND_ASPECT }}>
        {!imageFailed && (
          <img
            src={BACKGROUND_SRC}
            alt=""
            aria-hidden="true"
            className="absolute inset-0 h-full w-full object-cover"
            onError={() => setImageFailed(true)}
          />
        )}
        {STAGES.map((stage, index) => {
          const status = desks[stage.id]?.status ?? "idle";
          const staggered = index % 2 === 1; // linha de baixo pra vizinhos não se encostarem
          return (
            <div
              key={stage.id}
              className={`absolute hidden -translate-x-1/2 flex-col items-center sm:flex ${staggered ? "top-16" : "top-1"}`}
              style={{ left: stage.photoLeft }}
            >
              <div className="w-28 rounded-xl border border-border bg-surface p-2 text-center shadow-lg">
                <div className="flex items-center justify-center gap-1">
                  <span className="text-xs" aria-hidden="true">{stage.icon}</span>
                  <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[status]}`} aria-label={STATUS_LABEL[status]} />
                </div>
                <div className="mt-1 text-[10px] font-semibold leading-tight text-primary">{stage.label}</div>
                <div className="text-[9px] text-secondary">{STATUS_LABEL[status]}</div>
              </div>
              <span aria-hidden="true" className="h-0 w-0 border-x-[6px] border-x-transparent border-t-[7px] border-t-surface" />
            </div>
          );
        })}
      </div>

      <div className="mt-4 flex gap-3 overflow-x-auto pb-2">
        {STAGES.map((stage) => {
          const status = desks[stage.id]?.status ?? "idle";
          return (
            <div key={stage.id} className="w-40 shrink-0 rounded-lg border border-border bg-surface p-3">
              <div className="flex items-center justify-between">
                <span className="text-lg" aria-hidden="true">{stage.icon}</span>
                <span className={`h-2 w-2 rounded-full ${STATUS_DOT[status]}`} aria-label={STATUS_LABEL[status]} />
              </div>
              <div className="mt-2 text-sm font-semibold text-primary">{stage.label}</div>
              <div className="mt-1 text-xs text-secondary">{STATUS_LABEL[status]}</div>
              <div className="mt-2 text-xs text-secondary">{stats.stageCounts[stage.id]} concluído(s) · 7 dias</div>
            </div>
          );
        })}
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
