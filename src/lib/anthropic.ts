import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config.js";

export const anthropic = new Anthropic({ apiKey: config.anthropicApiKey });

const MODEL = "claude-sonnet-5";

/**
 * Chama um "agente": um system prompt específico + uma pergunta/tarefa.
 * `useWebSearch` liga a tool de busca (usada pelos agentes de pesquisa).
 */
export async function runAgent(params: {
  system: string;
  prompt: string;
  useWebSearch?: boolean;
  maxTokens?: number;
}): Promise<string> {
  const { system, prompt, useWebSearch = false, maxTokens = 4000 } = params;

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    system,
    messages: [{ role: "user", content: prompt }],
    tools: useWebSearch
      ? [{ type: "web_search_20250305", name: "web_search" } as any]
      : undefined,
  });

  return response.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();
}

/** Extrai um bloco JSON da resposta do modelo, mesmo se vier com texto ao redor. */
export function extractJson<T>(text: string): T {
  const cleaned = text.replace(/```json|```/g, "").trim();
  const match = cleaned.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
  return JSON.parse(match ? match[0] : cleaned) as T;
}
