// src/backlog.ts
import { countPendingTopics, getAllTopics, addTopics } from "./contentCalendar.js";
import type { NewTopicInput } from "./contentCalendar.js";
import { getHistory } from "./history.js";
import type { ContentOpportunity, GenerateContentBacklogOptions } from "./lib/marketingDirector.js";
import { runMarketingDirectorBacklog } from "./harness/marketingDirectorRuntime.js";
import { normalizeText, jaccardSimilarity } from "./lib/text.js";
import { emit, type OnEvent } from "./pipelineEvents.js";
import type { WorkspaceContext } from "./context.js";
import type { GrowthLoopProvenance } from "./revenue/types.js";

const DEFAULT_STRATEGY = { minimumPendingTopics: 5, replenishAmount: 15 };
const SIMILARITY_THRESHOLD = 0.6;

export interface BacklogResult {
  skipped: boolean;
  pendingBefore: number;
  generated: number;
  discardedDuplicates: number;
  discardedForbidden: number;
  discardedInvalid: number;
  pendingAfter: number;
  error: string | null;
}

export interface ValidateOpportunitiesOptions {
  existingThemes: string[];
  existingKeywords: string[];
  publishedTitles: string[];
  forbiddenTerms: string[];
  maxCount: number;
}

export interface ValidationResult {
  accepted: ContentOpportunity[];
  discardedDuplicates: number;
  discardedForbidden: number;
  discardedInvalid: number;
}

function isWellFormed(opportunity: ContentOpportunity): boolean {
  return Boolean(opportunity.tema?.trim()) && Boolean(opportunity.palavraChaveAlvo?.trim());
}

const containsForbiddenTerm = (text: string, terms: string[]): boolean =>
  terms.some((term) => new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(text));

/**
 * Aplica as regras de negócio antes de persistir: descarta tema/palavra-chave
 * duplicados, pautas muito parecidas com temas/títulos existentes (via
 * similaridade de Jaccard — sem embeddings/RAG, fora de escopo desta fase),
 * termos proibidos da marca, e limita à quantidade máxima configurada.
 */
export function validateOpportunities(
  opportunities: ContentOpportunity[],
  options: ValidateOpportunitiesOptions,
): ValidationResult {
  const accepted: ContentOpportunity[] = [];
  const seenThemes = new Set(options.existingThemes.map(normalizeText));
  const seenKeywords = new Set(options.existingKeywords.map(normalizeText));
  const forbiddenNorm = options.forbiddenTerms.map(normalizeText);
  let discardedDuplicates = 0;
  let discardedForbidden = 0;
  let discardedInvalid = 0;

  for (const opportunity of opportunities) {
    if (accepted.length >= options.maxCount) break;
    if (!isWellFormed(opportunity)) {
      discardedInvalid++;
      continue;
    }

    const temaNorm = normalizeText(opportunity.tema);
    const keywordNorm = normalizeText(opportunity.palavraChaveAlvo);

    if (containsForbiddenTerm(temaNorm, forbiddenNorm) || containsForbiddenTerm(keywordNorm, forbiddenNorm)) {
      discardedForbidden++;
      continue;
    }

    if (seenThemes.has(temaNorm) || seenKeywords.has(keywordNorm)) {
      discardedDuplicates++;
      continue;
    }

    const tooSimilar =
      options.existingThemes.some((t) => jaccardSimilarity(t, opportunity.tema) >= SIMILARITY_THRESHOLD) ||
      options.publishedTitles.some((t) => jaccardSimilarity(t, opportunity.tema) >= SIMILARITY_THRESHOLD) ||
      accepted.some((a) => jaccardSimilarity(a.tema, opportunity.tema) >= SIMILARITY_THRESHOLD);

    if (tooSimilar) {
      discardedDuplicates++;
      continue;
    }

    seenThemes.add(temaNorm);
    seenKeywords.add(keywordNorm);
    accepted.push(opportunity);
  }

  return { accepted, discardedDuplicates, discardedForbidden, discardedInvalid };
}

export interface EnsureContentBacklogOptions {
  generate?: (ctx: WorkspaceContext, options: GenerateContentBacklogOptions) => Promise<ContentOpportunity[]>;
}

export interface ReplenishContentBacklogOptions {
  count: number;
  /** Texto livre do Revenue Director injetado no prompt do Marketing Director. */
  steering?: string;
  /** Proveniência estruturada — estampada em cada oportunidade aceita antes de persistir. */
  growthLoopMeta?: GrowthLoopProvenance;
  /** `GrowthLoopState.runId`, repassado como `causedBy` até o trace do Harness. */
  causedBy?: string;
  generate?: (ctx: WorkspaceContext, options: GenerateContentBacklogOptions) => Promise<ContentOpportunity[]>;
}

