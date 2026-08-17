// src/backlog.ts
import { countPendingTopics, getAllTopics, addTopics } from "./contentCalendar.js";
import { getHistory } from "./history.js";
import { generateContentBacklog, type ContentOpportunity, type GenerateContentBacklogOptions } from "./lib/marketingDirector.js";
import { normalizeText, jaccardSimilarity } from "./lib/text.js";
import { emit, type OnEvent } from "./pipelineEvents.js";
import type { WorkspaceContext } from "./context.js";

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

    if (forbiddenNorm.some((term) => temaNorm.includes(term) || keywordNorm.includes(term))) {
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

/**
 * Garante que o calendário sempre tenha pautas suficientes para o pipeline
 * seguir rodando. NUNCA lança — qualquer falha do Marketing Director vira um
 * evento "error" e um `BacklogResult.error`, deixando o pipeline decidir o
 * que fazer (seguir com um tópico pendente antigo, ou encerrar se não sobrou
 * nenhum — essa decisão é do chamador, não desta função).
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
    message: `Backlog com ${pendingBefore} tópico(s) pendente(s) (mínimo: ${strategy.minimumPendingTopics}) — analisando contexto do workspace...`,
  });

  try {
    const [allTopics, history] = await Promise.all([getAllTopics(ctx), getHistory(ctx)]);
    const existingThemes = allTopics.map((t) => t.tema);
    const existingKeywords = allTopics.map((t) => t.palavraChaveAlvo);
    const publishedTitles = history.map((h) => h.titulo);

    const generate = options.generate ?? generateContentBacklog;
    const opportunities = await generate(ctx, {
      count: strategy.replenishAmount,
      existingThemes, existingKeywords, publishedTitles,
    });

    emit(onEvent, { agent: "marketing-director", status: "working", message: `Identificou ${opportunities.length} oportunidade(s) de conteúdo.` });

    const { accepted, discardedDuplicates, discardedForbidden, discardedInvalid } = validateOpportunities(opportunities, {
      existingThemes, existingKeywords, publishedTitles,
      forbiddenTerms: ctx.workspace.brand.forbiddenTerms ?? [],
      maxCount: strategy.replenishAmount,
    });

    await addTopics(ctx, accepted);
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
