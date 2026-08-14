import { getNextTopic, markTopicPublished } from "./contentCalendar.js";
import { researchMarket } from "./agents/marketResearch.js";
import { planTopic } from "./agents/topicPlanner.js";
import { writeArticle } from "./agents/writer.js";
import { editAndFinalize } from "./agents/editorSeo.js";
import { publishPost } from "./agents/publisher.js";
import { publishToInstagram } from "./agents/instagramPublisher.js";
import { indexPublishedPost, postUrl } from "./agents/indexer.js";
import { appendHistory } from "./history.js";
import { config } from "./config.js";
import { resetAnthropicUsage } from "./lib/anthropic.js";
import { validateFinalPost } from "./lib/contentQuality.js";

export type AgentId =
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

export type OnEvent = (event: PipelineEvent) => void;

async function getPublishedSlugs(): Promise<string[]> {
  const response = await fetch(`${config.blogApiUrl}/blog/posts`, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`Não foi possível carregar posts existentes: HTTP ${response.status}`);
  const payload = (await response.json()) as { data?: Array<{ slug?: string }> };
  return (payload.data ?? []).map((post) => post.slug).filter((slug): slug is string => Boolean(slug));
}

function emit(onEvent: OnEvent | undefined, event: Omit<PipelineEvent, "timestamp">) {
  onEvent?.({ ...event, timestamp: new Date().toISOString() });
}

export interface PipelineResult {
  tema: string;
  slugPublicado: string;
}

/**
 * Roda o pipeline completo uma vez: pesquisa de mercado → pesquisa de
 * pauta → redação → edição/SEO → publicação. Chama `onEvent` a cada
 * mudança de estado de um agente, para quem quiser acompanhar ao vivo
 * (o servidor web usa isso pra alimentar o "escritório").
 */
export async function runPipeline(onEvent?: OnEvent): Promise<PipelineResult | null> {
  resetAnthropicUsage();
  const topic = await getNextTopic();
  if (!topic) {
    emit(onEvent, { agent: "pesquisa-pauta", status: "error", message: "Nenhum tópico pendente no calendário." });
    return null;
  }

  try {
    emit(onEvent, { agent: "pesquisa-mercado", status: "working", tema: topic.tema, message: "Buscando o que os concorrentes publicaram..." });
    const marketResearch = await researchMarket(topic.tema);
    emit(onEvent, { agent: "pesquisa-mercado", status: "done", message: marketResearch.slice(0, 240) });

    emit(onEvent, { agent: "pesquisa-pauta", status: "working", message: "Definindo título, ângulo e estrutura..." });
    const plan = await planTopic(topic.tema, topic.palavraChaveAlvo, marketResearch);
    emit(onEvent, { agent: "pesquisa-pauta", status: "done", message: `Título: ${plan.titulo}` });

    emit(onEvent, { agent: "redator", status: "working", message: "Escrevendo o rascunho..." });
    const draftHtml = await writeArticle(topic.tema, topic.palavraChaveAlvo, plan, marketResearch);
    emit(onEvent, { agent: "redator", status: "done", message: `${draftHtml.replace(/<[^>]+>/g, "").slice(0, 200)}...` });

    emit(onEvent, { agent: "editor-seo", status: "working", message: "Revisando, adicionando schema e links internos..." });
    const publishedSlugs = await getPublishedSlugs();
    const finalPost = await editAndFinalize(plan, draftHtml, {
      palavraChaveAlvo: topic.palavraChaveAlvo,
      slugsPublicados: publishedSlugs,
      demoPath: config.demoPath,
    });
    validateFinalPost(finalPost, publishedSlugs, {
      palavraChaveAlvo: topic.palavraChaveAlvo,
      demoPath: config.demoPath,
    });
    emit(onEvent, { agent: "editor-seo", status: "done", message: `Slug: ${finalPost.slug} · Tags: ${finalPost.tags.join(", ")}` });

    emit(onEvent, { agent: "publicador", status: "working", message: "Gerando capa e publicando no blog..." });
    const published = await publishPost(finalPost);
    const publishedSlug = published.slug;
    emit(onEvent, {
      agent: "publicador",
      status: "done",
      message: published.publicado
        ? `Publicado em /blog/${publishedSlug}`
        : `Rascunho criado em /blog/${publishedSlug} — aguardando aprovação`,
    });

    // Instagram — melhor esforço: reaproveita a capa e nunca derruba o pipeline
    // (o post do blog já foi publicado neste ponto).
    if (config.instagram.userId && config.instagram.accessToken) {
      emit(onEvent, { agent: "instagram", status: "working", message: "Publicando no Instagram..." });
      const igResult = await publishToInstagram(finalPost, published.imagemCapaBuffer, postUrl(publishedSlug));
      emit(onEvent, { agent: "instagram", status: igResult.ok ? "done" : "error", message: igResult.detalhes });
    } else {
      emit(onEvent, { agent: "instagram", status: "done", message: "Instagram não configurado — passo ignorado." });
    }

    emit(onEvent, { agent: "indexador", status: "working", message: "Notificando o Google e reenviando o sitemap..." });
    if (published.publicado) {
      const indexResult = await indexPublishedPost(publishedSlug);
      emit(onEvent, { agent: "indexador", status: "done", message: indexResult.detalhes });
    } else {
      emit(onEvent, { agent: "indexador", status: "done", message: "Indexação aguardará a aprovação do rascunho." });
    }

    if (published.publicado) await markTopicPublished(topic.tema);
    await appendHistory({
      tema: topic.tema,
      titulo: finalPost.titulo,
      slug: publishedSlug,
      publicadoEm: new Date().toISOString(),
    });

    return { tema: topic.tema, slugPublicado: publishedSlug };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    emit(onEvent, { agent: "publicador", status: "error", message });
    throw err;
  }
}
