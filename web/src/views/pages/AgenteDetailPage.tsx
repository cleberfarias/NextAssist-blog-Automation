import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { usePipeline } from "../../hooks/usePipeline";
import { RunsPanel } from "../dashboard/RunsPanel";
import { SalesPanel } from "../dashboard/SalesPanel";
import { RevenuePanel } from "../dashboard/RevenuePanel";
import { ReelApprovalPanel } from "../dashboard/ReelApprovalPanel";
import { STATUS_LABEL } from "../dashboard/LiveStatus";
import { PIPELINE_STAGE_BY_ID } from "../../lib/pipelineStages";
import type { OfficeAgentId } from "../../hooks/useAgentOperations";
import type { AgentId } from "../../types/api";

type AnyAgentId = OfficeAgentId | AgentId;

const OFFICE_TITLES: Record<OfficeAgentId, string> = {
  social: "Social Agent", analytics: "Analytics Agent", sales: "Sales Agent",
  finance: "Finance Agent", revenue: "Revenue Director",
};

function isPipelineStage(id: string): id is AgentId {
  return id in PIPELINE_STAGE_BY_ID;
}

function titleFor(id: AnyAgentId): string {
  if (id in OFFICE_TITLES) return OFFICE_TITLES[id as OfficeAgentId];
  if (isPipelineStage(id)) return PIPELINE_STAGE_BY_ID[id].label;
  return id;
}

type Tab = "visao-geral" | "detalhes" | "historico" | "acoes";
const TABS: { id: Tab; label: string }[] = [
  { id: "visao-geral", label: "Visão geral" },
  { id: "detalhes", label: "Detalhes técnicos" },
  { id: "historico", label: "Histórico" },
  { id: "acoes", label: "Ações" },
];

function PipelineStageOverview({ id }: { id: AgentId }) {
  const { desks } = usePipeline();
  const event = desks[id];
  const status = event?.status ?? "idle";
  return (
    <section className="rounded-lg border border-border bg-surface p-4">
      <div className="flex items-center gap-2">
        <span className="text-lg" aria-hidden="true">{PIPELINE_STAGE_BY_ID[id].icon}</span>
        <strong className="text-primary">{STATUS_LABEL[status]}</strong>
      </div>
      <p className="mt-2 text-sm text-secondary">{event?.message || "Dados ainda não disponíveis."}</p>
    </section>
  );
}

function VisaoGeral({ agentId }: { agentId: AnyAgentId }) {
  if (agentId === "sales") return <SalesPanel />;
  if (agentId === "revenue") return <RevenuePanel />;
  if (agentId === "social") return <ReelApprovalPanel />;
  if (isPipelineStage(agentId)) return <PipelineStageOverview id={agentId} />;
  return <p className="text-secondary">Sem painel detalhado para este agente ainda — veja o card em <Link className="text-accent" to="/agentes">Agentes (IA)</Link>.</p>;
}

export function AgenteDetailPage() {
  const { agentId } = useParams<{ agentId: string }>();
  const [tab, setTab] = useState<Tab>("visao-geral");
  const id = (agentId ?? "sales") as AnyAgentId;

  return (
    <div className="p-6 text-primary">
      <h1 className="mb-4 text-xl font-semibold">{titleFor(id)}</h1>

      <div role="tablist" className="mb-4 flex gap-2 border-b border-border">
        {TABS.map((t) => (
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

      {tab === "visao-geral" && <VisaoGeral agentId={id} />}
      {tab === "detalhes" && <p className="text-sm text-secondary">Detalhes técnicos completos ficam disponíveis na aba Visão geral por enquanto — um payload bruto dedicado fica para uma iteração futura.</p>}
      {tab === "historico" && <RunsPanel />}
      {tab === "acoes" && (
        <p className="text-sm text-secondary">
          Sem ações automatizadas para este agente nesta versão.
          {id === "social" ? <> Para aprovar/rejeitar/publicar Reels, use <Link className="text-accent" to="/reels">Reels</Link>.</> : null}
        </p>
      )}
    </div>
  );
}
