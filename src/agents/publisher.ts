import { config } from "../config.js";
import { getBlogAdminIdToken } from "../lib/firebaseAuth.js";
import { generateCoverImage } from "../lib/imageGen.js";
import { uploadCoverImage } from "../lib/storage.js";
import type { FinalPost } from "./editorSeo.js";

function buildImagePrompt(titulo: string): string {
  return `Fotografia realista para capa de blog, tema: "${titulo}".
Contexto: assistência técnica de celular — mãos de um técnico
consertando um smartphone, ferramentas de precisão e peças organizadas
sobre uma bancada, ambiente de loja/oficina bem iluminado. Foto
profissional, luz natural, alta definição, cores azul e branco como
paleta dominante, profundidade de campo rasa, sem texto ou logotipos
na imagem.`;
}

export interface PublishResult {
  slug: string;
  publicado: boolean;
  /** URL pública da imagem de capa (reaproveitada na publicação do Instagram). */
  imagemCapa: string;
  /** Bytes JPEG da imagem de capa (reaproveitados para gerar o Reel do Instagram). */
  imagemCapaBuffer: Buffer;
}

export async function publishPost(post: FinalPost): Promise<PublishResult> {
  const imageBuffer = await generateCoverImage(buildImagePrompt(post.titulo));
  const imagemCapa = await uploadCoverImage(imageBuffer, post.slug);

  const idToken = await getBlogAdminIdToken();

  const res = await fetch(`${config.blogApiUrl}/blog/admin/posts`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({
      titulo: post.titulo,
      slug: post.slug,
      resumo: post.resumo,
      conteudo: post.conteudo,
      imagemCapa,
      autor: config.blogAutor,
      tags: post.tags,
      publicado: !config.requireApproval,
      metaTitle: post.metaTitle,
      metaDescription: post.metaDescription,
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => null);
    throw new Error(
      `Falha ao publicar post: ${err?.error?.message ?? res.statusText}`,
    );
  }

  const data = (await res.json()) as { data: { id: string; slug: string } };
  return {
    slug: data.data.slug,
    publicado: !config.requireApproval,
    imagemCapa,
    imagemCapaBuffer: imageBuffer,
  };
}
