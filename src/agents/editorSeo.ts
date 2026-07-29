import { runAgent, extractJson } from "../lib/anthropic.js";
import type { ContentPlan } from "./topicPlanner.js";

const SYSTEM = `Você é o editor de SEO do blog do NextAssist. Revise o rascunho HTML
recebido e devolva a versão final pronta para publicar, aplicando:
- Slug curto em kebab-case, sem acentos, baseado no título
- Resumo de 1-2 frases (para listagem e meta description, até 160 caracteres)
- 3 a 5 tags relevantes
- Se houver alguma seção em formato pergunta/resposta, adicione ao final
  do HTML um bloco <script type="application/ld+json"> com FAQPage schema
  correspondente
- Garanta que o HTML tem pelo menos 2 links internos usando <a href="/blog/...">
  para outros posts do blog do NextAssist (pode usar slugs plausíveis
  relacionados ao tema, já que o blog está em expansão) e pelo menos 1
  link para a página de funcionalidades, ex: <a href="/#funcionalidades">
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
  titulo: string;
  slug: string;
  resumo: string;
  conteudo: string;
  tags: string[];
  metaTitle: string;
  metaDescription: string;
}

export interface EditorialContext {
  palavraChaveAlvo?: string;
  slugsPublicados: string[];
  demoPath?: string;
}

export async function editAndFinalize(
  plan: ContentPlan,
  draftHtml: string,
  context: EditorialContext = { slugsPublicados: [] },
): Promise<FinalPost> {
  const raw = await runAgent({
    system: SYSTEM,
    prompt: `Título planejado: ${plan.titulo}
Meta description planejada: ${plan.metaDescription}

Rascunho HTML:
${draftHtml}

Regras obrigatórias adicionais: use somente os slugs listados no contexto; não invente links.
Palavra-chave principal: "${context.palavraChaveAlvo ?? ""}". Ela deve aparecer naturalmente no título e na meta description.
Inclua /#funcionalidades e dois links para o teste grátis de 7 dias. Em ambos, use ${context.demoPath ?? "/demo"}?utm_source=blog&utm_medium=article&utm_campaign=SLUG_DO_ARTIGO e identifique a posição:
- CTA no meio do artigo: utm_content=cta-inline
- CTA ao final do artigo: utm_content=cta-final
Substitua SLUG_DO_ARTIGO pelo mesmo slug devolvido no JSON.`,
    // O editor devolve o artigo HTML inteiro embutido num JSON, então
    // precisa de mais folga que o redator (4000) — senão a resposta é
    // cortada no meio de uma string e o JSON.parse falha.
    maxTokens: 8000,
  });
  return extractJson<FinalPost>(raw);
}
