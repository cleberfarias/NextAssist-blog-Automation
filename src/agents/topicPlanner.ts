import { runAgent, extractJson } from "../lib/anthropic.js";

const SYSTEM = `Você é o planejador editorial do blog do NextAssist. Com base no tema do
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

export async function planTopic(
  tema: string,
  palavraChaveAlvo: string,
  marketResearch: string,
): Promise<ContentPlan> {
  const raw = await runAgent({
    system: SYSTEM,
    prompt: `Tema: "${tema}"
Palavra-chave principal: "${palavraChaveAlvo}"

O título e a meta description devem conter a palavra-chave principal de forma natural.
Priorize a intenção de busca de um dono de assistência técnica que precisa resolver esse problema e inclua H2s úteis para a decisão, não apenas definições.

Pesquisa de mercado:
${marketResearch}`,
    // O plano precisa conter a meta description e vários H2s em JSON.
    // Com modelos mais verbosos, 1000 tokens pode truncar a resposta antes
    // do fechamento do objeto e causar "Unexpected end of JSON input".
    maxTokens: 2000,
  });
  return extractJson<ContentPlan>(raw);
}
