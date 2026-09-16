export interface WorkspaceSummary {
  id: string;
  name: string;
}

export interface WorkspaceConfig {
  id: string;
  name: string;
  active: boolean;
  brand: {
    name: string;
    description: string;
    toneOfVoice: string;
    targetAudience: string[];
    competitors: string[];
    forbiddenTerms?: string[];
    valuePropositions?: string[];
    requiredLinks?: string[];
  };
  goals: {
    primary: "leads" | "traffic" | "brand" | "sales";
    monthlyLeadTarget?: number;
    monthlyTrafficTarget?: number;
    monthlyCustomerTarget?: number;
  };
  channels: { blog: boolean; instagram: boolean; linkedin: boolean };
  integrations: {
    siteUrl: string;
    cms: { provider: "nextassist"; apiUrl: string };
    searchConsole?: { siteUrl: string; sitemapUrl: string };
    instagram?: { apiVersion: string };
    heygen?: { transport: "mcp"; mcpUrl: string; auth: "oauth" };
  };
  autonomy: { mode: "copilot" | "semi-autonomous" | "autonomous" };
  aiFallbackProvider?: "openai" | "anthropic" | "none";
  contentStrategy?: { minimumPendingTopics: number; replenishAmount: number };
  instagramStrategy?: { frequencyPerWeek: number; pillars: string[]; preferredFormats: string[] };
  videoStrategy?: {
    provider: "heygen-mcp" | "heygen-api";
    avatarId: string;
    voiceId: string;
    brandKitId?: string;
    format: "9:16" | "16:9";
    music: boolean;
    musicVolume?: number;
    requiresApproval: boolean;
    fallback: "none";
  };
  secrets: { required: string[]; optional?: string[] };
}

