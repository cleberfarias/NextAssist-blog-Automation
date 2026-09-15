import { useState } from "react";
import { useAgentOperations, type AgentOperationalState } from "../../../hooks/useAgentOperations";
import { AgentBubble, type TailDirection } from "./AgentBubble";

/**
 * Imagem de cenário do escritório — puramente decorativa (nenhum status,
 * nome ou métrica embutido nela). Se o arquivo não existir em
 * `web/public/agent-office-bg.png`, o canvas cai para um gradiente escuro.
 */
const BACKGROUND_SRC = "/agent-office-bg.png";

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

const BADGE_TAIL: Record<AgentOperationalState["agentId"], { direction: TailDirection; position: string }> = {
  social: { direction: "right", position: "sm:-right-2 sm:top-6" },
  analytics: { direction: "down", position: "sm:-bottom-2 sm:left-8" },
  sales: { direction: "down", position: "sm:-bottom-2 sm:left-1/2 sm:-translate-x-1/2" },
  finance: { direction: "left", position: "sm:-left-2 sm:top-6" },
  revenue: { direction: "down", position: "sm:-bottom-2 sm:left-8" },
};

function OfficeBadge({ state }: { state: AgentOperationalState }) {
  const tail = BADGE_TAIL[state.agentId];
  return (
    <AgentBubble
      to={`/agentes/${state.agentId}`}
      icon={state.icon}
      title={state.title}
      status={state.status}
      statusLabel={state.statusLabel}
      message={state.message}
      position={BADGE_POSITION[state.agentId]}
      tailDirection={tail.direction}
      tailPosition={tail.position}
    />
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
        <OfficeBadge state={agents.revenue} />
        <OfficeBadge state={agents.analytics} />
        <OfficeBadge state={agents.sales} />
        <OfficeBadge state={agents.social} />
        <OfficeBadge state={agents.finance} />
      </div>
    </section>
  );
}
