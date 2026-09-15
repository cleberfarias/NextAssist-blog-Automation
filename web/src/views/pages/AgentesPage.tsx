import { Link } from "react-router-dom";
import { useAgentOperations, type AgentOperationalState } from "../../hooks/useAgentOperations";

function AgentCard({ state }: { state: AgentOperationalState }) {
  return (
    <Link to={`/agentes/${state.agentId}`} className="block rounded-lg border border-border bg-surface p-4 hover:border-accent">
      <div className="flex items-center justify-between">
        <span className="text-2xl" aria-hidden="true">{state.icon}</span>
        <span className="text-xs text-status-ok">{state.statusLabel}</span>
      </div>
      <h2 className="mt-2 font-semibold text-primary">{state.title}</h2>
      <p className="mt-1 text-sm text-secondary">{state.message}</p>
      <div className="mt-3 flex gap-4">
        {state.kpis.map((kpi) => (
          <div key={kpi.label}>
            <div className="text-xs text-secondary">{kpi.label}</div>
            <div className="text-sm font-semibold text-primary">{kpi.value}</div>
          </div>
        ))}
      </div>
    </Link>
  );
}

export function AgentesPage() {
  const { agents } = useAgentOperations();

  return (
    <div className="p-6 text-primary">
      <h1 className="mb-4 text-xl font-semibold">Agentes (IA)</h1>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <AgentCard state={agents.social} />
        <AgentCard state={agents.analytics} />
        <AgentCard state={agents.sales} />
        <AgentCard state={agents.finance} />
        <AgentCard state={agents.revenue} />
      </div>
    </div>
  );
}
