import { usePipeline } from "../../hooks/usePipeline";
import type { AgentId, AgentStatus, PipelineEvent } from "../../types/api";

const AGENTS: { id: AgentId; name: string; role: string; emoji: string }[] = [
  { id: "marketing-director", name: "Marina", role: "Marketing Director", emoji: "📊" },
  { id: "pesquisa-mercado", name: "Ana", role: "Pesquisa de mercado", emoji: "🔍" },
  { id: "pesquisa-pauta", name: "Bruno", role: "Pesquisa de pauta", emoji: "🗂️" },
  { id: "redator", name: "Carla", role: "Redação", emoji: "✍️" },
  { id: "editor-seo", name: "Diego", role: "Editor / SEO", emoji: "🧐" },
  { id: "publicador", name: "Elis", role: "Publicação", emoji: "🚀" },
  { id: "instagram", name: "Gabi", role: "Instagram", emoji: "📸" },
  { id: "indexador", name: "Fábio", role: "Indexação / Google", emoji: "📈" },
];

export const STATUS_LABEL: Record<AgentStatus, string> = {
  idle: "Ocioso",
  working: "Trabalhando",
  done: "Concluído",
  error: "Erro",
};

const STATUS_TIME: Record<AgentStatus, string> = {
  idle: "aguardando",
  working: "em andamento",
  done: "finalizado",
  error: "precisa de atenção",
};

const PROGRESS_WIDTH: Record<AgentStatus, string> = {
  idle: "0%",
  working: "62%",
  done: "100%",
  error: "100%",
};

function Desk({ agent, event, index }: { agent: typeof AGENTS[number]; event: PipelineEvent | undefined; index: number }) {
  const status = event?.status ?? "idle";
  return (
    <div className={`desk status-${status}`} id={`desk-${agent.id}`}>
      <div className="desk-top">
        <span className="desk-index">{`0${index + 1}`}</span>
        <span className="status-dot" aria-label={STATUS_LABEL[status]} />
      </div>
      <div className="avatar-wrap">{agent.emoji}</div>
      <div className="name">{agent.name}</div>
      <div className="role">{agent.role}</div>
      <div className="desk-status">
        <span className="status-badge">{STATUS_LABEL[status]}</span>
        <span className="status-time">{STATUS_TIME[status]}</span>
      </div>
      <div className="bubble">
        <span className="bubble-text">{event?.message ?? ""}</span>
        <span className="typing-dots" aria-hidden="true"><i></i><i></i><i></i></span>
      </div>
      <div className="desk-progress"><span style={{ width: PROGRESS_WIDTH[status] }}></span></div>
    </div>
  );
}

export function LiveStatus() {
  const { desks } = usePipeline();
  const workingAgent = AGENTS.find((agent) => desks[agent.id]?.status === "working");
  const anyError = Object.values(desks).some((event) => event?.status === "error");

  return (
    <main className="office">
      <div className="floor">
        <div className="floor-heading">
          <span className="eyebrow">OPERAÇÃO AO VIVO</span>
          <strong>Equipe de conteúdo</strong>
          <span>Veja quem está trabalhando agora</span>
          <span className={workingAgent || anyError ? "active-agent is-active" : "active-agent"}>
            {workingAgent
              ? `Trabalhando agora: ${workingAgent.name} · ${workingAgent.role}`
              : anyError
                ? "A etapa precisa de atenção"
                : "Equipe aguardando a próxima etapa"}
          </span>
        </div>
        {AGENTS.map((agent, index) => (
          <Desk key={agent.id} agent={agent} event={desks[agent.id]} index={index} />
        ))}
      </div>
    </main>
  );
}
