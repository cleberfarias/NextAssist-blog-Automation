export interface WorkspaceSummary {
  id: string;
  name: string;
}

export type AgentId =
  | "marketing-director"
  | "pesquisa-mercado"
  | "pesquisa-pauta"
  | "redator"
  | "editor-seo"
  | "publicador"
  | "instagram"
  | "indexador";

export type AgentStatus = "idle" | "working" | "done" | "error";

export interface PipelineEvent {
  agent: AgentId;
  status: AgentStatus;
  message?: string;
  tema?: string;
  timestamp: string;
}

export interface StatusResponse {
  running: boolean;
  lastEvents: PipelineEvent[];
  runMode: "local" | "dispatch" | "disabled";
}

export interface HistoryEntry {
  tema: string;
  titulo: string;
  slug: string;
  publicadoEm: string;
}

export type RunStatus = "publicado" | "falhou" | "sem-tema";

export interface RunRecord {
  id: string;
  origem: "action" | "manual";
  iniciadoEm: string;
  finalizadoEm: string;
  tema: string | null;
  status: RunStatus;
  slug: string | null;
  erro: string | null;
  eventos: PipelineEvent[];
  usage?: { estimatedUsd: number; inputTokens: number; outputTokens: number };
}

export interface UsageReport {
  trackedRuns: number;
  month: { estimatedUsd: number; inputTokens: number; outputTokens: number; webSearchRequests: number };
  total: { estimatedUsd: number; inputTokens: number; outputTokens: number; webSearchRequests: number };
  averagePublishedUsd: number;
}

export interface ConversionBucket {
  demoViews: number;
  demoSubmits: number;
  contactSubmits: number;
  whatsappClicks: number;
  leads: number;
  demoRate: number;
}

export interface ConversionSummary {
  demoViews: number;
  demoSubmits: number;
  contactSubmits: number;
  whatsappClicks: number;
  trials: number;
  signups: number;
  demoRate: number;
  byCampaign: (ConversionBucket & { campaign: string })[];
  byContent: (ConversionBucket & { content: string })[];
  updatedAt: string;
}

export interface AttributionRow {
  contentId: string;
  campaignId: string | null;
  tema: string;
  channel: string;
  formato: string;
  funnelStage: string;
  visits: number;
  trials: number;
  signups: number;
  activated: number;
  customers: number;
  visitToTrialRate: number;
  trialToActivationRate: number;
  activationToCustomerRate: number;
  rateReliable: boolean;
}

export interface AttributionResult {
  rows: AttributionRow[];
  unattributedEvents: number;
}

export interface PostPerformance {
  slug: string;
  titulo: string;
  url: string;
  indexado: boolean;
  coverageState: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
  erro?: string;
}

export interface PerformanceReport {
  atualizadoEm: string;
  periodo: { inicio: string; fim: string };
  posts: PostPerformance[];
}

export interface InstagramPerformance {
  contentId: string;
  tema: string;
  url: string;
  atualizadoEm: string;
  erro?: string;
  plays: number;
  reach: number;
  likes: number;
  comments: number;
  shares: number;
  saved: number;
}
