import { Link } from "react-router-dom";
import { useAgentOperations, pipelineStatusToOperational, type AgentOperationalState, type AgentOperationalStatus } from "../../hooks/useAgentOperations";
import { usePipeline } from "../../hooks/usePipeline";
import { PIPELINE_STAGES } from "../../lib/pipelineStages";
import { STATUS_LABEL } from "../dashboard/LiveStatus";

function AgentCard({ to, icon, title, statusLabel, message, kpis }: {
  to: string; icon: string; title: string; status: AgentOperationalStatus; statusLabel: string; message: string;
  kpis?: { label: string; value: string }[];
}) {
  return (
    <Link to={to} className="block rounded-lg border border-border bg-surface p-4 hover:border-accent">
      <div className="flex items-center justify-between">
        <span className="text-2xl" aria-hidden="true">{icon}</span>
        <span className="text-xs text-status-ok">{statusLabel}</span>
      </div>
      <h2 className="mt-2 font-semibold text-primary">{title}</h2>
      <p className="mt-1 text-sm text-secondary">{message}</p>
      {kpis && kpis.length > 0 && (
        <div className="mt-3 flex gap-4">
          {kpis.map((kpi) => (
            <div key={kpi.label}>
              <div className="text-xs text-secondary">{kpi.label}</div>
              <div className="text-sm font-semibold text-primary">{kpi.value}</div>
            </div>
          ))}
        </div>
      )}
    </Link>
  );
}

function OfficeCard({ state }: { state: AgentOperationalState }) {
  return <AgentCard to={`/agentes/${state.agentId}`} icon={state.icon} title={state.title} status={state.status} statusLabel={state.statusLabel} message={state.message} kpis={state.kpis} />;
}

export function AgentesPage() {
  const { agents } = useAgentOperations();
  const { desks } = usePipeline();

  return (
    <div className="p-6 text-primary">
      <h1 className="mb-4 text-xl font-semibold">Agentes (IA)</h1>

      <h2 className="mb-2 text-sm font-semibold text-secondary">Agent Office</h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <OfficeCard state={agents.social} />
        <OfficeCard state={agents.analytics} />
        <OfficeCard state={agents.sales} />
        <OfficeCard state={agents.finance} />
        <OfficeCard state={agents.revenue} />
      </div>

      <h2 className="mb-2 mt-6 text-sm font-semibold text-secondary">Pipeline de conteúdo</h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {PIPELINE_STAGES.map((stage) => {
          const status = desks[stage.id]?.status ?? "idle";
          return (
            <AgentCard
              key={stage.id}
              to={`/agentes/${stage.id}`}
              icon={stage.icon}
              title={stage.label}
              status={pipelineStatusToOperational(status)}
              statusLabel={STATUS_LABEL[status]}
              message={desks[stage.id]?.message || "Dados ainda não disponíveis."}
            />
          );
        })}
      </div>
    </div>
  );
}
