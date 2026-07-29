import type { FinalPost } from "../agents/editorSeo.js";

interface QualityContext {
  palavraChaveAlvo?: string;
  demoPath?: string;
}

function normalize(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function trackedCtas(html: string, demoPath: string): URLSearchParams[] {
  return [...html.matchAll(/href=["']([^"']+)["']/g)]
    .map((match) => match[1])
    .filter((href) => href.startsWith(`${demoPath}?`))
    .map((href) => new URL(href, "https://nextassist.local").searchParams)
    .filter(
      (params) =>
        params.get("utm_source") === "blog" &&
        params.get("utm_medium") === "article",
    );
}

export function validateFinalPost(
  post: FinalPost,
  publishedSlugs: string[],
  context: QualityContext = {},
): void {
  const demoPath = context.demoPath ?? "/demo";
  if (post.titulo.trim().length < 20 || post.titulo.trim().length > 70) {
    throw new Error("Título fora do intervalo recomendado de 20 a 70 caracteres.");
  }
  if (post.metaDescription.trim().length < 120 || post.metaDescription.trim().length > 165) {
    throw new Error("Meta description fora do intervalo recomendado de 120 a 165 caracteres.");
  }
  if (!post.conteudo.includes("/#funcionalidades")) {
    throw new Error("O artigo precisa conter link para a seção de funcionalidades.");
  }

  const ctas = trackedCtas(post.conteudo, demoPath);
  if (ctas.length < 2) {
    throw new Error("O artigo precisa conter pelo menos dois CTAs rastreáveis para o teste grátis.");
  }
  if (ctas.some((params) => params.get("utm_campaign") !== post.slug)) {
    throw new Error("Cada CTA precisa usar o slug do artigo como utm_campaign.");
  }
  const positions = ctas.map((params) => params.get("utm_content")).filter(Boolean);
  if (new Set(positions).size < 2) {
    throw new Error("Os CTAs precisam identificar posições diferentes em utm_content.");
  }

  const blogLinks = [...post.conteudo.matchAll(/href=["']\/blog\/([^"'#?]+)["']/g)]
    .map((match) => match[1]);
  const allowed = new Set(publishedSlugs);
  const invalid = blogLinks.filter((slug) => !allowed.has(slug));
  if (invalid.length) {
    throw new Error(`O artigo contém links para posts inexistentes: ${invalid.join(", ")}`);
  }
  if (!post.conteudo.includes(demoPath)) {
    throw new Error("O artigo precisa conter um CTA para a página de demonstração.");
  }
  if (context.palavraChaveAlvo) {
    const keyword = normalize(context.palavraChaveAlvo);
    if (!normalize(post.titulo).includes(keyword) || !normalize(post.metaDescription).includes(keyword)) {
      throw new Error("O título e a meta description precisam conter a palavra-chave alvo.");
    }
  }
}
