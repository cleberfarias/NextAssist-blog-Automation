import { config } from "../config.js";
import { getBlogAdminIdToken } from "../lib/firebaseAuth.js";
import { generateCoverImage } from "../lib/imageGen.js";
import { uploadCoverImage } from "../lib/storage.js";
import type { FinalPost } from "./editorSeo.js";

function buildImagePrompt(titulo: string): string {
  return `Capa de blog, estilo flat/vetor, cores azul e branco, tema:
"${titulo}". Contexto: assistência técnica de celular, ferramentas e
peças organizadas, visual limpo e profissional, sem texto ou logotipos
na imagem.`;
}

export async function publishPost(post: FinalPost): Promise<string> {
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
      publicado: true,
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
  return data.data.slug;
}
