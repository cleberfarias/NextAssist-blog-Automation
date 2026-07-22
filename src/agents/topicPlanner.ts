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
  marketResearch: string,
): Promise<ContentPlan> {
  const raw = await runAgent({
    system: SYSTEM,
    prompt: `Tema: "${tema}"\n\nPesquisa de mercado:\n${marketResearch}`,
    maxTokens: 1000,
  });
  return extractJson<ContentPlan>(raw);
}
