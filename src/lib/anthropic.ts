import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import type { WorkspaceContext } from "../context.js";
import { executeWithFallback } from "./providerFallback.js";

/**
 * Chama um "agente": um system prompt específico + uma pergunta/tarefa, no
 * provider primário do workspace (`ctx.aiPrimaryProvider`) com fallback
 * automático para o outro provider configurado. `useWebSearch` liga a tool
 * de busca (usada pelos agentes de pesquisa). Uso e custo são acumulados em
 * `ctx.usage` — nunca num singleton global.
 */
export async function runAgent(ctx: WorkspaceContext, params: {
  system: string;
  prompt: string;
  useWebSearch?: boolean;
  maxTokens?: number;
}): Promise<string> {
  const { system, prompt, useWebSearch = false, maxTokens = 4000 } = params;

  const providers = {
    openai: () => runOpenAi(ctx, system, prompt, useWebSearch, maxTokens),
    anthropic: () => runAnthropic(ctx, system, prompt, useWebSearch, maxTokens),
  };
  const primary = ctx.aiPrimaryProvider;
  const fallback = primary === "openai" ? "anthropic" : "openai";
  const fallbackAvailable = fallback === "openai" ? Boolean(ctx.ai.openai) : Boolean(ctx.ai.anthropic);

  const result = await executeWithFallback({
    primary: providers[primary],
    fallback: fallbackAvailable ? providers[fallback] : undefined,
  });
  if (result.usedFallback) ctx.usage.incrementFallback();
  return result.value;
}

async function runAnthropic(
  ctx: WorkspaceContext, system: string, prompt: string, useWebSearch: boolean, maxTokens: number,
): Promise<string> {
  if (!ctx.ai.anthropic) throw new Error(`Workspace "${ctx.workspace.id}": ANTHROPIC_API_KEY não configurada`);

  const response = await ctx.ai.anthropic.messages.create({
    model: ctx.models.anthropic,
    max_tokens: maxTokens,
    system,
    messages: [{ role: "user", content: prompt }],
    tools: useWebSearch ? [{ type: "web_search_20250305", name: "web_search" } as any] : undefined,
  });

  const usage = response.usage as typeof response.usage & {
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
    server_tool_use?: { web_search_requests?: number };
  };
  ctx.usage.addAnthropic({
    inputTokens: usage.input_tokens ?? 0,
    outputTokens: usage.output_tokens ?? 0,
    cacheCreationInputTokens: usage.cache_creation_input_tokens ?? 0,
    cacheReadInputTokens: usage.cache_read_input_tokens ?? 0,
    webSearchRequests: usage.server_tool_use?.web_search_requests ?? 0,
  });

  return response.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();
}

async function runOpenAi(
  ctx: WorkspaceContext, system: string, prompt: string, useWebSearch: boolean, maxTokens: number,
): Promise<string> {
  if (!ctx.ai.openai) throw new Error(`Workspace "${ctx.workspace.id}": OPENAI_API_KEY não configurada`);

  const response = await ctx.ai.openai.responses.create({
    model: ctx.models.openai,
    instructions: system,
    input: prompt,
    max_output_tokens: maxTokens,
    tools: useWebSearch ? [{ type: "web_search" }] : undefined,
  });
  const output = response.output as Array<{ type?: string }>;

  ctx.usage.addOpenAi({
    inputTokens: response.usage?.input_tokens ?? 0,
    outputTokens: response.usage?.output_tokens ?? 0,
    webSearchRequests: output.filter((item) => item.type === "web_search_call").length,
  });

  return response.output_text.trim();
}

/** Extrai um bloco JSON da resposta do modelo, mesmo se vier com texto ao redor. */
export function extractJson<T>(text: string): T {
  const cleaned = text.replace(/```json|```/g, "").trim();
  const match = cleaned.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
  const candidate = match ? match[0] : cleaned;
  try {
    return JSON.parse(candidate) as T;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Resposta JSON inválida ou truncada (${detail}). Tamanho recebido: ${candidate.length} caracteres.`);
  }
}
