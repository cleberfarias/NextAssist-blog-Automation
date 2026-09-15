import type { AgentId } from "../types/api";

export interface PipelineStage {
  id: AgentId;
  label: string;
  icon: string;
}

/** Os 8 estágios reais do pipeline de blog, na ordem em que executam — fonte única, reutilizada por qualquer tela que precise listar/rotular esses agentes. */
export const PIPELINE_STAGES: PipelineStage[] = [
  { id: "marketing-director", label: "Marketing Director", icon: "📊" },
  { id: "pesquisa-mercado", label: "Pesquisa de mercado", icon: "🔍" },
  { id: "pesquisa-pauta", label: "Pesquisa de pauta", icon: "🗂️" },
  { id: "redator", label: "Redação", icon: "✍️" },
  { id: "editor-seo", label: "Editor / SEO", icon: "🧐" },
  { id: "publicador", label: "Publicação", icon: "🚀" },
  { id: "instagram", label: "Instagram", icon: "📸" },
  { id: "indexador", label: "Indexação / Google", icon: "📈" },
];

export const PIPELINE_STAGE_BY_ID = Object.fromEntries(PIPELINE_STAGES.map((s) => [s.id, s])) as Record<AgentId, PipelineStage>;
