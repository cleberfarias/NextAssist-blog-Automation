import { config } from "../config.js";
import type { FinalPost } from "../agents/editorSeo.js";

const CTA_HREF = /\/demo\?utm_source=blog&utm_medium=article&utm_campaign=content&utm_content=cta/g;

export function validateFinalPost(post: FinalPost, publishedSlugs: string[]): void {
  if (post.titulo.trim().length < 20 || post.titulo.trim().length > 70) {
    throw new Error("Título fora do intervalo recomendado de 20 a 70 caracteres.");
  }
  if (post.metaDescription.trim().length < 120 || post.metaDescription.trim().length > 165) {
    throw new Error("Meta description fora do intervalo recomendado de 120 a 165 caracteres.");
  }
  if (!post.conteudo.includes("/#funcionalidades")) {
    throw new Error("O artigo precisa conter link para a seção de funcionalidades.");
  }
  if ((post.conteudo.match(CTA_HREF) ?? []).length < 2) {
    throw new Error("O artigo precisa conter pelo menos dois CTAs rastreáveis para o teste grátis.");
  }

  const blogLinks = [...post.conteudo.matchAll(/href=["']\/blog\/([^"'#?]+)["']/g)].map((match) => match[1]);
  const allowed = new Set(publishedSlugs);
  const invalid = blogLinks.filter((slug) => !allowed.has(slug));
  if (invalid.length) {
    throw new Error(`O artigo contém links para posts inexistentes: ${invalid.join(", ")}`);
  }
  if (!post.conteudo.includes(config.demoPath)) {
    throw new Error("O artigo precisa conter um CTA para a página de demonstração.");
  }
}
