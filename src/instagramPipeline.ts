import { generateCoverImage } from "./lib/imageGen.js";
import { publishToInstagram, type InstagramResult } from "./agents/instagramPublisher.js";
import { getNextInstagramTopic, markInstagramTopicPublished } from "./instagramCalendar.js";
import type { WorkspaceContext } from "./context.js";
import type { FinalPost } from "./agents/editorSeo.js";
import { registerContent } from "./contentRegistry.js";

export async function runInstagramPipeline(ctx: WorkspaceContext): Promise<InstagramResult> {
  const topic = await getNextInstagramTopic(ctx);
  if (!topic) return { ok: false, permalink: null, detalhes: "Nenhuma pauta pendente na fila do Instagram." };
  const post: FinalPost = { titulo: topic.tema, slug: `instagram-${topic.id}`, resumo: `Dica prática para ${ctx.workspace.brand.targetAudience[0] ?? "sua assistência técnica"}.`, conteudo: "", tags: [topic.pilar, "assistência técnica"], metaTitle: topic.tema, metaDescription: topic.tema };
  const image = await generateCoverImage(ctx, `Imagem realista para Reel vertical sobre "${topic.tema}". Assistência técnica de celular brasileira, bancada e atendimento reais, sem texto e sem logotipos.`);
  const result = await publishToInstagram(ctx, post, image, `${ctx.workspace.integrations.siteUrl}/blog`);
  if (result.ok) {
    await markInstagramTopicPublished(ctx, topic.id);
    await registerContent(ctx, { contentId: result.mediaId ?? `instagram-${topic.id}`, campaignId: null, tema: topic.tema, formato: "instagram-reel", channel: "instagram", funnelStage: "topo", publicadoEm: new Date().toISOString(), status: "published", url: result.permalink ?? "" });
  }
  return result;
}
