import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { config } from "../config.js";
import { executeWithFallback } from "./providerFallback.js";

const anthropic = config.anthropicApiKey
  ? new Anthropic({ apiKey: config.anthropicApiKey })
  : null;
const openai = config.openaiApiKey
  ? new OpenAI({ apiKey: config.openaiApiKey })
  : null;

export interface AnthropicUsage {
  provider?: "openai" | "anthropic";
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  webSearchRequests: number;
  estimatedUsd: number;
  fallbackCount?: number;
}

let currentUsage: AnthropicUsage = emptyUsage();

function emptyUsage(): AnthropicUsage {
  return {
    provider: config.aiPrimaryProvider,
    model: config.aiPrimaryProvider === "openai"
      ? config.openaiModel
      : config.anthropicModel,
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    webSearchRequests: 0,
    estimatedUsd: 0,
    fallbackCount: 0,
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

  const providers = {
    openai: () => runOpenAi(system, prompt, useWebSearch, maxTokens),
    anthropic: () => runAnthropic(system, prompt, useWebSearch, maxTokens),
  };
  const primary = config.aiPrimaryProvider;
  const fallback = primary === "openai" ? "anthropic" : "openai";
  const fallbackAvailable = fallback === "openai" ? Boolean(openai) : Boolean(anthropic);

  const result = await executeWithFallback({
    primary: providers[primary],
    fallback: fallbackAvailable ? providers[fallback] : undefined,
  });
  if (result.usedFallback) {
    currentUsage.fallbackCount = (currentUsage.fallbackCount ?? 0) + 1;
  }
  return result.value;
}

async function runAnthropic(
  system: string,
  prompt: string,
  useWebSearch: boolean,
  maxTokens: number,
): Promise<string> {
  if (!anthropic) throw new Error("ANTHROPIC_API_KEY não configurada");

  const response = await anthropic.messages.create({
    model: config.anthropicModel,
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
  currentUsage.provider = "anthropic";
  currentUsage.model = config.anthropicModel;
  currentUsage.estimatedUsd = estimateUsd(currentUsage);

  return response.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();
}

async function runOpenAi(
  system: string,
  prompt: string,
  useWebSearch: boolean,
  maxTokens: number,
): Promise<string> {
  if (!openai) throw new Error("OPENAI_API_KEY não configurada");

  const response = await openai.responses.create({
    model: config.openaiModel,
    instructions: system,
    input: prompt,
    max_output_tokens: maxTokens,
    tools: useWebSearch ? [{ type: "web_search" }] : undefined,
  });
  const output = response.output as Array<{ type?: string }>;

  currentUsage.inputTokens += response.usage?.input_tokens ?? 0;
  currentUsage.outputTokens += response.usage?.output_tokens ?? 0;
  currentUsage.webSearchRequests += output.filter((item) => item.type === "web_search_call").length;
  currentUsage.provider = "openai";
  currentUsage.model = config.openaiModel;

  return response.output_text.trim();
}

/** Extrai um bloco JSON da resposta do modelo, mesmo se vier com texto ao redor. */
export function extractJson<T>(text: string): T {
  const cleaned = text.replace(/```json|```/g, "").trim();
  const match = cleaned.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
  return JSON.parse(match ? match[0] : cleaned) as T;
}
