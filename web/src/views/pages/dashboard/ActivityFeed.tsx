import { useEffect, useState } from "react";
import { useWorkspace } from "../../../hooks/useWorkspace";
import { usePipeline } from "../../../hooks/usePipeline";
import { apiGet } from "../../../lib/api";
import { formatDateTime } from "../../../lib/formatters";
import type { AgentId, HarnessTraceReport, HarnessAgentId } from "../../../types/api";

const PIPELINE_AGENT_LABELS: Record<AgentId, { label: string; icon: string }> = {
  "marketing-director": { label: "Marketing Director", icon: "📊" },
  "pesquisa-mercado": { label: "Pesquisa de mercado", icon: "🔍" },
  "pesquisa-pauta": { label: "Pesquisa de pauta", icon: "🗂️" },
  redator: { label: "Redação", icon: "✍️" },
  "editor-seo": { label: "Editor / SEO", icon: "🧐" },
  publicador: { label: "Publicação", icon: "🚀" },
  instagram: { label: "Social Agent", icon: "📸" },
  indexador: { label: "Indexação / Google", icon: "📈" },
};

const HARNESS_AGENT_LABELS: Record<HarnessAgentId, { label: string; icon: string }> = {
  "marketing-director": { label: "Marketing Director", icon: "📊" },
  "sales-agent": { label: "Sales Agent", icon: "👥" },
  "revenue-director": { label: "Revenue Director", icon: "👑" },
  "video-producer": { label: "Social Agent", icon: "📸" },
};

interface ActivityEntry {
  key: string;
  at: string;
  label: string;
  icon: string;
  message: string;
}

export function ActivityFeed() {
  const { workspace } = useWorkspace();
  const { desks, refreshToken } = usePipeline();
  const [traces, setTraces] = useState<HarnessTraceReport | null>(null);

  useEffect(() => {
    if (!workspace) return;
    const controller = new AbortController();
    apiGet<HarnessTraceReport>("/api/harness/traces", workspace, controller.signal)
      .then(setTraces)
      .catch((err) => { if ((err as Error).name !== "AbortError") setTraces(null); });
    return () => controller.abort();
  }, [workspace, refreshToken]);

  const fromPipeline: ActivityEntry[] = Object.entries(desks)
    .filter((entry): entry is [AgentId, NonNullable<typeof desks[AgentId]>] => Boolean(entry[1]))
    .map(([agentId, event]) => ({
      key: `pipeline-${agentId}-${event.timestamp}`,
      at: event.timestamp,
      label: PIPELINE_AGENT_LABELS[agentId].label,
      icon: PIPELINE_AGENT_LABELS[agentId].icon,
      message: event.message ?? "Sem detalhes.",
    }));

  const fromTraces: ActivityEntry[] = (traces?.traces ?? []).map((trace) => {
    const at = trace.finishedAt ?? trace.startedAt;
    const goalLabel = trace.goal.split("_").join(" ");
    const message = trace.status === "completed"
      ? `Execução concluída — ${goalLabel}.`
      : trace.status === "failed"
        ? (trace.error ?? `Execução falhou — ${goalLabel}.`)
        : `Execução bloqueada — ${goalLabel}.`;
    return { key: `trace-${trace.runId}`, at, label: HARNESS_AGENT_LABELS[trace.agent].label, icon: HARNESS_AGENT_LABELS[trace.agent].icon, message };
  });

  const entries = [...fromPipeline, ...fromTraces]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 8);

  return (
    <section className="rounded-lg border border-border bg-surface p-4">
      <h2 className="mb-3 flex items-center gap-2 font-semibold text-primary">
        <span className="h-2 w-2 rounded-full bg-status-ok" aria-hidden="true" />
        Atividade em tempo real
      </h2>
      {entries.length === 0 ? (
        <p className="text-sm text-secondary">Dados ainda não disponíveis.</p>
      ) : (
        <ul className="space-y-3">
          {entries.map((entry) => (
            <li key={entry.key} className="flex gap-2 text-sm">
              <span aria-hidden="true">{entry.icon}</span>
              <div>
                <div className="text-secondary">{formatDateTime(entry.at)} · {entry.label}</div>
                <div className="text-primary">{entry.message}</div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
