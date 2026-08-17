// src/pipeline.ts
import { getNextTopic, markTopicPublished } from "./contentCalendar.js";
import { ensureContentBacklog } from "./backlog.js";
import { researchMarket } from "./agents/marketResearch.js";
import { planTopic } from "./agents/topicPlanner.js";
import { writeArticle } from "./agents/writer.js";
import { editAndFinalize } from "./agents/editorSeo.js";
import { publishPost } from "./agents/publisher.js";
import { publishToInstagram } from "./agents/instagramPublisher.js";
import { indexPublishedPost, postUrl } from "./agents/indexer.js";
import { appendHistory } from "./history.js";
import { validateFinalPost } from "./lib/contentQuality.js";
import { emit, type OnEvent } from "./pipelineEvents.js";
import type { BacklogResult } from "./backlog.js";
import type { WorkspaceContext, AnthropicUsage } from "./context.js";

export type { AgentId, AgentStatus, PipelineEvent, OnEvent } from "./pipelineEvents.js";

async function getPublishedSlugs(ctx: WorkspaceContext): Promise<string[]> {
  const response = await fetch(`${ctx.workspace.integrations.cms.apiUrl}/blog/posts`, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`Não foi possível carregar posts existentes: HTTP ${response.status}`);
  const payload = (await response.json()) as { data?: Array<{ slug?: string }> };
  return (payload.data ?? []).map((post) => post.slug).filter((slug): slug is string => Boolean(slug));
}

export interface PipelineResult {
  tema: string | null;
  slugPublicado: string | null;
  usage: AnthropicUsage;
  backlog: BacklogResult;
}

/**
 * Roda o pipeline completo uma vez para um workspace: reabastecimento de
 * backlog (Marketing Director, se necessário) → pesquisa de mercado →
 * pesquisa de pauta → redação → edição/SEO → publicação → Instagram →
 * indexação. Chama `onEvent` a cada mudança de estado de um agente.
 *
 * Recebe o `WorkspaceContext` já construído pelo chamador (entrypoint ou
 * painel) — não resolve workspace/segredos por conta própria, para não
 * reconstruir o contexto (e reautenticar) mais de uma vez por execução.
 */
export async function runPipeline(ctx: WorkspaceContext, onEvent?: OnEvent): Promise<PipelineResult> {
  const backlog = await ensureContentBacklog(ctx, onEvent);
  const topic = await getNextTopic(ctx);
  if (!topic) {
    const detail = backlog.error ? ` Motivo do reabastecimento não ter resolvido: ${backlog.error}` : "";
    emit(onEvent, { agent: "pesquisa-pauta", status: "error", message: `Nenhum tópico pendente no calendário.${detail}` });
    return { tema: null, slugPublicado: null, usage: ctx.usage.get(), backlog };
  }

  try {
    emit(onEvent, { agent: "pesquisa-mercado", status: "working", tema: topic.tema, message: "Buscando o que os concorrentes publicaram..." });
    const marketResearch = await researchMarket(ctx, topic.tema);
    emit(onEvent, { agent: "pesquisa-mercado", status: "done", message: marketResearch.slice(0, 240) });

    emit(onEvent, { agent: "pesquisa-pauta", status: "working", message: "Definindo título, ângulo e estrutura..." });
    const plan = await planTopic(ctx, topic.tema, topic.palavraChaveAlvo, marketResearch);
    emit(onEvent, { agent: "pesquisa-pauta", status: "done", message: `Título: ${plan.titulo}` });

    emit(onEvent, { agent: "redator", status: "working", message: "Escrevendo o rascunho..." });
    const draftHtml = await writeArticle(ctx, topic.tema, topic.palavraChaveAlvo, plan, marketResearch);
    emit(onEvent, { agent: "redator", status: "done", message: `${draftHtml.replace(/<[^>]+>/g, "").slice(0, 200)}...` });

    emit(onEvent, { agent: "editor-seo", status: "working", message: "Revisando e adicionando links internos..." });
    const publishedSlugs = await getPublishedSlugs(ctx);
    const finalPost = await editAndFinalize(ctx, plan, draftHtml, {
      palavraChaveAlvo: topic.palavraChaveAlvo,
      slugsPublicados: publishedSlugs,
    });
    validateFinalPost(finalPost, publishedSlugs, {
      palavraChaveAlvo: topic.palavraChaveAlvo,
      requiredLinks: ctx.workspace.brand.requiredLinks,
    });
    emit(onEvent, { agent: "editor-seo", status: "done", message: `Slug: ${finalPost.slug} · Tags: ${finalPost.tags.join(", ")}` });

    emit(onEvent, { agent: "publicador", status: "working", message: "Gerando capa e publicando no blog..." });
    const published = await publishPost(ctx, finalPost);
    const publishedSlug = published.slug;
    emit(onEvent, {
      agent: "publicador", status: "done",
      message: published.publicado ? `Publicado em /blog/${publishedSlug}` : `Rascunho criado em /blog/${publishedSlug} — aguardando aprovação`,
    });

    if (ctx.workspace.channels.instagram) {
      emit(onEvent, { agent: "instagram", status: "working", message: "Publicando no Instagram..." });
      const igResult = await publishToInstagram(ctx, finalPost, published.imagemCapaBuffer, postUrl(ctx, publishedSlug));
      emit(onEvent, { agent: "instagram", status: igResult.ok ? "done" : "error", message: igResult.detalhes });
    } else {
      emit(onEvent, { agent: "instagram", status: "done", message: "Instagram não habilitado para este workspace — passo ignorado." });
    }

    emit(onEvent, { agent: "indexador", status: "working", message: "Notificando o Google e reenviando o sitemap..." });
    if (published.publicado) {
      const indexResult = await indexPublishedPost(ctx, publishedSlug);
      emit(onEvent, { agent: "indexador", status: "done", message: indexResult.detalhes });
    } else {
      emit(onEvent, { agent: "indexador", status: "done", message: "Indexação aguardará a aprovação do rascunho." });
    }

    if (published.publicado) await markTopicPublished(ctx, topic.tema);
    await appendHistory(ctx, { tema: topic.tema, titulo: finalPost.titulo, slug: publishedSlug, publicadoEm: new Date().toISOString() });

    return { tema: topic.tema, slugPublicado: publishedSlug, usage: ctx.usage.get(), backlog };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    emit(onEvent, { agent: "publicador", status: "error", message });
    const wrapped = err instanceof Error ? err : new Error(message);
    (wrapped as Error & { usage?: AnthropicUsage }).usage = ctx.usage.get();
    throw wrapped;
  }
}
