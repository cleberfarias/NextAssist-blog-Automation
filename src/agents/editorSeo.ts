import { runAgent, extractJson } from "../lib/anthropic.js";
import type { WorkspaceContext } from "../context.js";
import type { ContentPlan } from "./topicPlanner.js";

/** Instrução extra só quando o workspace declara links obrigatórios em brand.requiredLinks. */
function requiredLinksRule(ctx: WorkspaceContext): string {
  const links = ctx.workspace.brand.requiredLinks ?? [];
  if (!links.length) return "";
  return `\n- O HTML precisa conter um link <a href="..."> para cada um destes caminhos: ${links.join(", ")}`;
}

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
- Não repita o título dentro do HTML do conteúdo${requiredLinksRule(ctx)}

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
  /** Agrupamento temático opcional (utm_campaign). Sempre `null`/ausente no P0. */
  campaignId?: string | null;
}

export interface CtaOptions {
  demoPath?: string;
  campaignId?: string | null;
}

/**
 * utm_campaign = campaignId (agrupamento temático); utm_content = contentId
 * (= slug, chave do join com content-registry/attribution). A posição do CTA
 * é identificada por `cta_id`, deliberadamente fora do padrão UTM — ele
 * descreve a interação dentro do conteúdo, não a origem da aquisição.
 */
export function ensureTrackedCtas(post: FinalPost, options: CtaOptions = {}): FinalPost {
  const demoPath = options.demoPath ?? "/demo";
  const campaignId = options.campaignId ?? "sem-campanha";
  const base = `${demoPath}?utm_source=blog&utm_medium=article&utm_campaign=${encodeURIComponent(campaignId)}&utm_content=${encodeURIComponent(post.slug)}`;
  let conteudo = post.conteudo;
  if (!conteudo.includes(`${base}&cta_id=cta-inline`)) conteudo += `<p><a href="${base}&cta_id=cta-inline">Teste grátis por 7 dias</a></p>`;
  if (!conteudo.includes(`${base}&cta_id=cta-final`)) conteudo += `<p><a href="${base}&cta_id=cta-final">Comece seu teste grátis</a></p>`;
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
Inclua dois links para o teste grátis. Em ambos, use ${context.demoPath ?? "/demo"}?utm_source=blog&utm_medium=article&utm_campaign=${context.campaignId ?? "sem-campanha"}&utm_content=SLUG_DO_ARTIGO e identifique a posição com cta_id:
- CTA no meio do artigo: cta_id=cta-inline
- CTA ao final do artigo: cta_id=cta-final
Substitua SLUG_DO_ARTIGO pelo mesmo slug devolvido no JSON.`,
    maxTokens: 8000,
  });
  return ensureTrackedCtas(extractJson<FinalPost>(raw), { demoPath: context.demoPath, campaignId: context.campaignId });
}
