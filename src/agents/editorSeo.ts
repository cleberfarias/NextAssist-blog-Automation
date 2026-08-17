import { runAgent, extractJson } from "../lib/anthropic.js";
import type { WorkspaceContext } from "../context.js";
import type { ContentPlan } from "./topicPlanner.js";

const SYSTEM_TEMPLATE = (ctx: WorkspaceContext) => `Você é o editor de SEO do blog do ${ctx.workspace.brand.name}. Revise o rascunho HTML
recebido e devolva a versão final pronta para publicar, aplicando:
- Slug curto em kebab-case, sem acentos, baseado no título
- Resumo de 1-2 frases (para listagem e meta description, até 160 caracteres)
- 3 a 5 tags relevantes
- Se houver alguma seção em formato pergunta/resposta, adicione ao final
  do HTML um bloco <script type="application/ld+json"> com FAQPage schema
  correspondente
- Se a lista de slugs publicados fornecida no contexto tiver pelo menos 2
  itens, garanta que o HTML tem pelo menos 2 links internos usando
  <a href="/blog/...">, usando exclusivamente slugs dessa lista — nunca
  invente um slug que não esteja nela. Se a lista tiver menos de 2 itens,
  use os que houver (ou nenhum) e não invente.
- Não repita o título dentro do HTML do conteúdo

Responda SOMENTE em JSON, sem texto antes ou depois, no formato:
{
  "titulo": "...",
  "slug": "...",
  "resumo": "...",
  "conteudo": "<html final>",
  "tags": ["...", "..."],
  "metaTitle": "...",
  "metaDescription": "..."
}`;

export interface FinalPost {
  titulo: string; slug: string; resumo: string; conteudo: string;
  tags: string[]; metaTitle: string; metaDescription: string;
}

export interface EditorialContext {
  palavraChaveAlvo?: string;
  slugsPublicados: string[];
  demoPath?: string;
}

export function ensureTrackedCtas(post: FinalPost, demoPath = "/demo"): FinalPost {
  const base = `${demoPath}?utm_source=blog&utm_medium=article&utm_campaign=${encodeURIComponent(post.slug)}`;
  let conteudo = post.conteudo;
  if (!conteudo.includes(`${base}&utm_content=cta-inline`)) conteudo += `<p><a href="${base}&utm_content=cta-inline">Teste grátis por 7 dias</a></p>`;
  if (!conteudo.includes(`${base}&utm_content=cta-final`)) conteudo += `<p><a href="${base}&utm_content=cta-final">Comece seu teste grátis</a></p>`;
  return conteudo === post.conteudo ? post : { ...post, conteudo };
}

export async function editAndFinalize(
  ctx: WorkspaceContext,
  plan: ContentPlan,
  draftHtml: string,
  context: EditorialContext = { slugsPublicados: [] },
): Promise<FinalPost> {
  const raw = await runAgent(ctx, {
    system: SYSTEM_TEMPLATE(ctx),
    prompt: `Título planejado: ${plan.titulo}
Meta description planejada: ${plan.metaDescription}

Rascunho HTML:
${draftHtml}

Slugs publicados disponíveis para link interno (use somente estes, nunca invente outro): ${
      context.slugsPublicados.length ? context.slugsPublicados.map((slug) => `/blog/${slug}`).join(", ") : "nenhum ainda — não inclua links /blog/... neste artigo"
    }
Palavra-chave principal: "${context.palavraChaveAlvo ?? ""}". Ela deve aparecer naturalmente no título e na meta description.
Inclua dois links para o teste grátis. Em ambos, use ${context.demoPath ?? "/demo"}?utm_source=blog&utm_medium=article&utm_campaign=SLUG_DO_ARTIGO e identifique a posição:
- CTA no meio do artigo: utm_content=cta-inline
- CTA ao final do artigo: utm_content=cta-final
Substitua SLUG_DO_ARTIGO pelo mesmo slug devolvido no JSON.`,
    maxTokens: 8000,
  });
  return ensureTrackedCtas(extractJson<FinalPost>(raw), context.demoPath);
}
