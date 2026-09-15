import { STATUS_DOT } from "../dashboard/AgentBubble";
import type { AgentOperationalStatus } from "../../../hooks/useAgentOperations";

/**
 * Cabeçalho de status comum a TODAS as Visão geral de agente — o mesmo
 * ícone + bolinha de status + mensagem real, seja um dos 5 agentes do
 * Agent Office ou um dos 8 estágios do pipeline de conteúdo. O corpo
 * específico de cada agente (painel de leads, timeline de Reel, etc.)
 * vem abaixo, renderizado por quem chama este componente.
 */
export function AgentStatusHeader({ icon, status, statusLabel, message }: {
  icon: string;
  status: AgentOperationalStatus;
  statusLabel: string;
  message: string;
}) {
  return (
    <div className="mb-4 flex items-start gap-3 rounded-lg border border-border bg-surface p-4">
      <span className="text-2xl" aria-hidden="true">{icon}</span>
      <div>
        <div className="flex items-center gap-2">
          <span className={`h-2 w-2 rounded-full ${STATUS_DOT[status]}`} aria-hidden="true" />
          <strong className="text-primary">{statusLabel}</strong>
        </div>
        <p className="mt-1 text-sm text-secondary">{message}</p>
      </div>
    </div>
  );
}
