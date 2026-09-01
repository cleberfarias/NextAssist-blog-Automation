import { useEffect, useState } from "react";
import { useWorkspace } from "../../hooks/useWorkspace";
import { usePipeline } from "../../hooks/usePipeline";
import { useToast } from "../../components/ui/Toast";
import { apiGet } from "../../lib/api";
import { usePagination } from "../../hooks/usePagination";
import { nf, usd, formatDateTime } from "../../lib/formatters";
import type { AgentId, PipelineEvent, RunRecord, RunStatus } from "../../types/api";

const PAGE_SIZE = 6;

const AGENTS: { id: AgentId; role: string; emoji: string }[] = [
  { id: "marketing-director", role: "Marketing Director", emoji: "📊" },
  { id: "pesquisa-mercado", role: "Pesquisa de mercado", emoji: "🔍" },
  { id: "pesquisa-pauta", role: "Pesquisa de pauta", emoji: "🗂️" },
  { id: "redator", role: "Redação", emoji: "✍️" },
  { id: "editor-seo", role: "Editor / SEO", emoji: "🧐" },
  { id: "publicador", role: "Publicação", emoji: "🚀" },
  { id: "instagram", role: "Instagram", emoji: "📸" },
  { id: "indexador", role: "Indexação / Google", emoji: "📈" },
];

const RUN_STATUS: Record<RunStatus, { label: string; cls: string }> = {
  publicado: { label: "Publicado", cls: "run-ok" },
  falhou: { label: "Falhou", cls: "run-err" },
  "sem-tema": { label: "Sem tema", cls: "run-neutral" },
};

function agentFinalStatus(run: RunRecord, agentId: AgentId): PipelineEvent | null {
  let last: PipelineEvent | null = null;
  for (const ev of run.eventos ?? []) if (ev.agent === agentId) last = ev;
  return last;
}

function RunItem({ run }: { run: RunRecord }) {
  const status = RUN_STATUS[run.status] ?? { label: run.status, cls: "run-neutral" };
  const quando = formatDateTime(run.finalizadoEm || run.iniciadoEm);
  const origem = run.origem === "action" ? "🤖 Action" : "🖐️ Manual";

  return (
    <li className="run-item">
      <div className="run-top">
        <span className={`run-badge ${status.cls}`}>{status.label}</span>
        <span className="run-origin">{origem}</span>
        <span className="run-when">{quando}</span>
        {run.usage && (
          <span
            className="run-cost"
            title={`${nf.format(run.usage.inputTokens)} tokens de entrada · ${nf.format(run.usage.outputTokens)} tokens de saída`}
          >
            {usd.format(run.usage.estimatedUsd)}
          </span>
        )}
        {run.slug && (
          <a href={`https://www.nextassist-app.com.br/blog/${run.slug}`} target="_blank" rel="noopener noreferrer">
            ver post ↗
          </a>
        )}
      </div>
      <div className="run-topic">{run.tema ?? "—"}</div>
      <div className="run-chips">
        {AGENTS.map((agent) => {
          const ev = agentFinalStatus(run, agent.id);
          const status = ev?.status ?? "idle";
          return (
            <span key={agent.id} className={`chip chip-${status}`} title={ev?.message ?? ""}>
              {agent.emoji} {agent.role}
            </span>
          );
        })}
      </div>
      {run.erro && <div className="run-error">⚠️ {run.erro}</div>}
    </li>
  );
}

export function RunsPanel() {
  const { workspace } = useWorkspace();
  const { refreshToken } = usePipeline();
  const { showToast } = useToast();
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const { page, totalPages, pageItems, next, previous } = usePagination(runs, PAGE_SIZE);

  useEffect(() => {
    if (!workspace) return;
    const controller = new AbortController();
    apiGet<RunRecord[]>("/api/runs", workspace, controller.signal, "Não foi possível carregar as execuções.")
      .then(setRuns)
      .catch((err) => { if ((err as Error).name !== "AbortError") showToast((err as Error).message, "error"); });
    return () => controller.abort();
  }, [workspace, refreshToken]);

  return (
    <section className="runs-panel">
      <div className="runs-header">
        <h2>Execuções recentes</h2>
        <span id="runs-updated">{runs.length > 0 ? `${runs.length} execução(ões) registradas` : ""}</span>
      </div>
      {runs.length === 0 ? (
        <ul id="runs-list"><li className="empty">Nenhuma execução registrada ainda.</li></ul>
      ) : (
        <ul id="runs-list">{pageItems.map((run) => <RunItem key={run.id} run={run} />)}</ul>
      )}
      {totalPages > 1 && (
        <div className="pagination" aria-label="Paginação das execuções">
          <button onClick={previous} disabled={page === 1}>Anterior</button>
          <span className="page-label">Página {page} de {totalPages}</span>
          <button onClick={next} disabled={page === totalPages}>Próxima</button>
        </div>
      )}
    </section>
  );
}
