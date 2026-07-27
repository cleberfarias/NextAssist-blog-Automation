import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config.js";

export const anthropic = new Anthropic({ apiKey: config.anthropicApiKey });

const MODEL = "claude-sonnet-5";

export interface AnthropicUsage {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  webSearchRequests: number;
  estimatedUsd: number;
}

let currentUsage: AnthropicUsage = emptyUsage();

function emptyUsage(): AnthropicUsage {
  return {
    model: MODEL,
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    webSearchRequests: 0,
    estimatedUsd: 0,
  };
}

function estimateUsd(usage: Omit<AnthropicUsage, "estimatedUsd">): number {
  const promotional = Date.now() < Date.UTC(2026, 8, 1);
  const inputPerMillion = promotional ? 2 : 3;
  const outputPerMillion = promotional ? 10 : 15;

  return (
    (usage.inputTokens / 1_000_000) * inputPerMillion +
    (usage.outputTokens / 1_000_000) * outputPerMillion +
    (usage.cacheCreationInputTokens / 1_000_000) * inputPerMillion * 1.25 +
    (usage.cacheReadInputTokens / 1_000_000) * inputPerMillion * 0.1 +
    usage.webSearchRequests * 0.01
  );
}

export function resetAnthropicUsage(): void {
  currentUsage = emptyUsage();
}

export function getAnthropicUsage(): AnthropicUsage {
  return { ...currentUsage };
}

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

  const usage = response.usage as typeof response.usage & {
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
    server_tool_use?: { web_search_requests?: number };
  };
  currentUsage.inputTokens += usage.input_tokens ?? 0;
  currentUsage.outputTokens += usage.output_tokens ?? 0;
  currentUsage.cacheCreationInputTokens += usage.cache_creation_input_tokens ?? 0;
  currentUsage.cacheReadInputTokens += usage.cache_read_input_tokens ?? 0;
  currentUsage.webSearchRequests += usage.server_tool_use?.web_search_requests ?? 0;
  currentUsage.estimatedUsd = estimateUsd(currentUsage);

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
