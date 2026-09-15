import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { usePipeline } from "../../hooks/usePipeline";
import { RunsPanel } from "../dashboard/RunsPanel";
import { SalesPanel } from "../dashboard/SalesPanel";
import { RevenuePanel } from "../dashboard/RevenuePanel";
import { PerformancePanel } from "../dashboard/PerformancePanel";
import { UsagePanel } from "../dashboard/UsagePanel";
import { SocialAgentOverview } from "./agente-detail/SocialAgentOverview";
import { AgentStatusHeader } from "./agente-detail/AgentStatusHeader";
import { STATUS_LABEL } from "../dashboard/LiveStatus";
import { PIPELINE_STAGE_BY_ID } from "../../lib/pipelineStages";
import { useAgentOperations, pipelineStatusToOperational, type OfficeAgentId } from "../../hooks/useAgentOperations";
import type { AgentId } from "../../types/api";

type AnyAgentId = OfficeAgentId | AgentId;

const OFFICE_TITLES: Record<OfficeAgentId, string> = {
  social: "Social Agent", analytics: "Analytics Agent", sales: "Sales Agent",
  finance: "Finance Agent", revenue: "Revenue Director",
};

function isPipelineStage(id: string): id is AgentId {
  return id in PIPELINE_STAGE_BY_ID;
}

function isOfficeAgent(id: string): id is OfficeAgentId {
  return id in OFFICE_TITLES;
}

function titleFor(id: AnyAgentId): string {
  if (isOfficeAgent(id)) return OFFICE_TITLES[id];
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

const OFFICE_BODY: Record<OfficeAgentId, React.ComponentType | null> = {
  social: SocialAgentOverview,
  sales: SalesPanel,
  revenue: RevenuePanel,
  analytics: PerformancePanel,
  finance: UsagePanel,
};

/**
 * Visão geral de TODOS os agentes segue o mesmo padrão: cabeçalho de
 * status (ícone + bolinha + mensagem real) e, abaixo, o corpo específico
 * daquele agente — nunca o inverso, pra não duplicar a lógica de
 * status/mensagem entre Dashboard, página Agentes e esta tela.
 */
function VisaoGeral({ agentId }: { agentId: AnyAgentId }) {
  const { agents } = useAgentOperations();
  const { desks } = usePipeline();

  if (isPipelineStage(agentId)) {
    const event = desks[agentId];
    const status = event?.status ?? "idle";
    return (
      <div>
        <AgentStatusHeader
          icon={PIPELINE_STAGE_BY_ID[agentId].icon}
          status={pipelineStatusToOperational(status)}
          statusLabel={STATUS_LABEL[status]}
          message={event?.message || "Dados ainda não disponíveis."}
        />
      </div>
    );
  }

  const state = agents[agentId as OfficeAgentId];
  const Body = OFFICE_BODY[agentId as OfficeAgentId];
  return (
    <div>
      <AgentStatusHeader icon={state.icon} status={state.status} statusLabel={state.statusLabel} message={state.message} />
      {Body ? <Body /> : null}
    </div>
  );
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
