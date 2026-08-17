// src/lib/marketingDirector.ts
import { runAgent, extractJson } from "./anthropic.js";
import { getPerformance } from "../performance.js";
import { getConversionSummary } from "../conversions.js";
import { getTopSearchQueries } from "./searchConsole.js";
import type { WorkspaceContext } from "../context.js";
import type { PerformanceReport } from "../performance.js";

export interface ContentOpportunity {
  tema: string;
  palavraChaveAlvo: string;
  reason: string;
  priority: "high" | "medium" | "low";
  source: "search-console" | "conversion" | "competitor" | "content-gap" | "workspace-goal" | "other";
}

export interface GenerateContentBacklogOptions {
  count: number;
  existingThemes: string[];
  existingKeywords: string[];
  publishedTitles: string[];
}

const PRIORITIES = new Set(["high", "medium", "low"]);
const SOURCES = new Set(["search-console", "conversion", "competitor", "content-gap", "workspace-goal", "other"]);

function isValidOpportunity(item: unknown): item is ContentOpportunity {
  if (typeof item !== "object" || item === null) return false;
  const candidate = item as Record<string, unknown>;
  return (
    typeof candidate.tema === "string" && candidate.tema.trim().length > 0 &&
    typeof candidate.palavraChaveAlvo === "string" && candidate.palavraChaveAlvo.trim().length > 0 &&
    typeof candidate.reason === "string" &&
    typeof candidate.priority === "string" && PRIORITIES.has(candidate.priority) &&
    typeof candidate.source === "string" && SOURCES.has(candidate.source)
  );
}

/**
 * Valida a resposta do LLM contra o schema de `ContentOpportunity`. Itens
 * malformados são descartados silenciosamente (o LLM às vezes erra um campo
 * isolado); só lança erro se a resposta inteira não for uma lista, ou se uma
 * lista não vazia não tiver sobrado nenhum item válido.
 */
export function parseContentOpportunities(raw: unknown): ContentOpportunity[] {
  if (!Array.isArray(raw)) {
    throw new Error("Resposta do Marketing Director não é uma lista de oportunidades.");
  }
  const valid = raw.filter(isValidOpportunity);
  if (raw.length > 0 && valid.length === 0) {
    throw new Error(`Nenhuma das ${raw.length} oportunidade(s) retornada(s) pelo Marketing Director passou na validação de schema.`);
  }
  return valid;
}

const SYSTEM_TEMPLATE = (ctx: WorkspaceContext) => `Você é o Marketing Director do ${ctx.workspace.brand.name} — ${ctx.workspace.brand.description}
Tom de voz: ${ctx.workspace.brand.toneOfVoice}
Público-alvo: ${ctx.workspace.brand.targetAudience.join(", ") || "não especificado"}
Concorrentes diretos: ${ctx.workspace.brand.competitors.join(", ") || "não especificado"}
Propostas de valor: ${(ctx.workspace.brand.valuePropositions ?? []).join(", ") || "não especificado"}
Objetivo principal do workspace: ${ctx.workspace.goals.primary}

Sua responsabilidade é perceber quando o backlog de pautas do blog está
ficando baixo e propor novas oportunidades de conteúdo com potencial real de
impacto nesse objetivo — nunca gere temas aleatórios ou genéricos.

Priorize, nesta ordem quando o contexto disponível permitir:
1. Oportunidades do Search Console (termos com impressões altas e posição ou CTR ruins).
2. Temas relacionados a conteúdo que já converte bem (campanhas/CTAs com mais leads).
3. Lacunas em relação aos concorrentes.
4. Atualização de clusters de conteúdo já existentes.
5. Outras oportunidades alinhadas ao objetivo principal do workspace.

Responda SOMENTE com um array JSON, sem texto antes ou depois, no formato:
[
  {
    "tema": "...",
    "palavraChaveAlvo": "...",
    "reason": "explicação curta e concreta do porquê essa pauta importa agora",
    "priority": "high" | "medium" | "low",
    "source": "search-console" | "conversion" | "competitor" | "content-gap" | "workspace-goal" | "other"
  }
]`;

function buildPrompt(
  ctx: WorkspaceContext,
  options: GenerateContentBacklogOptions,
  performance: PerformanceReport | null,
  conversions: Awaited<ReturnType<typeof getConversionSummary>> | null,
  topQueries: Awaited<ReturnType<typeof getTopSearchQueries>>,
): string {
  const forbidden = ctx.workspace.brand.forbiddenTerms ?? [];

  const topByClicks = [...(performance?.posts ?? [])]
    .sort((a, b) => b.clicks - a.clicks)
    .slice(0, 5)
    .map((p) => `- "${p.titulo}" (${p.clicks} cliques, posição média ${p.position.toFixed(1)})`)
    .join("\n") || "(sem dados de performance ainda)";

  const topByCampaign = (conversions?.byCampaign ?? [])
    .slice(0, 5)
    .map((c) => `- ${c.campaign}: ${c.leads} leads (taxa de demo ${(c.demoRate * 100).toFixed(0)}%)`)
    .join("\n") || "(sem dados de conversão ainda)";

  const searchOpportunities = topQueries
    .slice(0, 10)
    .map((q) => `- "${q.query}" (${q.impressions} impressões, posição média ${q.position.toFixed(1)}, ${q.clicks} cliques)`)
    .join("\n") || "(Search Console não configurado ou sem dados)";

  return `Gere até ${options.count} novas oportunidades de pauta para o blog.

Temas já existentes no calendário (pendentes ou publicados) — NÃO repita nem gere algo muito parecido:
${options.existingThemes.map((t) => `- ${t}`).join("\n") || "(nenhum)"}

Palavras-chave já usadas — evite repetir:
${options.existingKeywords.join(", ") || "(nenhuma)"}

Títulos já publicados no blog:
${options.publishedTitles.map((t) => `- ${t}`).join("\n") || "(nenhum)"}

Posts com melhor desempenho no Search Console (últimos 28 dias):
${topByClicks}

Campanhas/conteúdo com melhor conversão em lead:
${topByCampaign}

Termos de busca com maior potencial (impressões altas, posição ou CTR ruins):
${searchOpportunities}
${forbidden.length ? `\nTermos proibidos — nunca use nem referencie: ${forbidden.join(", ")}` : ""}`;
}

/**
 * A "skill" do Marketing Director: junta o contexto de marketing disponível
 * para o workspace e pede ao LLM uma lista estruturada de oportunidades de
 * conteúdo. NÃO grava nada em disco — quem chama (`ensureContentBacklog`)
 * ainda precisa validar duplicidade/qualidade antes de persistir.
 */
export async function generateContentBacklog(
  ctx: WorkspaceContext,
  options: GenerateContentBacklogOptions,
): Promise<ContentOpportunity[]> {
  const [performance, conversions, topQueries] = await Promise.all([
    getPerformance(ctx),
    getConversionSummary(ctx),
    getTopSearchQueries(ctx).catch(() => []),
  ]);

  const raw = await runAgent(ctx, {
    system: SYSTEM_TEMPLATE(ctx),
    prompt: buildPrompt(ctx, options, performance, conversions, topQueries),
    maxTokens: 3000,
  });

  return parseContentOpportunities(extractJson<unknown>(raw));
}
