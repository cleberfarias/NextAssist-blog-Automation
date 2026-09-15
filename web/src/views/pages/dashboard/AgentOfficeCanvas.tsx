import { useState } from "react";
import { Link } from "react-router-dom";
import { useAgentOperations, type AgentOperationalState, type AgentOperationalStatus } from "../../../hooks/useAgentOperations";

/**
 * Imagem de cenário do escritório — puramente decorativa (nenhum status,
 * nome ou métrica embutido nela). Enquanto o arquivo não existir em
 * `web/public/agent-office-bg.jpg`, o canvas cai para um gradiente escuro.
 */
const BACKGROUND_SRC = "/agent-office-bg.jpg";

const STATUS_DOT: Record<AgentOperationalStatus, string> = {
  working: "bg-accent",
  waiting: "bg-status-warn",
  needs_attention: "bg-status-warn",
  failed: "bg-status-error",
  completed: "bg-status-ok",
  idle: "bg-secondary",
};

/**
 * Posição de cada badge sobre o canvas, em porcentagem — só se aplica a
 * partir de `sm`. Em telas estreitas (< sm) os badges abandonam o
 * posicionamento absoluto e empilham como uma lista normal, porque uma
 * largura fixa flutuando sobre uma imagem não cabe em ~390px.
 */
const BADGE_POSITION: Record<AgentOperationalState["agentId"], string> = {
  revenue: "sm:left-1/2 sm:top-4 sm:-translate-x-1/2",
  analytics: "sm:left-6 sm:top-1/3",
  sales: "sm:right-6 sm:top-1/3",
  social: "sm:left-6 sm:bottom-6",
  finance: "sm:right-6 sm:bottom-6",
};

function AgentBadge({ state }: { state: AgentOperationalState }) {
  return (
    <Link
      to={`/agentes/${state.agentId}`}
      className={`relative block w-full rounded-lg border border-border bg-surface/90 p-3 backdrop-blur-sm hover:border-accent sm:absolute sm:w-56 ${BADGE_POSITION[state.agentId]}`}
    >
      <div className="flex items-center gap-2">
        <span aria-hidden="true">{state.icon}</span>
        <strong className="text-sm text-primary">{state.title}</strong>
        <span className={`ml-auto h-2 w-2 rounded-full ${STATUS_DOT[state.status]}`} aria-label={state.statusLabel} />
      </div>
      <p className="mt-1 text-xs text-secondary">{state.message}</p>
    </Link>
  );
}

export function AgentOfficeCanvas() {
  const { agents } = useAgentOperations();
  const [imageFailed, setImageFailed] = useState(false);

  return (
    <section className="rounded-lg border border-border bg-surface p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-semibold text-primary">Agentes em ação</h2>
        <span className="text-xs text-status-ok">Todos os agentes operacionais</span>
      </div>
      <div className="relative flex min-h-[420px] flex-col gap-3 overflow-hidden rounded-lg bg-gradient-to-br from-app to-surface p-3 sm:block sm:p-0">
        {!imageFailed && (
          <img
            src={BACKGROUND_SRC}
            alt=""
            aria-hidden="true"
            className="absolute inset-0 h-full w-full object-cover"
            onError={() => setImageFailed(true)}
          />
        )}
        <AgentBadge state={agents.revenue} />
        <AgentBadge state={agents.analytics} />
        <AgentBadge state={agents.sales} />
        <AgentBadge state={agents.social} />
        <AgentBadge state={agents.finance} />
      </div>
    </section>
  );
}
