export type AgentId =
  | "marketing-director"
  | "pesquisa-mercado" | "pesquisa-pauta" | "redator" | "editor-seo"
  | "publicador" | "instagram" | "indexador";

export type AgentStatus = "idle" | "working" | "done" | "error";

export interface PipelineEvent {
  agent: AgentId;
  status: AgentStatus;
  message?: string;
  tema?: string;
  timestamp: string;
}

export type OnEvent = (event: PipelineEvent) => void;

export function emit(onEvent: OnEvent | undefined, event: Omit<PipelineEvent, "timestamp">): void {
  onEvent?.({ ...event, timestamp: new Date().toISOString() });
}
