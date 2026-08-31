import { readFile, readdir } from "node:fs/promises";

export interface MarketingWorkspace {
  id: string;
  name: string;
  active: boolean;
  brand: {
    name: string;
    description: string;
    toneOfVoice: string;
    targetAudience: string[];
    competitors: string[];
    forbiddenTerms?: string[];
    valuePropositions?: string[];
    /** Fragmentos de caminho que o HTML final precisa linkar (ex: ["/#funcionalidades"]). */
    requiredLinks?: string[];
  };
  goals: {
    primary: "leads" | "traffic" | "brand" | "sales";
    monthlyLeadTarget?: number;
    monthlyTrafficTarget?: number;
  };
  channels: {
    blog: boolean;
    instagram: boolean;
    linkedin: boolean;
  };
  integrations: {
    siteUrl: string;
    cms: { provider: "nextassist"; apiUrl: string };
    searchConsole?: { siteUrl: string; sitemapUrl: string };
    instagram?: { apiVersion: string };
  };
  autonomy: {
    mode: "copilot" | "semi-autonomous" | "autonomous";
  };
  aiFallbackProvider?: "openai" | "anthropic" | "none";
  contentStrategy?: {
    minimumPendingTopics: number;
    replenishAmount: number;
  };
  instagramStrategy?: { frequencyPerWeek: number; pillars: string[]; preferredFormats: string[] };
  secrets: {
    required: string[];
    optional?: string[];
  };
}

const DEFAULT_ROOT = new URL("../workspaces/", import.meta.url);

const GOALS_PRIMARY = new Set(["leads", "traffic", "brand", "sales"]);
const AUTONOMY_MODES = new Set(["copilot", "semi-autonomous", "autonomous"]);

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

/**
 * Validação de schema em runtime pro `workspace.json` — é uma peça
 * estrutural do produto (config de agentes, credenciais exigidas,
 * integrações), então um arquivo malformado precisa falhar aqui, com um
 * erro apontando exatamente o campo problemático, em vez de quebrar mais
 * tarde no meio do pipeline com um erro genérico de `undefined`.
 */
