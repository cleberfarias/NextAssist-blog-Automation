import { generateCoverImage } from "./lib/imageGen.js";
import { publishToInstagram, type InstagramResult } from "./agents/instagramPublisher.js";
import { getNextInstagramTopic, markInstagramTopicPublished } from "./instagramCalendar.js";
import type { WorkspaceContext } from "./context.js";
import type { FinalPost } from "./agents/editorSeo.js";
import { registerContent } from "./contentRegistry.js";
import { emit, type OnEvent } from "./pipelineEvents.js";

export async function runInstagramPipeline(ctx: WorkspaceContext, onEvent?: OnEvent): Promise<InstagramResult> {
  const topic = await getNextInstagramTopic(ctx);
  if (!topic) {
    const result = { ok: false, permalink: null, detalhes: "Nenhuma pauta pendente na fila do Instagram." };
    emit(onEvent, { agent: "instagram", status: "done", message: result.detalhes });
    return result;
  }

  if (topic.formato !== "reel") {
    const result = {
      ok: false,
      permalink: null,
      detalhes: `Formato "${topic.formato}" ainda não tem publicação automática; pauta mantida pendente.`,
    };
    emit(onEvent, { agent: "instagram", status: "error", tema: topic.tema, message: result.detalhes });
    return result;
  }

  emit(onEvent, {
    agent: "instagram",
    status: "working",
    tema: topic.tema,
    message: `Pauta própria do Instagram · ${topic.pilar} · objetivo: venda/conversa`,
  });

  const post: FinalPost = {
    titulo: topic.tema,
    slug: `instagram-${topic.id}`,
    resumo: `Situação prática para ${ctx.workspace.brand.targetAudience[0] ?? "donos de assistência técnica"}.`,
    conteudo: "",
    tags: [topic.pilar, "assistência técnica", "NextAssist"],
    metaTitle: topic.tema,
    metaDescription: topic.tema,
  };

  const image = await generateCoverImage(
    ctx,
    `Imagem vertical realista de apoio para Reel sobre "${topic.tema}". Assistência técnica de celular brasileira, bancada, ferramentas e atendimento reais. Fotografia documental, natural, sem texto e sem logotipos.`,
  );

  const result = await publishToInstagram(ctx, post, image, ctx.workspace.integrations.siteUrl);
  if (result.ok) {
    await markInstagramTopicPublished(ctx, topic.id);
    await registerContent(ctx, {
      contentId: result.mediaId ?? `instagram-${topic.id}`,
      campaignId: topic.id,
      tema: topic.tema,
      formato: "instagram-reel",
      channel: "instagram",
      funnelStage: "fundo",
      publicadoEm: new Date().toISOString(),
      status: "published",
      url: result.permalink ?? "",
    });
    emit(onEvent, { agent: "instagram", status: "done", message: result.detalhes });
  } else {
    emit(onEvent, { agent: "instagram", status: "error", message: result.detalhes });
  }
  return result;
}
