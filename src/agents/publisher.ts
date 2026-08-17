import { generateCoverImage } from "../lib/imageGen.js";
import { uploadCoverImage } from "../lib/storage.js";
import type { WorkspaceContext } from "../context.js";
import type { FinalPost } from "./editorSeo.js";

function buildImagePrompt(ctx: WorkspaceContext, titulo: string): string {
  return `Fotografia realista para capa de blog, tema: "${titulo}".
Contexto: ${ctx.workspace.brand.description}
Foto profissional, luz natural, alta definição, profundidade de campo rasa, sem texto ou logotipos na imagem.`;
}

export interface PublishResult {
  slug: string;
  publicado: boolean;
  imagemCapa: string;
  imagemCapaBuffer: Buffer;
}

export async function publishPost(ctx: WorkspaceContext, post: FinalPost): Promise<PublishResult> {
  const imageBuffer = await generateCoverImage(ctx, buildImagePrompt(ctx, post.titulo));
  const imagemCapa = await uploadCoverImage(ctx, imageBuffer, post.slug);

  const requireApproval = ctx.workspace.autonomy.mode === "copilot";
  const result = await ctx.cms.createPost({
    titulo: post.titulo,
    slug: post.slug,
    resumo: post.resumo,
    conteudo: post.conteudo,
    imagemCapa,
    autor: ctx.workspace.brand.name,
    tags: post.tags,
    publicado: !requireApproval,
    metaTitle: post.metaTitle,
    metaDescription: post.metaDescription,
  });

  return { slug: result.slug, publicado: !requireApproval, imagemCapa, imagemCapaBuffer: imageBuffer };
}
