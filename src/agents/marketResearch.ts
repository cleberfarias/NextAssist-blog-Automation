import { runAgent } from "../lib/anthropic.js";
import type { WorkspaceContext } from "../context.js";

const SYSTEM_TEMPLATE = (ctx: WorkspaceContext) => `Você é um analista de SEO e mercado para o ${ctx.workspace.brand.name}, ${ctx.workspace.brand.description}
Sua função é levantar, via busca na web, o que os concorrentes diretos (ex: ${ctx.workspace.brand.competitors.join(", ")}) publicaram recentemente sobre o tema dado, e
quais ângulos, dados ou exemplos eles usaram que valem a pena considerar
(sem copiar). Seja objetivo e cite fatos concretos encontrados na busca.`;

export async function researchMarket(ctx: WorkspaceContext, tema: string): Promise<string> {
  return runAgent(ctx, {
    system: SYSTEM_TEMPLATE(ctx),
    prompt: `Tema de hoje: "${tema}". Pesquise o que já existe publicado sobre
esse tema por concorrentes do ${ctx.workspace.brand.name} e resuma em até 6 bullets os
pontos mais relevantes (dados, exemplos, ângulos, o que está faltando
na cobertura atual do mercado).`,
    useWebSearch: true,
    maxTokens: 1500,
  });
}