export interface SecretStatus {
  key: string;
  required: boolean;
  configured: boolean;
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

export interface AnalyticsOverviewKpi {
  value: number;
  changePct: number | null;
}

export interface AnalyticsOverviewSeriesPoint {
  date: string;
  visits: number;
  leads: number;
}

export interface AnalyticsOverviewLeadSource {
  source: string;
  count: number;
  pct: number;
}

export interface AnalyticsOverview {
  rangeDays: number;
  visits: AnalyticsOverviewKpi;
  leads: AnalyticsOverviewKpi;
  conversionRate: { value: number; changePoints: number | null };
  customers: AnalyticsOverviewKpi;
  series: AnalyticsOverviewSeriesPoint[];
  leadSources: AnalyticsOverviewLeadSource[];
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

export type SalesIntent = "low" | "medium" | "high" | "customer";
export type SalesReviewStatus = "pending" | "approved" | "rejected";

export interface SalesSignal {
  name: string;
  createdAt: string;
  contentId?: string;
  channel?: string;
}

export interface SalesEntry {
  lead: {
    leadId: string;
    anonymousId?: string;
    userId?: string;
    source?: string;
    signals: SalesSignal[];
  };
  assessment: {
    leadId: string;
    score: number;
    intent: SalesIntent;
    nextAction: string;
    reasons: string[];
  };
  outreach?: {
    leadId: string;
    channel: "email" | "whatsapp" | "human";
    subject?: string;
    message: string;
    rationale: string;
    requiresHumanApproval: true;
  };
  review?: {
    status: SalesReviewStatus;
    subject?: string;
    message: string;
    updatedAt: string;
  };
}

export interface SalesDashboardResponse {
  updatedAt: string | null;
  summary: {
    total: number;
    hot: number;
    medium: number;
    customers: number;
    draftsPendingApproval: number;
  };
  entries: SalesEntry[];
}

export interface RevenueSnapshot {
  visits: number;
  trials: number;
  activated: number;
  customers: number;
  hotLeads: number;
  pendingSalesApprovals: number;
  visitToTrialRate: number;
  trialToActivationRate: number;
  activationToCustomerRate: number;
}

export interface RevenueDecision {
  objective: "increase_paying_customers";
  bottleneck: "traffic" | "trial_conversion" | "activation" | "sales_conversion" | "sales_followup" | "none";
  action: "create_content" | "improve_cta" | "improve_activation" | "prioritize_hot_leads" | "improve_sales_conversion" | "do_nothing";
  priority: "low" | "medium" | "high";
  reason: string;
  evidence: string[];
  requiresHumanApproval: boolean;
}

export interface BacklogOutcome {
  type: "marketing";
  skipped: boolean;
  pendingBefore: number;
  generated: number;
  discardedDuplicates: number;
  discardedForbidden: number;
  discardedInvalid: number;
  pendingAfter: number;
  error: string | null;
}

export type GrowthLoopOutcome =
  | BacklogOutcome
  | { type: "marketing_skipped"; reason: string }
  | { type: "sales"; leadsAssessed: number; outreachCreated: number; outreachReused: number; outreachFailed: number }
  | { type: "no_owner"; note: string }
  | { type: "no_action" };

export interface GrowthLoopState {
  runId: string;
  startedAt: string;
  completedAt: string;
  updatedAt: string;
  snapshot: RevenueSnapshot;
  decision: RevenueDecision;
  outcome: GrowthLoopOutcome;
}

export interface RevenueDashboardResponse {
  runId: string;
  monthlyCustomerTarget: number | null;
  snapshot: RevenueSnapshot;
  decision: RevenueDecision;
  growthLoop: GrowthLoopState | null;
}

export type ReelStatus = "queued" | "rendering" | "pending_approval" | "approved" | "rejected" | "publishing" | "published" | "failed";

export interface ReelAuditEvent {
  from: ReelStatus | null;
  to: ReelStatus;
  at: string;
  actor: "pipeline" | "human" | "system";
  note?: string;
}

export type TimelineStepName =
  | "roteiro_gerado" | "cenas_montadas" | "enviado_heygen"
  | "processando" | "video_concluido" | "aguardando_aprovacao" | "publicado";

export interface TimelineStep {
  step: TimelineStepName;
  at: string;
}

export interface SceneSummary {
  type: "avatar_video" | "video";
  label: string;
  assetId?: string;
  thumbnailUrl?: string;
}

export interface ReelListEntry {
  id: string;
  slug: string;
  title: string;
  blogUrl: string;
  caption: string;
  status: ReelStatus;
  provider?: "heygen-mcp" | "heygen-api";
  avatarId?: string;
  voiceId?: string;
  videoId?: string;
  videoUrl?: string;
  permalink?: string | null;
  error?: string;
  createdAt?: string;
  updatedAt: string;
  audit: ReelAuditEvent[];
  scenes?: SceneSummary[];
  timelineSteps?: TimelineStep[];
}

export type ReelDetail = ReelListEntry;

export interface ReelDashboardResponse {
  updatedAt: string | null;
  summary: { total: number; pendingApproval: number; approved: number; published: number; failed: number };
  entries: ReelListEntry[];
}

export type HarnessAgentId = "marketing-director" | "sales-agent" | "revenue-director" | "video-producer";
export type AgentRunStatus = "completed" | "blocked" | "failed";

export interface TraceStep {
  index: number;
  skill: string;
  startedAt: string;
  finishedAt: string;
  status: "completed" | "failed";
  error?: string;
}

export interface AgentTrace {
  runId: string;
  workspaceId: string;
  agent: HarnessAgentId;
  goal: string;
  startedAt: string;
  finishedAt?: string;
  status: AgentRunStatus;
  steps: TraceStep[];
  costUsd: number;
  error?: string;
}

export interface HarnessTraceReport {
  updatedAt: string;
  traces: AgentTrace[];
}

export interface CalendarTopic {
  tema: string;
  palavraChaveAlvo: string;
  publicado: boolean;
  publicadoEm?: string;
  generatedBy?: "marketing-director";
  createdAt?: string;
  reason?: string;
  priority?: "high" | "medium" | "low";
}
