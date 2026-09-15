import type { AgentId } from "../types/api";

export interface PipelineStage {
  id: AgentId;
  label: string;
  icon: string;
  /** Descrição curta e real do que o estágio faz — texto fixo, não é dado/métrica. */
  description: string;
}

/** Os 8 estágios reais do pipeline de blog, na ordem em que executam — fonte única, reutilizada por qualquer tela que precise listar/rotular esses agentes. */
export const PIPELINE_STAGES: PipelineStage[] = [
  { id: "marketing-director", label: "Marketing Director", icon: "📊", description: "Decide o próximo tema e prioriza o backlog." },
  { id: "pesquisa-mercado", label: "Pesquisa de mercado", icon: "🔍", description: "Pesquisa concorrência e tendências reais." },
  { id: "pesquisa-pauta", label: "Pesquisa de pauta", icon: "🗂️", description: "Define o ângulo e a palavra-chave do post." },
  { id: "redator", label: "Redação", icon: "✍️", description: "Escreve o conteúdo completo do artigo." },
  { id: "editor-seo", label: "Editor / SEO", icon: "🧐", description: "Revisa, ajusta SEO e organiza tags." },
  { id: "publicador", label: "Publicação", icon: "🚀", description: "Publica o post no blog." },
  { id: "instagram", label: "Instagram", icon: "📸", description: "Gera e revisa o Reel para publicação." },
  { id: "indexador", label: "Indexação / Google", icon: "📈", description: "Confirma indexação no Search Console." },
];

export const PIPELINE_STAGE_BY_ID = Object.fromEntries(PIPELINE_STAGES.map((s) => [s.id, s])) as Record<AgentId, PipelineStage>;
