import { runAgent } from "../lib/anthropic.js";

const SYSTEM = `Você é um analista de SEO e mercado para o NextAssist, um sistema de
gestão para assistências técnicas de celular no Brasil. Sua função é
levantar, via busca na web, o que os concorrentes diretos (ex: AnaDita,
MarkupEmpresa, GestãoClick) publicaram recentemente sobre o tema dado, e
quais ângulos, dados ou exemplos eles usaram que valem a pena considerar
(sem copiar). Seja objetivo e cite fatos concretos encontrados na busca.`;

export async function researchMarket(tema: string): Promise<string> {
  return runAgent({
    system: SYSTEM,
    prompt: `Tema de hoje: "${tema}". Pesquise o que já existe publicado sobre
esse tema por concorrentes do NextAssist e resuma em até 6 bullets os
pontos mais relevantes (dados, exemplos, ângulos, o que está faltando
na cobertura atual do mercado).`,
    useWebSearch: true,
    maxTokens: 1500,
  });
}
