import { runAgent } from "../lib/anthropic.js";
import type { ContentPlan } from "./topicPlanner.js";

const SYSTEM = `Você é o redator do blog do NextAssist, um sistema de gestão para
assistências técnicas de celular no Brasil. Escreva em português do
Brasil, tom direto e prático, focado em dono de assistência técnica
solo ou com equipe pequena — sem jargão corporativo. Use exemplos
concretos com valores em reais quando fizer sentido. Mencione o
NextAssist de forma natural no meio ou no fim do texto (nunca como
propaganda forçada logo no início). Responda SOMENTE com o HTML do
corpo do artigo (tags <h2>, <p>, <ul>, <li>, <table> quando fizer
sentido) — sem <html>, <head> ou <body>, sem o título como <h1> (o
título já vai em outro campo).`;

export async function writeArticle(
  tema: string,
  plan: ContentPlan,
  marketResearch: string,
): Promise<string> {
  return runAgent({
    system: SYSTEM,
    prompt: `Tema: "${tema}"
Ângulo editorial: ${plan.anguloEditorial}
Estrutura de H2s a seguir: ${plan.h2s.join(" | ")}

Contexto de mercado (não copiar, só usar como referência):
${marketResearch}

Escreva o artigo completo em HTML seguindo essa estrutura.`,
    maxTokens: 4000,
  });
}
