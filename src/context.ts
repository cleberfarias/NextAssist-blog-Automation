import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import type { MarketingWorkspace } from "./workspace.js";
import type { SecretProvider } from "./lib/secrets.js";
import { createNextAssistCmsProvider, type CmsProvider } from "./lib/cms.js";

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

interface UsageDelta {
  inputTokens?: number;
  outputTokens?: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
  webSearchRequests?: number;
}

export interface UsageTracker {
  get(): AnthropicUsage;
  addAnthropic(delta: UsageDelta): void;
  addOpenAi(delta: UsageDelta): void;
  incrementFallback(): void;
}

function estimateUsd(usage: Omit<AnthropicUsage, "estimatedUsd" | "provider" | "model" | "fallbackCount">): number {
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

/**
 * Substitui o `currentUsage` module-level de antes desta fase: cada execução
 * tem seu próprio tracker, criado dentro do WorkspaceContext, sem risco de
 * vazar uso/custo entre workspaces.
 */
function createUsageTracker(anthropicModel: string, openaiModel: string): UsageTracker {
  const state: AnthropicUsage = {
    model: anthropicModel,
    inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0, webSearchRequests: 0, estimatedUsd: 0, fallbackCount: 0,
  };

  function add(provider: "openai" | "anthropic", delta: UsageDelta) {
    state.provider = provider;
    state.model = provider === "openai" ? openaiModel : anthropicModel;
    state.inputTokens += delta.inputTokens ?? 0;
    state.outputTokens += delta.outputTokens ?? 0;
    state.cacheCreationInputTokens += delta.cacheCreationInputTokens ?? 0;
    state.cacheReadInputTokens += delta.cacheReadInputTokens ?? 0;
    state.webSearchRequests += delta.webSearchRequests ?? 0;
    state.estimatedUsd = estimateUsd(state);
  }

  return {
    get: () => ({ ...state }),
    addAnthropic: (delta) => add("anthropic", delta),
    addOpenAi: (delta) => add("openai", delta),
    incrementFallback: () => { state.fallbackCount = (state.fallbackCount ?? 0) + 1; },
  };
}

export interface WorkspacePaths {
  root: URL;
  calendar: URL;
  history: URL;
  runs: URL;
  performance: URL;
  conversions: URL;
}

export interface WorkspaceContext {
  workspace: MarketingWorkspace;
  secrets: SecretProvider;
  aiPrimaryProvider: "openai" | "anthropic";
  ai: { openai?: OpenAI; anthropic?: Anthropic };
  usage: UsageTracker;
  /** Nomes de modelo resolvidos para cada provider — usados por quem for chamar o provider ANTES da primeira request (ex: runAgent), já que ctx.usage só reflete o último provider usado. */
  models: { anthropic: string; openai: string };
  paths: WorkspacePaths;
  cms: CmsProvider;
  /** Login no CMS do NextAssist (Identity Toolkit) — injetado para publisher/CMS não importarem config.ts. */
  getIdToken: () => Promise<string>;
}

export interface BuildContextOptions {
  aiPrimaryProvider?: "openai" | "anthropic";
  anthropicModel?: string;
  openaiModel?: string;
  workspacesRoot?: URL;
  firebaseWebApiKeyOverride?: string; // usado nos testes de outras tasks
  /**
   * Quando `false`, não exige OPENAI_API_KEY/ANTHROPIC_API_KEY — usado pelas
   * rotas somente-leitura do painel, que só leem estado persistido e nunca
   * chamam `runAgent`. Padrão: `true`.
   */
  requireAiProvider?: boolean;
}

const DEFAULT_WORKSPACES_ROOT = new URL("../workspaces/", import.meta.url);

export async function buildWorkspaceContext(
  workspace: MarketingWorkspace,
  secrets: SecretProvider,
  options: BuildContextOptions = {},
): Promise<WorkspaceContext> {
  const [openaiKey, anthropicKey] = await Promise.all([
    secrets.get(workspace.id, "OPENAI_API_KEY"),
    secrets.get(workspace.id, "ANTHROPIC_API_KEY"),
  ]);
  if (!openaiKey && !anthropicKey && options.requireAiProvider !== false) {
    throw new Error(`Workspace "${workspace.id}": nenhum provider de IA configurado (OPENAI_API_KEY ou ANTHROPIC_API_KEY).`);
  }

  // Falha rápido se algum segredo declarado como obrigatório no workspace.json
  // estiver ausente — antes de gastar chamadas de IA em estágios posteriores.
  // As chaves de IA já têm a verificação dedicada acima.
  const aiKeys = new Set(["OPENAI_API_KEY", "ANTHROPIC_API_KEY"]);
  const requiredSecrets = (workspace.secrets?.required ?? []).filter((key) => !aiKeys.has(key));
  const resolvedRequired = await Promise.all(
    requiredSecrets.map(async (key) => ({ key, value: await secrets.get(workspace.id, key) })),
  );
  const missing = resolvedRequired.filter(({ value }) => !value).map(({ key }) => key);
  if (missing.length) {
    throw new Error(`Workspace "${workspace.id}": segredos obrigatórios ausentes: ${missing.join(", ")}`);
  }

  const aiPrimaryProvider = options.aiPrimaryProvider ?? (openaiKey ? "openai" : "anthropic");
  const anthropicModel = options.anthropicModel ?? "claude-sonnet-5";
  const openaiModel = options.openaiModel ?? "gpt-5.6";

  const root = new URL(`${workspace.id}/`, options.workspacesRoot ?? DEFAULT_WORKSPACES_ROOT);
  const paths: WorkspacePaths = {
    root,
    calendar: new URL("content-calendar.json", root),
    history: new URL("post-history.json", root),
    runs: new URL("runs-history.json", root),
    performance: new URL("post-performance.json", root),
    conversions: new URL("conversion-events.json", root),
  };

  const firebaseWebApiKey = options.firebaseWebApiKeyOverride ?? (await secrets.get(workspace.id, "FIREBASE_WEB_API_KEY"));
  const firebaseAdminEmail = await secrets.get(workspace.id, "FIREBASE_ADMIN_EMAIL");
  const firebaseAdminPassword = await secrets.get(workspace.id, "FIREBASE_ADMIN_PASSWORD");

  async function getIdToken(): Promise<string> {
    if (!firebaseWebApiKey || !firebaseAdminEmail || !firebaseAdminPassword) {
      throw new Error(`Workspace "${workspace.id}": credenciais do Firebase Auth ausentes (FIREBASE_WEB_API_KEY / FIREBASE_ADMIN_EMAIL / FIREBASE_ADMIN_PASSWORD).`);
    }
    const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${firebaseWebApiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: firebaseAdminEmail, password: firebaseAdminPassword, returnSecureToken: true }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => null);
      throw new Error(`Falha no login do Firebase Auth: ${err?.error?.message ?? res.statusText}`);
    }
    const data = (await res.json()) as { idToken: string };
    return data.idToken;
  }

  return {
    workspace,
    secrets,
    aiPrimaryProvider,
    ai: {
      openai: openaiKey ? new OpenAI({ apiKey: openaiKey }) : undefined,
      anthropic: anthropicKey ? new Anthropic({ apiKey: anthropicKey }) : undefined,
    },
    usage: createUsageTracker(anthropicModel, openaiModel),
    models: { anthropic: anthropicModel, openai: openaiModel },
    paths,
    cms: createNextAssistCmsProvider(workspace.integrations.cms.apiUrl, { getIdToken }),
    getIdToken,
  };
}
