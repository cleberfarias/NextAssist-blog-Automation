import { runAgent } from "../lib/anthropic.js";
import type { WorkspaceContext } from "../context.js";
import type { ContentPlan } from "./topicPlanner.js";

const SYSTEM_TEMPLATE = (ctx: WorkspaceContext) => `Você é o redator do blog do ${ctx.workspace.brand.name}, ${ctx.workspace.brand.description}
Escreva em português do Brasil. Tom de voz: ${ctx.workspace.brand.toneOfVoice}
Use exemplos concretos com valores em reais quando fizer sentido. Mencione o
${ctx.workspace.brand.name} de forma natural no meio ou no fim do texto (nunca como
propaganda forçada logo no início). Responda SOMENTE com o HTML do
corpo do artigo (tags <h2>, <p>, <ul>, <li>, <table> quando fizer
sentido) — sem <html>, <head> ou <body>, sem o título como <h1> (o
título já vai em outro campo).`;

export async function writeArticle(ctx: WorkspaceContext, tema: string, palavraChaveAlvo: string, plan: ContentPlan, marketResearch: string): Promise<string> {
  return runAgent(ctx, {
    system: SYSTEM_TEMPLATE(ctx),
    prompt: `Tema: "${tema}"
Palavra-chave principal: "${palavraChaveAlvo}" (use naturalmente na introdução e em pelo menos um H2; não repita de forma artificial)
Ângulo editorial: ${plan.anguloEditorial}
Estrutura de H2s a seguir: ${plan.h2s.join(" | ")}

Contexto de mercado (não copiar, só usar como referência):
${marketResearch}

Escreva o artigo completo em HTML seguindo essa estrutura.`,
    maxTokens: 4000,
  });
}
