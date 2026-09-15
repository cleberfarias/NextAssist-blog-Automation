import { Link } from "react-router-dom";
import type { AgentOperationalStatus } from "../../../hooks/useAgentOperations";

export const STATUS_DOT: Record<AgentOperationalStatus, string> = {
  working: "bg-accent",
  waiting: "bg-status-warn",
  needs_attention: "bg-status-warn",
  failed: "bg-status-error",
  completed: "bg-status-ok",
  idle: "bg-secondary",
};

/** Direção da "pontinha" do balão de fala, apontando pra pessoa correspondente. */
export type TailDirection = "down" | "left" | "right";

export const TAIL_SHAPE: Record<TailDirection, string> = {
  down: "border-x-[9px] border-x-transparent border-t-[10px] border-t-surface",
  left: "border-y-[9px] border-y-transparent border-r-[10px] border-r-surface",
  right: "border-y-[9px] border-y-transparent border-l-[10px] border-l-surface",
};

export interface AgentBubbleProps {
  to: string;
  icon: string;
  title: string;
  status: AgentOperationalStatus;
  statusLabel: string;
  message: string;
  /**
   * Classes completas de posicionamento absoluto (ex: "sm:left-[24%]
   * sm:top-[24%]") — precisa ser um literal completo no código-fonte
   * chamador (não montado por interpolação de variável), ou o scanner do
   * Tailwind não gera a classe em produção.
   */
  position: string;
  tailDirection: TailDirection;
  /** Classes completas de posicionamento da pontinha dentro do balão (ex: "sm:-bottom-2 sm:left-8"). */
  tailPosition: string;
}

/**
 * Balão de fala reutilizado em todo canvas de "agente sobre uma foto" —
 * usado tanto pelos 5 agentes do Agent Office quanto pelos 8 estágios do
 * pipeline de conteúdo, pra manter os dois visualmente idênticos.
 */
export function AgentBubble({ to, icon, title, status, statusLabel, message, position, tailDirection, tailPosition }: AgentBubbleProps) {
  return (
    <Link
      to={to}
      className={`relative z-10 block w-full rounded-2xl border border-border bg-surface p-2.5 shadow-lg hover:border-accent hover:z-20 sm:absolute sm:w-44 ${position}`}
    >
      <div className="flex items-center gap-1.5">
        <span aria-hidden="true">{icon}</span>
        <strong className="text-xs text-primary">{title}</strong>
        <span className={`ml-auto h-2 w-2 shrink-0 rounded-full ${STATUS_DOT[status]}`} aria-label={statusLabel} />
      </div>
      <p className="mt-1 text-[11px] leading-snug text-secondary">{message}</p>
      <span aria-hidden="true" className={`absolute hidden h-0 w-0 sm:block ${TAIL_SHAPE[tailDirection]} ${tailPosition}`} />
    </Link>
  );
}