function validateWorkspaceShape(id: string, value: unknown): MarketingWorkspace {
  const fail = (detail: string): never => {
    throw new Error(`workspace.json de "${id}" é inválido: ${detail}`);
  };
  const requireObject = (v: unknown, path: string): Record<string, unknown> => {
    if (typeof v !== "object" || v === null) fail(`"${path}" precisa ser objeto`);
    return v as Record<string, unknown>;
  };
  const requireString = (v: unknown, path: string): string => {
    if (typeof v !== "string") fail(`"${path}" precisa ser string`);
    return v as string;
  };
  const requireBoolean = (v: unknown, path: string): boolean => {
    if (typeof v !== "boolean") fail(`"${path}" precisa ser boolean`);
    return v as boolean;
  };
  const requireStringArray = (v: unknown, path: string): string[] => {
    if (!isStringArray(v)) fail(`"${path}" precisa ser array de strings`);
    return v as string[];
  };
  const requireEnum = <T extends string>(v: unknown, path: string, allowed: Set<T>): T => {
    if (typeof v !== "string" || !allowed.has(v as T)) fail(`"${path}" precisa ser um de: ${[...allowed].join(", ")}`);
    return v as T;
  };
  const requirePositiveInteger = (v: unknown, path: string): number => {
    if (typeof v !== "number" || !Number.isInteger(v) || v <= 0) fail(`"${path}" precisa ser um inteiro positivo`);
    return v as number;
  };

  const w = requireObject(value, "(raiz)");

  requireString(w.id, "id");
  requireString(w.name, "name");
  requireBoolean(w.active, "active");

  const brandRaw = requireObject(w.brand, "brand");
  requireString(brandRaw.name, "brand.name");
  requireString(brandRaw.description, "brand.description");
  requireString(brandRaw.toneOfVoice, "brand.toneOfVoice");
  requireStringArray(brandRaw.targetAudience, "brand.targetAudience");
  requireStringArray(brandRaw.competitors, "brand.competitors");
  if (brandRaw.requiredLinks !== undefined) requireStringArray(brandRaw.requiredLinks, "brand.requiredLinks");

  const goalsRaw = requireObject(w.goals, "goals");
  requireEnum(goalsRaw.primary, "goals.primary", GOALS_PRIMARY);

  const channelsRaw = requireObject(w.channels, "channels");
  for (const key of ["blog", "instagram", "linkedin"]) requireBoolean(channelsRaw[key], `channels.${key}`);

  const integrationsRaw = requireObject(w.integrations, "integrations");
  requireString(integrationsRaw.siteUrl, "integrations.siteUrl");
  const cmsRaw = requireObject(integrationsRaw.cms, "integrations.cms");
  if (cmsRaw.provider !== "nextassist") fail('"integrations.cms.provider" precisa ser "nextassist"');
  requireString(cmsRaw.apiUrl, "integrations.cms.apiUrl");

  const autonomyRaw = requireObject(w.autonomy, "autonomy");
  requireEnum(autonomyRaw.mode, "autonomy.mode", AUTONOMY_MODES);
  if (w.aiFallbackProvider !== undefined) requireEnum(w.aiFallbackProvider, "aiFallbackProvider", new Set(["openai", "anthropic", "none"]));

  if (w.contentStrategy !== undefined) {
    const contentStrategyRaw = requireObject(w.contentStrategy, "contentStrategy");
    requirePositiveInteger(contentStrategyRaw.minimumPendingTopics, "contentStrategy.minimumPendingTopics");
    requirePositiveInteger(contentStrategyRaw.replenishAmount, "contentStrategy.replenishAmount");
  }
  if (w.instagramStrategy !== undefined) {
    const instagramRaw = requireObject(w.instagramStrategy, "instagramStrategy");
    requirePositiveInteger(instagramRaw.frequencyPerWeek, "instagramStrategy.frequencyPerWeek");
    requireStringArray(instagramRaw.pillars, "instagramStrategy.pillars");
    requireStringArray(instagramRaw.preferredFormats, "instagramStrategy.preferredFormats");
  }

  const secretsRaw = requireObject(w.secrets, "secrets");
  requireStringArray(secretsRaw.required, "secrets.required");
  if (secretsRaw.optional !== undefined) requireStringArray(secretsRaw.optional, "secrets.optional");

  return value as MarketingWorkspace;
}

/** Carrega um workspace pelo id (nome da pasta em `workspaces/`). */
export async function loadWorkspace(id: string, root: URL = DEFAULT_ROOT): Promise<MarketingWorkspace> {
  const fileUrl = new URL(`${id}/workspace.json`, root);
  let raw: string;
  try {
    raw = await readFile(fileUrl, "utf-8");
  } catch {
    throw new Error(`Workspace "${id}" não encontrado (esperado em workspaces/${id}/workspace.json).`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`workspace.json de "${id}" não é um JSON válido: ${detail}`);
  }
  const workspace = validateWorkspaceShape(id, parsed);
  if (workspace.id !== id) {
    throw new Error(`workspace.json de "${id}" declara id "${workspace.id}" — precisa bater com o nome da pasta.`);
  }
  return workspace;
}

/**
 * Lista todos os workspaces ativos cadastrados em `workspaces/`. Um
 * workspace que falha ao carregar (JSON inválido, campo obrigatório
 * ausente, id não encontrado) é OMITIDO da lista, não trava o painel —
 * mas o erro é logado, para não desaparecer silenciosamente: um workspace
 * mal configurado deve ser visível nos logs, não só "sumir" da lista.
 */
export async function listWorkspaces(root: URL = DEFAULT_ROOT): Promise<MarketingWorkspace[]> {
  let entries: string[];
  try {
    entries = await readdir(root);
  } catch {
    return [];
  }
  const loaded = await Promise.all(
    entries.map(async (id) => {
      try {
        return await loadWorkspace(id, root);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`listWorkspaces: ignorando "${id}" — ${message}`);
        return null;
      }
    }),
  );
  return loaded.filter((w): w is MarketingWorkspace => w !== null && w.active);
}