async function generateThroughHarness(
  ctx: WorkspaceContext,
  options: GenerateContentBacklogOptions,
  causedBy?: string,
): Promise<ContentOpportunity[]> {
  const result = await runMarketingDirectorBacklog(ctx, options, causedBy);
  return result.opportunities;
}

/**
 * Gera, valida e persiste novas pautas — sem decidir SE deve gerar. Quem
 * chama decide o motivo (calendário baixo, via `ensureContentBacklog`, ou
 * gargalo diagnosticado pelo Revenue Director, via o Loop de Crescimento) e
 * o `count`. NUNCA lança por falha do Marketing Director — qualquer falha
 * vira um evento "error" e um `BacklogResult.error`.
 */
export async function replenishContentBacklog(
  ctx: WorkspaceContext,
  options: ReplenishContentBacklogOptions,
  onEvent?: OnEvent,
): Promise<BacklogResult> {
  const pendingBefore = await countPendingTopics(ctx);

  emit(onEvent, {
    agent: "marketing-director", status: "working",
    message: `Gerando até ${options.count} pauta(s) via Agent Harness...`,
  });

  try {
    const [allTopics, history] = await Promise.all([getAllTopics(ctx), getHistory(ctx)]);
    const existingThemes = allTopics.map((t) => t.tema);
    const existingKeywords = allTopics.map((t) => t.palavraChaveAlvo);
    const publishedTitles = history.map((h) => h.titulo);

    const generateOptions: GenerateContentBacklogOptions = {
      count: options.count, existingThemes, existingKeywords, publishedTitles, steering: options.steering,
    };
    const opportunities = options.generate
      ? await options.generate(ctx, generateOptions)
      : await generateThroughHarness(ctx, generateOptions, options.causedBy);

    emit(onEvent, { agent: "marketing-director", status: "working", message: `Identificou ${opportunities.length} oportunidade(s) de conteúdo.` });

    const { accepted, discardedDuplicates, discardedForbidden, discardedInvalid } = validateOpportunities(opportunities, {
      existingThemes, existingKeywords, publishedTitles,
      forbiddenTerms: ctx.workspace.brand.forbiddenTerms ?? [],
      maxCount: options.count,
    });

    const stamped: NewTopicInput[] = options.growthLoopMeta
      ? accepted.map((o) => ({ ...o, growthLoop: options.growthLoopMeta }))
      : accepted;
    await addTopics(ctx, stamped);
    const pendingAfter = pendingBefore + accepted.length;
    const totalDiscarded = discardedDuplicates + discardedForbidden + discardedInvalid;

    emit(onEvent, {
      agent: "marketing-director", status: "done",
      message: `${accepted.length} nova(s) pauta(s) adicionada(s) ao calendário${totalDiscarded > 0 ? ` (${totalDiscarded} descartada(s))` : ""}.`,
    });

    return { skipped: false, pendingBefore, generated: accepted.length, discardedDuplicates, discardedForbidden, discardedInvalid, pendingAfter, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    emit(onEvent, { agent: "marketing-director", status: "error", message: `Falha ao gerar backlog de conteúdo: ${message}` });
    return {
      skipped: false, pendingBefore, generated: 0,
      discardedDuplicates: 0, discardedForbidden: 0, discardedInvalid: 0,
      pendingAfter: pendingBefore, error: message,
    };
  }
}

/**
 * Garante que o calendário sempre tenha pautas suficientes para o pipeline
 * seguir rodando. Decide SE deve reabastecer (calendário abaixo do mínimo
 * configurado); quem gera/valida/persiste é `replenishContentBacklog`.
 */
export async function ensureContentBacklog(
  ctx: WorkspaceContext,
  onEvent?: OnEvent,
  options: EnsureContentBacklogOptions = {},
): Promise<BacklogResult> {
  const strategy = ctx.workspace.contentStrategy ?? DEFAULT_STRATEGY;
  const pendingBefore = await countPendingTopics(ctx);

  if (pendingBefore >= strategy.minimumPendingTopics) {
    return {
      skipped: true, pendingBefore, generated: 0,
      discardedDuplicates: 0, discardedForbidden: 0, discardedInvalid: 0,
      pendingAfter: pendingBefore, error: null,
    };
  }

  emit(onEvent, {
    agent: "marketing-director", status: "working",
    message: `Backlog com ${pendingBefore} tópico(s) pendente(s) (mínimo: ${strategy.minimumPendingTopics}) — analisando contexto do workspace via Agent Harness...`,
  });

  return replenishContentBacklog(ctx, { count: strategy.replenishAmount, generate: options.generate }, onEvent);
}
