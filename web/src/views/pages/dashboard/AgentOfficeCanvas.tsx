import { useState } from "react";
import { Link } from "react-router-dom";
import { useAgentOperations, type AgentOperationalState, type AgentOperationalStatus } from "../../../hooks/useAgentOperations";

/**
 * Imagem de cenário do escritório — puramente decorativa (nenhum status,
 * nome ou métrica embutido nela). Se o arquivo não existir em
 * `web/public/agent-office-bg.png`, o canvas cai para um gradiente escuro.
 */
const BACKGROUND_SRC = "/agent-office-bg.png";

const STATUS_DOT: Record<AgentOperationalStatus, string> = {
  working: "bg-accent",
  waiting: "bg-status-warn",
  needs_attention: "bg-status-warn",
  failed: "bg-status-error",
  completed: "bg-status-ok",
  idle: "bg-secondary",
};

/**
 * Posição de cada badge sobre o canvas, ancorada em cima da pessoa
 * correspondente em `agent-office-bg.png` (mesma referência visual
 * combinada com o usuário) — só se aplica a partir de `sm`. Em telas
 * estreitas (< sm) os badges abandonam o posicionamento absoluto e
 * empilham como uma lista normal, porque uma largura fixa flutuando
 * sobre uma imagem não cabe em ~390px.
 */
const BADGE_POSITION: Record<AgentOperationalState["agentId"], string> = {
  social: "sm:left-[1%] sm:top-[42%]",
  analytics: "sm:left-[24%] sm:top-[24%]",
  sales: "sm:left-[48%] sm:top-[27%]",
  finance: "sm:left-[75%] sm:top-[46%]",
  revenue: "sm:left-[75%] sm:top-[2%]",
};

function AgentBadge({ state }: { state: AgentOperationalState }) {
  return (
    <Link
      to={`/agentes/${state.agentId}`}
      className={`relative z-10 block w-full rounded-lg border border-border bg-surface/90 p-2.5 backdrop-blur-sm hover:border-accent hover:z-20 sm:absolute sm:w-44 ${BADGE_POSITION[state.agentId]}`}
    >
      <div className="flex items-center gap-1.5">
        <span aria-hidden="true">{state.icon}</span>
        <strong className="text-xs text-primary">{state.title}</strong>
        <span className={`ml-auto h-2 w-2 shrink-0 rounded-full ${STATUS_DOT[state.status]}`} aria-label={state.statusLabel} />
      </div>
      <p className="mt-1 text-[11px] leading-snug text-secondary">{state.message}</p>
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
      <div className="relative flex min-h-[460px] flex-col gap-3 overflow-hidden rounded-lg bg-gradient-to-br from-app to-surface p-3 sm:block sm:p-0">
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
