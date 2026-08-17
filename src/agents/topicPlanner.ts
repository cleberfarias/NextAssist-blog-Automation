import { runAgent, extractJson } from "../lib/anthropic.js";
import type { WorkspaceContext } from "../context.js";

const SYSTEM_TEMPLATE = (ctx: WorkspaceContext) => `Você é o planejador editorial do blog do ${ctx.workspace.brand.name}. Com base no tema do
dia e na pesquisa de mercado fornecida, defina o ângulo específico do
post, o título, a meta description e a estrutura de H2s. Responda
SOMENTE em JSON, sem texto antes ou depois, no formato:
{
  "titulo": "...",
  "metaDescription": "... (150-160 caracteres)",
  "h2s": ["...", "...", "..."],
  "anguloEditorial": "..."
}`;

export interface ContentPlan {
  titulo: string;
  metaDescription: string;
  h2s: string[];
  anguloEditorial: string;
}

function normalize(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function fitTitle(title: string, keyword: string): string {
  const trimmed = title.trim();
  if (trimmed.length <= 70) return trimmed;
  if (normalize(trimmed).includes(normalize(keyword))) {
    const compact = `${keyword}: vale a pena migrar?`;
    if (compact.length >= 20 && compact.length <= 70) return compact;
  }
  throw new Error("O planejador gerou um título maior que 70 caracteres; tente executar novamente.");
}

export async function planTopic(ctx: WorkspaceContext, tema: string, palavraChaveAlvo: string, marketResearch: string): Promise<ContentPlan> {
  const raw = await runAgent(ctx, {
    system: SYSTEM_TEMPLATE(ctx),
    prompt: `Tema: "${tema}"
Palavra-chave principal: "${palavraChaveAlvo}"
O título deve ter entre 20 e 70 caracteres, contando espaços.

O título e a meta description devem conter a palavra-chave principal de forma natural.
Priorize a intenção de busca de quem precisa resolver esse problema e inclua H2s úteis para a decisão, não apenas definições.

Pesquisa de mercado:
${marketResearch}`,
    maxTokens: 2000,
  });
  const plan = extractJson<ContentPlan>(raw);
  return { ...plan, titulo: fitTitle(plan.titulo, palavraChaveAlvo) };
}
