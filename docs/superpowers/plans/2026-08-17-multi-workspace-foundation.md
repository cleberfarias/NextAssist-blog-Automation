# Multi-workspace Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the NextAssist hardcode from the pipeline, persistence, and dashboard, replacing it with a `Workspace` entity so the system can run N independently-configured clients, starting with NextAssist migrated as the first workspace.

**Architecture:** Two runtime shapes resolve a workspace differently: the pipeline (`tsx src/index.ts`, short-lived, run by the GitHub Action) resolves **one** workspace at process start and threads a `WorkspaceContext` explicitly through every agent/lib call — no global singletons. The dashboard (`src/server.ts`, long-lived) resolves the workspace **per HTTP request** from a `?workspace=` query param, keyed into a `Map<workspaceId, WorkspaceRuntimeState>`. After this plan, no file under `src/agents/` or `src/lib/` imports `config.ts` — `config.ts` only holds app-level settings (`PORT`, `DATA_SOURCE`, `GITHUB_REPO`, etc.), never client-specific values.

**Tech Stack:** TypeScript (ESM, `tsx` runner), Node's built-in `node:test`, Express, `@anthropic-ai/sdk`, `openai`.

**Spec:** [docs/superpowers/specs/2026-08-17-multi-workspace-foundation-design.md](../specs/2026-08-17-multi-workspace-foundation-design.md)

## Global Constraints

- No agent (`src/agents/*.ts`) or lib (`src/lib/*.ts`) imports `config.ts` after this plan — everything client-specific flows through the `WorkspaceContext` parameter.
- Internal imports use explicit `.js` extensions in `.ts` source (existing ESM convention) — every new/edited import follows this.
- No ESLint/Prettier is configured — match the exact style of the file being edited.
- Every persisted state field lives under `workspaces/<id>/`, never at the repo root, after this plan.
- `npm test` must stay green after every task.
- Secrets are declared by name in `workspace.json` (`secrets.required` / `secrets.optional`), never stored by value in any versioned file.

---

### Task 1: `Workspace` entity — `src/workspace.ts`

**Files:**
- Create: `src/workspace.ts`
- Test: `src/workspace.test.ts`
- Modify: `src/tests.ts` (register the new test file)

**Interfaces:**
- Produces: `interface MarketingWorkspace { id, name, active, brand, goals, channels, integrations, autonomy, secrets }`; `loadWorkspace(id: string, root?: URL): Promise<MarketingWorkspace>`; `listWorkspaces(root?: URL): Promise<MarketingWorkspace[]>` (returns only `active: true` workspaces).

- [ ] **Step 1: Write the failing test**

```ts
// src/workspace.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { loadWorkspace, listWorkspaces } from "./workspace.js";

async function makeFixtureRoot(workspaces: Record<string, object | null>): Promise<URL> {
  const dir = await mkdtemp(path.join(tmpdir(), "workspaces-"));
  for (const [id, contents] of Object.entries(workspaces)) {
    const wsDir = path.join(dir, id);
    await mkdir(wsDir, { recursive: true });
    if (contents) {
      await writeFile(path.join(wsDir, "workspace.json"), JSON.stringify(contents, null, 2));
    }
  }
  return pathToFileURL(dir + path.sep);
}

const baseWorkspace = {
  id: "acme",
  name: "Acme Inc",
  active: true,
  brand: { name: "Acme", description: "d", toneOfVoice: "t", targetAudience: [], competitors: [] },
  goals: { primary: "leads" },
  channels: { blog: true, instagram: false, linkedin: false },
  integrations: { siteUrl: "https://acme.test", cms: { provider: "nextassist", apiUrl: "https://api.acme.test" } },
  autonomy: { mode: "copilot" },
  secrets: { required: ["OPENAI_API_KEY"] },
};

test("loadWorkspace lê e valida o workspace.json pelo id da pasta", async () => {
  const root = await makeFixtureRoot({ acme: baseWorkspace });
  const workspace = await loadWorkspace("acme", root);
  assert.equal(workspace.name, "Acme Inc");
  assert.deepEqual(workspace.secrets.required, ["OPENAI_API_KEY"]);
});

test("loadWorkspace lança erro claro se o workspace não existe", async () => {
  const root = await makeFixtureRoot({});
  await assert.rejects(() => loadWorkspace("ghost", root), /não encontrado/);
});

test("loadWorkspace lança erro se o id do arquivo não bate com a pasta", async () => {
  const root = await makeFixtureRoot({ acme: { ...baseWorkspace, id: "outro-id" } });
  await assert.rejects(() => loadWorkspace("acme", root), /precisa bater/);
});

test("listWorkspaces devolve só os workspaces ativos", async () => {
  const root = await makeFixtureRoot({
    acme: baseWorkspace,
    inactive: { ...baseWorkspace, id: "inactive", active: false },
  });
  const workspaces = await listWorkspaces(root);
  assert.deepEqual(workspaces.map((w) => w.id), ["acme"]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test src/workspace.test.ts`
Expected: FAIL with "Cannot find module './workspace.js'"

- [ ] **Step 3: Write the implementation**

```ts
// src/workspace.ts
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
    instagram?: { userId: string; apiVersion: string };
  };
  autonomy: {
    mode: "copilot" | "semi-autonomous" | "autonomous";
  };
  secrets: {
    required: string[];
    optional?: string[];
  };
}

const DEFAULT_ROOT = new URL("../workspaces/", import.meta.url);

/** Carrega um workspace pelo id (nome da pasta em `workspaces/`). */
export async function loadWorkspace(id: string, root: URL = DEFAULT_ROOT): Promise<MarketingWorkspace> {
  const fileUrl = new URL(`${id}/workspace.json`, root);
  let raw: string;
  try {
    raw = await readFile(fileUrl, "utf-8");
  } catch {
    throw new Error(`Workspace "${id}" não encontrado (esperado em workspaces/${id}/workspace.json).`);
  }
  const workspace = JSON.parse(raw) as MarketingWorkspace;
  if (workspace.id !== id) {
    throw new Error(`workspace.json de "${id}" declara id "${workspace.id}" — precisa bater com o nome da pasta.`);
  }
  return workspace;
}

/** Lista todos os workspaces ativos cadastrados em `workspaces/`. */
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
      } catch {
        return null;
      }
    }),
  );
  return loaded.filter((w): w is MarketingWorkspace => w !== null && w.active);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test src/workspace.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Register the test file and commit**

Add `import "./workspace.test.js";` to `src/tests.ts`.

```bash
git add src/workspace.ts src/workspace.test.ts src/tests.ts
git commit -m "feat: adiciona entidade Workspace (loadWorkspace/listWorkspaces)"
```

---

### Task 2: `SecretProvider` — `src/lib/secrets.ts`

**Files:**
- Create: `src/lib/secrets.ts`
- Test: `src/lib/secrets.test.ts`
- Modify: `src/tests.ts`

**Interfaces:**
- Produces: `interface SecretProvider { get(workspaceId: string, key: string): Promise<string | undefined> }`; `class EnvSecretProvider implements SecretProvider`.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/secrets.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import { EnvSecretProvider } from "./secrets.js";

test("resolve a variável prefixada pelo workspace quando existir", async () => {
  process.env.ACME_ANTHROPIC_API_KEY = "prefixed-value";
  process.env.ANTHROPIC_API_KEY = "unprefixed-value";
  try {
    const provider = new EnvSecretProvider();
    assert.equal(await provider.get("acme", "ANTHROPIC_API_KEY"), "prefixed-value");
  } finally {
    delete process.env.ACME_ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
  }
});

test("cai para a variável sem prefixo quando a prefixada não existe", async () => {
  process.env.OPENAI_API_KEY = "fallback-value";
  try {
    const provider = new EnvSecretProvider();
    assert.equal(await provider.get("acme", "OPENAI_API_KEY"), "fallback-value");
  } finally {
    delete process.env.OPENAI_API_KEY;
  }
});

test("devolve undefined quando nenhuma das duas existe", async () => {
  const provider = new EnvSecretProvider();
  assert.equal(await provider.get("acme", "MISSING_KEY"), undefined);
});

test("normaliza hífen no id do workspace para o prefixo", async () => {
  process.env.WORKSPACE_CHATGURU_IG_ACCESS_TOKEN = "token-value";
  try {
    const provider = new EnvSecretProvider();
    assert.equal(await provider.get("workspace-chatguru", "IG_ACCESS_TOKEN"), "token-value");
  } finally {
    delete process.env.WORKSPACE_CHATGURU_IG_ACCESS_TOKEN;
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test src/lib/secrets.test.ts`
Expected: FAIL with "Cannot find module './secrets.js'"

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/secrets.ts

/** Resolve segredos (valores) por workspace. Nunca armazena, só lê. */
export interface SecretProvider {
  get(workspaceId: string, key: string): Promise<string | undefined>;
}

/**
 * Implementação inicial: variáveis de ambiente, prefixadas pelo id do
 * workspace (ex: `ACME_ANTHROPIC_API_KEY`), com fallback para a variável sem
 * prefixo — cobre o caso de um único workspace configurado localmente
 * (`.env`) sem precisar prefixar nada. Trocar por Secret Manager no futuro é
 * só uma nova implementação desta mesma interface.
 */
export class EnvSecretProvider implements SecretProvider {
  async get(workspaceId: string, key: string): Promise<string | undefined> {
    const prefix = workspaceId.toUpperCase().replace(/-/g, "_");
    return process.env[`${prefix}_${key}`] ?? process.env[key];
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test src/lib/secrets.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Register the test file and commit**

Add `import "./lib/secrets.test.js";` to `src/tests.ts`.

```bash
git add src/lib/secrets.ts src/lib/secrets.test.ts src/tests.ts
git commit -m "feat: adiciona SecretProvider (EnvSecretProvider)"
```

---

### Task 3: CMS abstraction — `src/lib/cms.ts`

**Files:**
- Create: `src/lib/cms.ts`
- Test: `src/lib/cms.test.ts`
- Modify: `src/tests.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `interface CreatePostInput { titulo, slug, resumo, conteudo, imagemCapa, autor, tags, publicado, metaTitle, metaDescription }`; `interface PostResult { id, slug }`; `interface CmsProvider { createPost(input: CreatePostInput): Promise<PostResult> }`; `function createNextAssistCmsProvider(apiUrl: string): CmsProvider`.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/cms.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import { createNextAssistCmsProvider } from "./cms.js";

test("createPost faz POST em <apiUrl>/blog/admin/posts com o idToken e devolve slug/id", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fakeFetch: typeof fetch = async (url, init) => {
    calls.push({ url: String(url), init: init! });
    return new Response(JSON.stringify({ data: { id: "abc123", slug: "meu-post" } }), { status: 200 });
  };

  const cms = createNextAssistCmsProvider("https://api.test", { fetchImpl: fakeFetch, getIdToken: async () => "token-xyz" });
  const result = await cms.createPost({
    titulo: "T", slug: "meu-post", resumo: "R", conteudo: "<p>c</p>",
    imagemCapa: "https://img.test/x.jpg", autor: "Acme", tags: ["a"],
    publicado: true, metaTitle: "MT", metaDescription: "MD",
  });

  assert.deepEqual(result, { id: "abc123", slug: "meu-post" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.test/blog/admin/posts");
  assert.equal((calls[0].init.headers as Record<string, string>).Authorization, "Bearer token-xyz");
});

test("createPost lança erro com a mensagem da API quando a resposta não é ok", async () => {
  const fakeFetch: typeof fetch = async () =>
    new Response(JSON.stringify({ error: { message: "slug duplicado" } }), { status: 409 });
  const cms = createNextAssistCmsProvider("https://api.test", { fetchImpl: fakeFetch, getIdToken: async () => "t" });

  await assert.rejects(
    () => cms.createPost({
      titulo: "T", slug: "s", resumo: "R", conteudo: "c", imagemCapa: "i",
      autor: "A", tags: [], publicado: true, metaTitle: "MT", metaDescription: "MD",
    }),
    /slug duplicado/,
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test src/lib/cms.test.ts`
Expected: FAIL with "Cannot find module './cms.js'"

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/cms.ts

export interface CreatePostInput {
  titulo: string;
  slug: string;
  resumo: string;
  conteudo: string;
  imagemCapa: string;
  autor: string;
  tags: string[];
  publicado: boolean;
  metaTitle: string;
  metaDescription: string;
}

export interface PostResult {
  id: string;
  slug: string;
}

/** Abstração de CMS: cada provider (NextAssist, WordPress, ...) implementa isto. */
export interface CmsProvider {
  createPost(input: CreatePostInput): Promise<PostResult>;
}

interface NextAssistCmsOptions {
  fetchImpl?: typeof fetch;
  getIdToken: () => Promise<string>;
}

/**
 * Único provider implementado nesta fase: publica no CMS próprio do
 * NextAssist. `getIdToken` é injetado (em vez de importado direto de
 * `firebaseAuth.ts`) para manter este módulo sem dependência de `config.ts`.
 */
export function createNextAssistCmsProvider(apiUrl: string, options: NextAssistCmsOptions): CmsProvider {
  const fetchImpl = options.fetchImpl ?? fetch;
  return {
    async createPost(input: CreatePostInput): Promise<PostResult> {
      const idToken = await options.getIdToken();
      const res = await fetchImpl(`${apiUrl}/blog/admin/posts`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify(input),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(`Falha ao publicar post: ${err?.error?.message ?? res.statusText}`);
      }

      const data = (await res.json()) as { data: { id: string; slug: string } };
      return { id: data.data.id, slug: data.data.slug };
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test src/lib/cms.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Register the test file and commit**

Add `import "./lib/cms.test.js";` to `src/tests.ts`.

```bash
git add src/lib/cms.ts src/lib/cms.test.ts src/tests.ts
git commit -m "feat: adiciona abstracao CmsProvider (NextAssistCmsProvider)"
```

---

### Task 4: `WorkspaceContext` — `src/context.ts`

**Files:**
- Create: `src/context.ts`
- Test: `src/context.test.ts`
- Modify: `src/tests.ts`

**Interfaces:**
- Consumes: `MarketingWorkspace` (Task 1, `src/workspace.js`), `SecretProvider` (Task 2, `src/lib/secrets.js`), `CmsProvider`/`createNextAssistCmsProvider` (Task 3, `src/lib/cms.js`).
- Produces: `interface AnthropicUsage { provider?, model, inputTokens, outputTokens, cacheCreationInputTokens, cacheReadInputTokens, webSearchRequests, estimatedUsd, fallbackCount? }`; `interface UsageTracker { get(): AnthropicUsage; addAnthropic(delta): void; addOpenAi(delta): void; incrementFallback(): void }`; `interface WorkspacePaths { root, calendar, history, runs, performance, conversions }` (all `URL`); `interface WorkspaceContext { workspace, secrets, aiPrimaryProvider, ai: { openai?, anthropic? }, usage, paths, cms, getIdToken() }`; `buildWorkspaceContext(workspace, secrets, options?): Promise<WorkspaceContext>`.

- [ ] **Step 1: Write the failing test**

```ts
// src/context.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import { buildWorkspaceContext } from "./context.js";
import type { MarketingWorkspace } from "./workspace.js";
import type { SecretProvider } from "./lib/secrets.js";

const workspace: MarketingWorkspace = {
  id: "acme", name: "Acme", active: true,
  brand: { name: "Acme", description: "d", toneOfVoice: "t", targetAudience: [], competitors: [] },
  goals: { primary: "leads" },
  channels: { blog: true, instagram: false, linkedin: false },
  integrations: { siteUrl: "https://acme.test", cms: { provider: "nextassist", apiUrl: "https://api.acme.test" } },
  autonomy: { mode: "copilot" },
  secrets: { required: ["OPENAI_API_KEY"] },
};

function fakeSecrets(values: Record<string, string>): SecretProvider {
  return { async get(_workspaceId, key) { return values[key]; } };
}

test("monta clientes de IA só para os providers com chave disponível", async () => {
  const ctx = await buildWorkspaceContext(workspace, fakeSecrets({ OPENAI_API_KEY: "sk-openai" }));
  assert.ok(ctx.ai.openai);
  assert.equal(ctx.ai.anthropic, undefined);
  assert.equal(ctx.aiPrimaryProvider, "openai");
});

test("paths ficam sob workspaces/<id>/", async () => {
  const ctx = await buildWorkspaceContext(workspace, fakeSecrets({ OPENAI_API_KEY: "sk" }));
  assert.ok(ctx.paths.calendar.pathname.endsWith("/workspaces/acme/content-calendar.json"));
  assert.ok(ctx.paths.performance.pathname.endsWith("/workspaces/acme/post-performance.json"));
});

test("usage tracker acumula tokens e calcula estimatedUsd", async () => {
  const ctx = await buildWorkspaceContext(workspace, fakeSecrets({ OPENAI_API_KEY: "sk" }));
  ctx.usage.addOpenAi({ inputTokens: 1000, outputTokens: 500 });
  const usage = ctx.usage.get();
  assert.equal(usage.inputTokens, 1000);
  assert.equal(usage.outputTokens, 500);
  assert.equal(usage.provider, "openai");
});

test("lança erro claro quando nenhum provider de IA tem chave configurada", async () => {
  await assert.rejects(
    () => buildWorkspaceContext(workspace, fakeSecrets({})),
    /nenhum provider de IA configurado/i,
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test src/context.test.ts`
Expected: FAIL with "Cannot find module './context.js'"

- [ ] **Step 3: Write the implementation**

```ts
// src/context.ts
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
  if (!openaiKey && !anthropicKey) {
    throw new Error(`Workspace "${workspace.id}": nenhum provider de IA configurado (OPENAI_API_KEY ou ANTHROPIC_API_KEY).`);
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
    paths,
    cms: createNextAssistCmsProvider(workspace.integrations.cms.apiUrl, { getIdToken }),
    getIdToken,
  };
}
```

Note: this replaces `src/lib/firebaseAuth.ts`'s `getBlogAdminIdToken()` — Task 8 removes that file and repoints its one other caller (`src/scripts/update-post-seo.ts`) at `ctx.getIdToken()`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test src/context.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Register the test file and commit**

Add `import "./context.test.js";` to `src/tests.ts`.

```bash
git add src/context.ts src/context.test.ts src/tests.ts
git commit -m "feat: adiciona WorkspaceContext (buildWorkspaceContext)"
```

---

### Task 5: Migrate NextAssist into `workspaces/nextassist/`

**Files:**
- Create: `workspaces/nextassist/workspace.json`
- Modify (move): `content-calendar.json` → `workspaces/nextassist/content-calendar.json`
- Modify (move): `post-history.json` → `workspaces/nextassist/post-history.json`
- Modify (move): `runs-history.json` → `workspaces/nextassist/runs-history.json`
- Modify (move): `post-performance.json` → `workspaces/nextassist/post-performance.json`
- Modify (move): `conversion-events.json` → `workspaces/nextassist/conversion-events.json` (this file isn't named in the spec's 4-file list, but `src/conversions.ts` persists it the same way at repo root — leaving it behind would be an inconsistency the spec didn't intend to introduce)

**Interfaces:**
- Consumes: `MarketingWorkspace` shape from Task 1.

- [ ] **Step 1: Move the state files, preserving git history**

```bash
mkdir -p workspaces/nextassist
git mv content-calendar.json workspaces/nextassist/content-calendar.json
git mv post-history.json workspaces/nextassist/post-history.json
git mv runs-history.json workspaces/nextassist/runs-history.json
git mv post-performance.json workspaces/nextassist/post-performance.json
if [ -f conversion-events.json ]; then git mv conversion-events.json workspaces/nextassist/conversion-events.json; fi
```

- [ ] **Step 2: Write `workspaces/nextassist/workspace.json`**

Values below are taken from the current hardcoded `src/config.ts` and the system prompts in `src/agents/*.ts` (competitors from `marketResearch.ts`, tone from `writer.ts`).

```json
{
  "id": "nextassist",
  "name": "NextAssist",
  "active": true,
  "brand": {
    "name": "NextAssist",
    "description": "Sistema de gestão para assistências técnicas de celular no Brasil.",
    "toneOfVoice": "Direto e prático, focado em dono de assistência técnica solo ou com equipe pequena — sem jargão corporativo.",
    "targetAudience": ["donos de assistência técnica de celular", "gestores de pequenas equipes de conserto"],
    "competitors": ["AnaDita", "MarkupEmpresa", "GestãoClick"]
  },
  "goals": {
    "primary": "leads"
  },
  "channels": {
    "blog": true,
    "instagram": true,
    "linkedin": false
  },
  "integrations": {
    "siteUrl": "https://www.nextassist-app.com.br",
    "cms": {
      "provider": "nextassist",
      "apiUrl": "https://rr-infocell-api-91248386036.southamerica-east1.run.app"
    },
    "searchConsole": {
      "siteUrl": "sc-domain:nextassist-app.com.br",
      "sitemapUrl": "https://www.nextassist-app.com.br/sitemap.xml"
    },
    "instagram": {
      "userId": "",
      "apiVersion": "v21.0"
    }
  },
  "autonomy": {
    "mode": "semi-autonomous"
  },
  "secrets": {
    "required": [
      "OPENAI_API_KEY",
      "FIREBASE_WEB_API_KEY",
      "FIREBASE_ADMIN_EMAIL",
      "FIREBASE_ADMIN_PASSWORD",
      "FIREBASE_SERVICE_ACCOUNT_JSON",
      "FIREBASE_STORAGE_BUCKET"
    ],
    "optional": [
      "ANTHROPIC_API_KEY",
      "IG_USER_ID",
      "IG_ACCESS_TOKEN",
      "GEMINI_API_KEY",
      "GEMINI_API_KEY_FALLBACK"
    ]
  }
}
```

`integrations.instagram.userId` stays empty in the file (it's config, not a secret, but today's `IG_USER_ID` is an account identifier that's reasonable to keep as an env var alongside the token) — Task 8's Instagram client resolves it via `ctx.secrets.get(workspace.id, "IG_USER_ID")`, same as the token, so leave this field unset here and remove it from `integrations.instagram` in the type if it turns out unused. **Actually keep it simple:** delete the `userId` field from the JSON above (Task 8's Instagram integration reads it purely from secrets, since it's operationally the same class of value as the token — both come from the same Meta app setup). Corrected `integrations.instagram` block:

```json
    "instagram": {
      "apiVersion": "v21.0"
    }
```

And drop `userId` from the `integrations.instagram` type in `src/workspace.ts` (Task 1) — go back and remove that field now:

```ts
    instagram?: { apiVersion: string };
```

- [ ] **Step 3: Verify workspace loads**

Run: `node --import tsx -e "import('./src/workspace.js').then(m => m.loadWorkspace('nextassist').then(w => console.log(w.name)))"`
Expected: prints `NextAssist`

- [ ] **Step 4: Commit**

```bash
git add workspaces/nextassist/workspace.json src/workspace.ts
git commit -m "feat: migra NextAssist para workspaces/nextassist/"
```

---

### Task 6: `dataSource.ts` and the four state modules read/write by `WorkspaceContext`

**Files:**
- Modify: `src/lib/dataSource.ts`
- Modify: `src/contentCalendar.ts`
- Modify: `src/history.ts`
- Modify: `src/runsHistory.ts`
- Modify: `src/performance.ts`
- Modify: `src/conversions.ts`
- Modify: `src/config.ts` (drop `dataSource`/`githubRepo`/`githubBranch`/`githubToken` — keep them, they're app-level; nothing to remove yet, this task only adds a `workspaceId`-aware `readStateJson`)
- Test: `src/lib/dataSource.test.ts`

**Interfaces:**
- Consumes: `WorkspaceContext.paths` (Task 4).
- Produces: `readStateJson<T>(ctx: WorkspaceContext, fileName: string, fallback: T): Promise<T>`; `getNextTopic(ctx)`, `markTopicPublished(ctx, tema)`, `addTopics(ctx, topics)`; `appendHistory(ctx, entry)`, `getHistory(ctx)`; `appendRun(ctx, record)`, `getRuns(ctx)`; `refreshPerformance(ctx, inicio?, fim?)`, `getPerformance(ctx)`; `recordConversion(ctx, event)`, `getConversionSummary(ctx)`.

- [ ] **Step 1: Write the failing test for `dataSource.ts`**

```ts
// src/lib/dataSource.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import { readStateJson } from "./dataSource.js";
import { config } from "../config.js";

test("readStateJson (modo local) lê o caminho informado e devolve o fallback se faltar", async () => {
  assert.equal(config.dataSource, "local"); // guarda: este teste assume o modo default
  const missing = await readStateJson(new URL("file:///caminho/que/nao/existe.json"), { ok: false });
  assert.deepEqual(missing, { ok: false });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test src/lib/dataSource.test.ts`
Expected: FAIL — `readStateJson` still takes `(fileName: string, fallback: T)`, not a `URL`, so the call doesn't type-check / the "github" branch logic doesn't apply to a URL yet.

- [ ] **Step 3: Rewrite `dataSource.ts` to take a path (URL) plus a workspace id for the github-mode fetch**

```ts
// src/lib/dataSource.ts
import { readFile } from "node:fs/promises";
import { config } from "../config.js";

/**
 * Lê um arquivo de estado JSON de um workspace. Em modo "github" (painel
 * hospedado, que não recebe os commits da Action) busca a versão crua do
 * repositório em `workspaces/<workspaceId>/<fileName>`; em "local" lê do
 * disco a partir de `path`. Devolve `fallback` se não existir.
 */
export async function readStateJson<T>(path: URL, fallback: T, workspaceId?: string): Promise<T> {
  try {
    if (config.dataSource === "github") {
      if (!workspaceId) throw new Error("readStateJson: workspaceId é obrigatório em modo github");
      const fileName = path.pathname.split("/").pop();
      const url = `https://api.github.com/repos/${config.githubRepo}/contents/workspaces/${workspaceId}/${fileName}?ref=${config.githubBranch}`;
      const headers: Record<string, string> = {
        Accept: "application/vnd.github.raw",
        "User-Agent": "nextassist-panel",
      };
      if (config.githubToken) headers.Authorization = `Bearer ${config.githubToken}`;
      const res = await fetch(url, { headers });
      if (!res.ok) return fallback;
      return JSON.parse(await res.text()) as T;
    }
    const raw = await readFile(path, "utf-8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test src/lib/dataSource.test.ts`
Expected: PASS (1 test)

- [ ] **Step 5: Update `contentCalendar.ts` to take `ctx`**

```ts
// src/contentCalendar.ts
import { readFile, writeFile } from "node:fs/promises";
import type { WorkspaceContext } from "./context.js";

export interface CalendarTopic {
  tema: string;
  palavraChaveAlvo: string;
  publicado: boolean;
  publicadoEm?: string;
}

interface Calendar {
  topicos: CalendarTopic[];
}

async function load(ctx: WorkspaceContext): Promise<Calendar> {
  const raw = await readFile(ctx.paths.calendar, "utf-8");
  return JSON.parse(raw) as Calendar;
}

async function save(ctx: WorkspaceContext, calendar: Calendar): Promise<void> {
  await writeFile(ctx.paths.calendar, JSON.stringify(calendar, null, 2) + "\n");
}

export async function getNextTopic(ctx: WorkspaceContext): Promise<CalendarTopic | null> {
  const calendar = await load(ctx);
  return calendar.topicos.find((t) => !t.publicado) ?? null;
}

export async function markTopicPublished(ctx: WorkspaceContext, tema: string): Promise<void> {
  const calendar = await load(ctx);
  const topic = calendar.topicos.find((t) => t.tema === tema);
  if (topic) {
    topic.publicado = true;
    topic.publicadoEm = new Date().toISOString();
    await save(ctx, calendar);
  }
}

export async function addTopics(ctx: WorkspaceContext, newTopics: CalendarTopic[]): Promise<void> {
  const calendar = await load(ctx);
  const existing = new Set(calendar.topicos.map((t) => t.tema.toLowerCase()));
  const toAdd = newTopics.filter((t) => !existing.has(t.tema.toLowerCase()));
  calendar.topicos.push(...toAdd);
  await save(ctx, calendar);
}
```

- [ ] **Step 6: Update `history.ts`, `runsHistory.ts`, `performance.ts`, `conversions.ts` the same way**

```ts
// src/history.ts
import { readFile, writeFile } from "node:fs/promises";
import { readStateJson } from "./lib/dataSource.js";
import type { WorkspaceContext } from "./context.js";

export interface HistoryEntry {
  tema: string;
  titulo: string;
  slug: string;
  publicadoEm: string;
}

async function loadHistory(ctx: WorkspaceContext): Promise<HistoryEntry[]> {
  try {
    const raw = await readFile(ctx.paths.history, "utf-8");
    return JSON.parse(raw) as HistoryEntry[];
  } catch {
    return [];
  }
}

export async function appendHistory(ctx: WorkspaceContext, entry: HistoryEntry): Promise<void> {
  const history = await loadHistory(ctx);
  history.unshift(entry);
  await writeFile(ctx.paths.history, JSON.stringify(history.slice(0, 200), null, 2) + "\n");
}

export async function getHistory(ctx: WorkspaceContext): Promise<HistoryEntry[]> {
  return readStateJson<HistoryEntry[]>(ctx.paths.history, [], ctx.workspace.id);
}
```

```ts
// src/runsHistory.ts
import { readFile, writeFile } from "node:fs/promises";
import { readStateJson } from "./lib/dataSource.js";
import type { WorkspaceContext } from "./context.js";
import type { PipelineEvent } from "./pipeline.js";
import type { AnthropicUsage } from "./context.js";

const MAX_RUNS = 100;

export type RunStatus = "publicado" | "falhou" | "sem-tema";

export interface RunRecord {
  id: string;
  origem: "action" | "manual";
  iniciadoEm: string;
  finalizadoEm: string;
  tema: string | null;
  status: RunStatus;
  slug: string | null;
  erro: string | null;
  eventos: PipelineEvent[];
  usage?: AnthropicUsage;
}

async function loadLocal(ctx: WorkspaceContext): Promise<RunRecord[]> {
  try {
    const raw = await readFile(ctx.paths.runs, "utf-8");
    return JSON.parse(raw) as RunRecord[];
  } catch {
    return [];
  }
}

export async function appendRun(ctx: WorkspaceContext, record: RunRecord): Promise<void> {
  const runs = await loadLocal(ctx);
  runs.unshift(record);
  await writeFile(ctx.paths.runs, JSON.stringify(runs.slice(0, MAX_RUNS), null, 2) + "\n");
}

export async function getRuns(ctx: WorkspaceContext): Promise<RunRecord[]> {
  return readStateJson<RunRecord[]>(ctx.paths.runs, [], ctx.workspace.id);
}
```

For `performance.ts`, apply the same `ctx.paths.performance` substitution for `PERFORMANCE_PATH`, thread `ctx` into `refreshPerformance`/`getPerformance`/`getPublishedBlogPosts` (which needs `ctx.workspace.integrations.cms.apiUrl` instead of `config.blogApiUrl`), and pass `ctx` down into `getUrlMetrics`/`getIndexStatus` (updated in Task 8) and `postUrl` (updated in Task 9). For `conversions.ts`, replace the hardcoded `PATH` constant with `ctx.paths.conversions` and thread `ctx` into `recordConversion`/`getConversionSummary` (`summarizeConversions` itself stays pure and untouched — it takes an event array, not `ctx`).

- [ ] **Step 7: Run the full test suite**

Run: `npm test`
Expected: PASS — `contentQuality.test.ts`, `providerFallback.test.ts`, `editorSeo.test.ts`, `conversions.test.ts` are untouched pure-function tests and keep passing; the new `dataSource.test.ts` passes.

- [ ] **Step 8: Commit**

```bash
git add src/lib/dataSource.ts src/lib/dataSource.test.ts src/contentCalendar.ts src/history.ts src/runsHistory.ts src/performance.ts src/conversions.ts src/tests.ts
git commit -m "refactor: persistencia por workspace (WorkspaceContext.paths)"
```

(Add `import "./lib/dataSource.test.js";` to `src/tests.ts` in this commit too.)

---

### Task 7: `anthropic.ts` — `runAgent(ctx, params)`, no more global usage singleton

**Files:**
- Modify: `src/lib/anthropic.ts`

**Interfaces:**
- Consumes: `WorkspaceContext` (Task 4) — specifically `ctx.ai.openai`, `ctx.ai.anthropic`, `ctx.aiPrimaryProvider`, `ctx.usage`.
- Produces: `runAgent(ctx: WorkspaceContext, params: { system, prompt, useWebSearch?, maxTokens? }): Promise<string>`; `extractJson<T>(text: string): T` (unchanged, already pure).

- [ ] **Step 1: Rewrite `anthropic.ts`**

```ts
// src/lib/anthropic.ts
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
    model: ctx.usage.get().model,
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
    model: ctx.usage.get().model,
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
```

Note: `ctx.usage.get().model` is a shortcut to read the model name the tracker was built with (Task 4's `createUsageTracker(anthropicModel, openaiModel)` seeds `state.model` to `anthropicModel` and updates it on every `add*` call) — it always reflects the *last-used* provider's model, which is wrong for picking the model to call *before* the first request. Fix `UsageTracker` (Task 4) instead of working around it here: add a `models: { anthropic: string; openai: string }` field to `WorkspaceContext` directly (sits next to `usage`, not inside it), and use `ctx.models.anthropic` / `ctx.models.openai` here.

- [ ] **Step 1b: Add `models` to `WorkspaceContext` (amends Task 4)**

In `src/context.ts`, add to the `WorkspaceContext` interface: `models: { anthropic: string; openai: string };`, and in `buildWorkspaceContext`'s return value add `models: { anthropic: anthropicModel, openai: openaiModel },`. Update `src/context.test.ts`'s usage-tracker test to also assert `ctx.models.openai === "gpt-5.6"` (or whatever `openaiModel` resolves to by default).

Then in `runAnthropic`/`runOpenAi` above, replace `ctx.usage.get().model` with `ctx.models.anthropic` and `ctx.models.openai` respectively.

- [ ] **Step 2: Run the full test suite and build**

Run: `npm test && npm run build`
Expected: `npm test` PASS; `npm run build` fails at this point for every file that still calls `runAgent(params)` without `ctx` (all 5 agents that call it) — expected, fixed in Task 9. Confirm the failures are only in `src/agents/*.ts` and `src/context.ts`'s own compile is clean by running `npx tsc --noEmit src/context.ts src/lib/anthropic.ts 2>&1 | grep -v "src/agents"` and confirming no output.

- [ ] **Step 3: Commit**

```bash
git add src/lib/anthropic.ts src/context.ts src/context.test.ts
git commit -m "refactor: runAgent recebe WorkspaceContext, remove singleton de uso"
```

---

### Task 8: Integration libs stop importing `config.ts`

**Files:**
- Modify: `src/lib/storage.ts`
- Modify: `src/lib/google.ts`
- Modify: `src/lib/searchConsole.ts`
- Modify: `src/lib/imageGen.ts`
- Modify: `src/lib/instagram.ts`
- Modify: `src/lib/tts.ts`
- Modify: `src/lib/veo.ts`
- Delete: `src/lib/firebaseAuth.ts` (superseded by `ctx.getIdToken()`, Task 4)

**Interfaces:**
- Consumes: `WorkspaceContext` (Task 4).
- Produces (all take `ctx` as the first parameter now): `writeStateJson(ctx, fileName, value)`, `readStoredStateJson(ctx, fileName, fallback)`, `uploadCoverImage(ctx, imageBuffer, slug)`, `uploadReelVideo(ctx, videoBuffer, slug)`, `googleFetch<T>(ctx, url, init?)`, `getUrlMetrics(ctx, url, startDate, endDate)`, `getIndexStatus(ctx, url)`, `generateCoverImage(ctx, prompt)`, `publishReelToInstagram(ctx, videoUrl, caption)`, `generateNarration(ctx, text)`, `generateVeoReel(ctx, imageBuffer, prompt, apiKeyOverride?)`.

Every function in this task follows the same mechanical change: replace `import { config } from "../config.js"` with `import type { WorkspaceContext } from "../context.js"`, add `ctx: WorkspaceContext` as the first parameter, and replace each `config.xxx` read with either `ctx.workspace.integrations....` (non-secret config) or `await ctx.secrets.get(ctx.workspace.id, "XXX")` (secret). None of these files have existing unit tests (they're thin network wrappers) — this task is a `npm run build` (type-check) gate, not a `node --test` gate.

- [ ] **Step 1: `src/lib/storage.ts`**

```ts
// src/lib/storage.ts
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getStorage } from "firebase-admin/storage";
import type { WorkspaceContext } from "../context.js";

async function getStorageBucket(ctx: WorkspaceContext) {
  if (getApps().length === 0) {
    const serviceAccountJson = await ctx.secrets.get(ctx.workspace.id, "FIREBASE_SERVICE_ACCOUNT_JSON");
    const storageBucket = await ctx.secrets.get(ctx.workspace.id, "FIREBASE_STORAGE_BUCKET");
    if (!serviceAccountJson || !storageBucket) {
      throw new Error(`Workspace "${ctx.workspace.id}": FIREBASE_SERVICE_ACCOUNT_JSON / FIREBASE_STORAGE_BUCKET ausentes.`);
    }
    initializeApp({ credential: cert(JSON.parse(serviceAccountJson)), storageBucket });
  }
  return getStorage().bucket();
}

export async function writeStateJson(ctx: WorkspaceContext, fileName: string, value: unknown): Promise<void> {
  const file = (await getStorageBucket(ctx)).file(`panel-state/${ctx.workspace.id}/${fileName}`);
  await file.save(JSON.stringify(value, null, 2) + "\n", {
    resumable: false,
    metadata: { contentType: "application/json; charset=utf-8", cacheControl: "no-store" },
  });
}

export async function readStoredStateJson<T>(ctx: WorkspaceContext, fileName: string, fallback: T): Promise<T> {
  try {
    const [contents] = await (await getStorageBucket(ctx)).file(`panel-state/${ctx.workspace.id}/${fileName}`).download();
    return JSON.parse(contents.toString("utf-8")) as T;
  } catch (err) {
    const code = (err as { code?: number | string })?.code;
    if (code === 404 || code === "404") return fallback;
    throw err;
  }
}

export async function uploadCoverImage(ctx: WorkspaceContext, imageBuffer: Buffer, slug: string): Promise<string> {
  const bucket = await getStorageBucket(ctx);
  const filePath = `blog-covers/${ctx.workspace.id}/${slug}-${Date.now()}.jpg`;
  const file = bucket.file(filePath);
  await file.save(imageBuffer, { metadata: { contentType: "image/jpeg" } });
  const [url] = await file.getSignedUrl({ action: "read", expires: "01-01-2100" });
  return url;
}

export async function uploadReelVideo(ctx: WorkspaceContext, videoBuffer: Buffer, slug: string): Promise<string> {
  const bucket = await getStorageBucket(ctx);
  const filePath = `blog-covers/${ctx.workspace.id}/${slug}-${Date.now()}-reel.mp4`;
  const file = bucket.file(filePath);
  await file.save(videoBuffer, { metadata: { contentType: "video/mp4" } });
  const [url] = await file.getSignedUrl({ action: "read", expires: "01-01-2100" });
  return url;
}
```

(`panel-state/` and `blog-covers/` gain a `<workspaceId>/` segment so two workspaces sharing one Firebase project — if that ever happens — don't collide.)

- [ ] **Step 2: `src/lib/google.ts`**

```ts
// src/lib/google.ts
import { JWT } from "google-auth-library";
import type { WorkspaceContext } from "../context.js";

const SCOPES = [
  "https://www.googleapis.com/auth/indexing",
  "https://www.googleapis.com/auth/webmasters",
];

const clients = new WeakMap<WorkspaceContext, JWT>();

async function getClient(ctx: WorkspaceContext): Promise<JWT> {
  let client = clients.get(ctx);
  if (!client) {
    const serviceAccountJson = await ctx.secrets.get(ctx.workspace.id, "FIREBASE_SERVICE_ACCOUNT_JSON");
    if (!serviceAccountJson) throw new Error(`Workspace "${ctx.workspace.id}": FIREBASE_SERVICE_ACCOUNT_JSON ausente.`);
    const sa = JSON.parse(serviceAccountJson) as { client_email: string; private_key: string };
    client = new JWT({ email: sa.client_email, key: sa.private_key, scopes: SCOPES });
    clients.set(ctx, client);
  }
  return client;
}

type HttpMethod = "GET" | "POST" | "PUT" | "DELETE";

export async function googleFetch<T>(
  ctx: WorkspaceContext,
  url: string,
  init: { method?: HttpMethod; body?: unknown } = {},
): Promise<T> {
  const client = await getClient(ctx);
  const res = await client.request<T>({ url, method: init.method ?? "GET", data: init.body });
  return res.data;
}
```

- [ ] **Step 3: `src/lib/searchConsole.ts`**

```ts
// src/lib/searchConsole.ts
import type { WorkspaceContext } from "../context.js";
import { googleFetch } from "./google.js";

export interface UrlMetrics { clicks: number; impressions: number; ctr: number; position: number; }

export async function getUrlMetrics(ctx: WorkspaceContext, url: string, startDate: string, endDate: string): Promise<UrlMetrics> {
  const site = encodeURIComponent(ctx.workspace.integrations.searchConsole?.siteUrl ?? "");
  const data = await googleFetch<{ rows?: Array<UrlMetrics> }>(ctx, `https://www.googleapis.com/webmasters/v3/sites/${site}/searchAnalytics/query`, {
    method: "POST",
    body: {
      startDate, endDate, dimensions: ["page"],
      dimensionFilterGroups: [{ filters: [{ dimension: "page", operator: "equals", expression: url }] }],
      rowLimit: 1,
    },
  });
  const row = data.rows?.[0];
  return { clicks: row?.clicks ?? 0, impressions: row?.impressions ?? 0, ctr: row?.ctr ?? 0, position: row?.position ?? 0 };
}

export interface IndexStatus { verdict: string; coverageState: string; lastCrawlTime: string | null; }

export async function getIndexStatus(ctx: WorkspaceContext, url: string): Promise<IndexStatus> {
  const siteUrl = ctx.workspace.integrations.searchConsole?.siteUrl ?? "";
  const data = await googleFetch<{
    inspectionResult?: { indexStatusResult?: { verdict?: string; coverageState?: string; lastCrawlTime?: string } };
  }>(ctx, "https://searchconsole.googleapis.com/v1/urlInspection/index:inspect", {
    method: "POST",
    body: { inspectionUrl: url, siteUrl },
  });
  const r = data.inspectionResult?.indexStatusResult;
  return { verdict: r?.verdict ?? "VERDICT_UNSPECIFIED", coverageState: r?.coverageState ?? "Desconhecido", lastCrawlTime: r?.lastCrawlTime ?? null };
}
```

- [ ] **Step 4: `src/lib/imageGen.ts`**

```ts
// src/lib/imageGen.ts
import type { WorkspaceContext } from "../context.js";

export async function generateCoverImage(ctx: WorkspaceContext, prompt: string): Promise<Buffer> {
  const apiKey = await ctx.secrets.get(ctx.workspace.id, "OPENAI_API_KEY");
  if (!apiKey) throw new Error(`Workspace "${ctx.workspace.id}": OPENAI_API_KEY não configurada — necessária para gerar a imagem de capa.`);

  const res = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: "gpt-image-1", prompt, size: "1536x1024",
      output_format: "jpeg", output_compression: 90, n: 1,
    }),
  });
  if (!res.ok) throw new Error(`Falha ao gerar imagem de capa: ${await res.text()}`);
  const data = (await res.json()) as { data: { b64_json: string }[] };
  return Buffer.from(data.data[0].b64_json, "base64");
}
```

(Drops the `imageGenProvider`/`imageGenApiKey` indirection from `config.ts` — this phase has one provider, OpenAI; a `provider` switch can come back if/when a second one is needed, following the same YAGNI reasoning as the CMS abstraction.)

- [ ] **Step 5: `src/lib/instagram.ts`**

```ts
// src/lib/instagram.ts
import type { WorkspaceContext } from "../context.js";

const GRAPH = "https://graph.facebook.com";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function graphPost(ctx: WorkspaceContext, path: string, params: Record<string, string>): Promise<any> {
  const accessToken = await ctx.secrets.get(ctx.workspace.id, "IG_ACCESS_TOKEN");
  const apiVersion = ctx.workspace.integrations.instagram?.apiVersion ?? "v21.0";
  const body = new URLSearchParams({ ...params, access_token: accessToken ?? "" });
  const res = await fetch(`${GRAPH}/${apiVersion}/${path}`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`Instagram API (${path}): ${data?.error?.message ?? res.statusText}`);
  return data;
}

async function graphGet(ctx: WorkspaceContext, path: string, fields: string): Promise<any> {
  const accessToken = await ctx.secrets.get(ctx.workspace.id, "IG_ACCESS_TOKEN");
  const apiVersion = ctx.workspace.integrations.instagram?.apiVersion ?? "v21.0";
  const query = new URLSearchParams({ fields, access_token: accessToken ?? "" });
  const res = await fetch(`${GRAPH}/${apiVersion}/${path}?${query}`);
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`Instagram API (${path}): ${data?.error?.message ?? res.statusText}`);
  return data;
}

async function waitForContainer(ctx: WorkspaceContext, containerId: string, maxAttempts: number): Promise<void> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const { status_code: status, status: statusDetail } = await graphGet(ctx, containerId, "status_code,status");
    if (status === "FINISHED") return;
    if (status === "ERROR" || status === "EXPIRED") throw new Error(`container de mídia ficou com status ${status}${statusDetail ? `: ${statusDetail}` : ""}`);
    await sleep(3000);
  }
  throw new Error("container de mídia não ficou pronto a tempo (timeout)");
}

export interface InstagramPostResult { mediaId: string; permalink: string | null; }

export async function publishReelToInstagram(ctx: WorkspaceContext, videoUrl: string, caption: string): Promise<InstagramPostResult> {
  const userId = await ctx.secrets.get(ctx.workspace.id, "IG_USER_ID");
  if (!userId) throw new Error(`Workspace "${ctx.workspace.id}": IG_USER_ID não configurado.`);

  const container = await graphPost(ctx, `${userId}/media`, { media_type: "REELS", video_url: videoUrl, caption });
  const containerId: string = container.id;
  await waitForContainer(ctx, containerId, 100);
  const published = await graphPost(ctx, `${userId}/media_publish`, { creation_id: containerId });
  const mediaId: string = published.id;

  let permalink: string | null = null;
  try {
    const info = await graphGet(ctx, mediaId, "permalink");
    permalink = info.permalink ?? null;
  } catch { /* segue sem o permalink */ }

  return { mediaId, permalink };
}
```

- [ ] **Step 6: `src/lib/tts.ts`**

```ts
// src/lib/tts.ts
import OpenAI from "openai";
import type { WorkspaceContext } from "../context.js";

export async function generateNarration(ctx: WorkspaceContext, text: string): Promise<Buffer> {
  const apiKey = await ctx.secrets.get(ctx.workspace.id, "OPENAI_API_KEY");
  if (!apiKey) throw new Error(`Workspace "${ctx.workspace.id}": OPENAI_API_KEY não configurada — necessária para gerar a narração do Reel.`);

  const openai = new OpenAI({ apiKey });
  const response = await openai.audio.speech.create({
    model: "gpt-4o-mini-tts", voice: "nova", input: text,
    instructions: "Fale em português do Brasil, tom animado e natural, ritmo rápido.",
    response_format: "mp3",
  });
  return Buffer.from(await response.arrayBuffer());
}
```

- [ ] **Step 7: `src/lib/veo.ts`**

```ts
// src/lib/veo.ts
import type { WorkspaceContext } from "../context.js";

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";
const GEMINI_VEO_MODEL = "veo-3.1-fast-generate-preview";

interface Operation {
  name: string; done?: boolean; error?: { message: string };
  response?: { generateVideoResponse?: { generatedSamples?: Array<{ video?: { uri?: string } }> } };
}
type GeminiError = Error & { status?: number };

function sleep(ms: number): Promise<void> { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function callGemini(path: string, apiKey: string, body?: unknown): Promise<any> {
  const res = await fetch(`${GEMINI_BASE}/${path}`, {
    method: body ? "POST" : "GET",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const err: GeminiError = new Error(`Gemini API (${path}): ${data?.error?.message ?? res.statusText}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

/** `apiKeyOverride` permite passar a chave de fallback (2ª conta) explicitamente. */
export async function generateVeoReel(ctx: WorkspaceContext, imageBuffer: Buffer, prompt: string, apiKeyOverride?: string): Promise<Buffer> {
  const apiKey = apiKeyOverride ?? (await ctx.secrets.get(ctx.workspace.id, "GEMINI_API_KEY"));
  if (!apiKey) throw new Error(`Workspace "${ctx.workspace.id}": GEMINI_API_KEY não configurada — necessária para gerar vídeo com o Veo.`);

  const operation: Operation = await callGemini(`models/${GEMINI_VEO_MODEL}:predictLongRunning`, apiKey, {
    instances: [{ prompt, image: { bytesBase64Encoded: imageBuffer.toString("base64"), mimeType: "image/jpeg" } }],
    parameters: { aspectRatio: "9:16", resolution: "720p" },
  });

  const maxAttempts = 30;
  let finished: Operation = operation;
  for (let attempt = 0; attempt < maxAttempts && !finished.done; attempt++) {
    await sleep(10_000);
    finished = await callGemini(operation.name, apiKey);
  }
  if (!finished.done) throw new Error("geração de vídeo pelo Veo não terminou a tempo (timeout)");
  if (finished.error) throw new Error(`Veo falhou ao gerar o vídeo: ${finished.error.message}`);

  const videoUri = finished.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri;
  if (!videoUri) throw new Error("Veo terminou mas não retornou um vídeo.");

  const videoRes = await fetch(videoUri, { headers: { "x-goog-api-key": apiKey } });
  if (!videoRes.ok) throw new Error(`Falha ao baixar vídeo do Veo: HTTP ${videoRes.status}`);
  return Buffer.from(await videoRes.arrayBuffer());
}
```

- [ ] **Step 8: Delete `src/lib/firebaseAuth.ts`**

Its only export, `getBlogAdminIdToken()`, is superseded by `ctx.getIdToken()` (Task 4). Delete the file.

```bash
git rm src/lib/firebaseAuth.ts
```

- [ ] **Step 9: Run tests and commit**

Run: `npm test`
Expected: PASS (build will still fail until Task 9/10 update the callers — that's fine, `npm test` runs via `tsx` per-file and doesn't type-check the whole project).

```bash
git add src/lib/storage.ts src/lib/google.ts src/lib/searchConsole.ts src/lib/imageGen.ts src/lib/instagram.ts src/lib/tts.ts src/lib/veo.ts
git commit -m "refactor: libs de integracao recebem WorkspaceContext, sem import de config.ts"
```

---

### Task 9: Agents accept `ctx` as the first parameter

**Files:**
- Modify: `src/agents/marketResearch.ts`
- Modify: `src/agents/topicPlanner.ts`
- Modify: `src/agents/writer.ts`
- Modify: `src/agents/editorSeo.ts`
- Modify: `src/agents/publisher.ts`
- Modify: `src/agents/instagramPublisher.ts`
- Modify: `src/agents/indexer.ts`

**Interfaces:**
- Consumes: `runAgent(ctx, params)` (Task 7), `ctx.cms.createPost` (Task 3/4), integration libs from Task 8.
- Produces: `researchMarket(ctx, tema)`, `planTopic(ctx, tema, palavraChaveAlvo, marketResearch)`, `writeArticle(ctx, tema, palavraChaveAlvo, plan, marketResearch)`, `editAndFinalize(ctx, plan, draftHtml, context?)`, `publishPost(ctx, post)`, `publishToInstagram(ctx, post, imagemCapaBuffer, blogUrl)`, `indexPublishedPost(ctx, slug)`, `postUrl(ctx, slug)`.

- [ ] **Step 1: `src/agents/marketResearch.ts`** — add `ctx` as first param, pass through to `runAgent`:

```ts
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
```

This is also the point where the brand-specific system prompt stops being a hardcoded NextAssist string and starts being built from `ctx.workspace.brand` — the same substitution (`ctx.workspace.brand.name`, `.description`, `.toneOfVoice`) applies to `topicPlanner.ts`'s and `writer.ts`'s `SYSTEM` strings and `editorSeo.ts`'s prompt text below.

- [ ] **Step 2: `src/agents/topicPlanner.ts`**

```ts
import { runAgent, extractJson } from "../lib/anthropic.js";
import type { WorkspaceContext } from "../context.js";

const SYSTEM_TEMPLATE = (ctx: WorkspaceContext) => `Você é o planejador editorial do blog do ${ctx.workspace.brand.name}. Com base no tema do
dia e na pesquisa de mercado fornecida, defina o ângulo específico do
post, o título, a meta description e a estrutura de H2s. Responda
SOMENTE em JSON, sem texto antes ou depois, no formato:
{
  "titulo": "...",
  "metaDescription": "... (150-160 caracteres)",
  "h2s": ["...", "...", "..."],
  "anguloEditorial": "..."
}`;

export interface ContentPlan {
  titulo: string;
  metaDescription: string;
  h2s: string[];
  anguloEditorial: string;
}

function normalize(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function fitTitle(title: string, keyword: string): string {
  const trimmed = title.trim();
  if (trimmed.length <= 70) return trimmed;
  if (normalize(trimmed).includes(normalize(keyword))) {
    const compact = `${keyword}: vale a pena migrar?`;
    if (compact.length >= 20 && compact.length <= 70) return compact;
  }
  throw new Error("O planejador gerou um título maior que 70 caracteres; tente executar novamente.");
}

export async function planTopic(ctx: WorkspaceContext, tema: string, palavraChaveAlvo: string, marketResearch: string): Promise<ContentPlan> {
  const raw = await runAgent(ctx, {
    system: SYSTEM_TEMPLATE(ctx),
    prompt: `Tema: "${tema}"
Palavra-chave principal: "${palavraChaveAlvo}"
O título deve ter entre 20 e 70 caracteres, contando espaços.

O título e a meta description devem conter a palavra-chave principal de forma natural.
Priorize a intenção de busca de quem precisa resolver esse problema e inclua H2s úteis para a decisão, não apenas definições.

Pesquisa de mercado:
${marketResearch}`,
    maxTokens: 2000,
  });
  const plan = extractJson<ContentPlan>(raw);
  return { ...plan, titulo: fitTitle(plan.titulo, palavraChaveAlvo) };
}
```

- [ ] **Step 3: `src/agents/writer.ts`**

```ts
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
```

- [ ] **Step 4: `src/agents/editorSeo.ts`** — add `ctx`, keep `ensureTrackedCtas` pure (it's covered by `editorSeo.test.ts` and takes no `ctx`):

```ts
import { runAgent, extractJson } from "../lib/anthropic.js";
import type { WorkspaceContext } from "../context.js";
import type { ContentPlan } from "./topicPlanner.js";

const SYSTEM_TEMPLATE = (ctx: WorkspaceContext) => `Você é o editor de SEO do blog do ${ctx.workspace.brand.name}. Revise o rascunho HTML
recebido e devolva a versão final pronta para publicar, aplicando:
- Slug curto em kebab-case, sem acentos, baseado no título
- Resumo de 1-2 frases (para listagem e meta description, até 160 caracteres)
- 3 a 5 tags relevantes
- Se houver alguma seção em formato pergunta/resposta, adicione ao final
  do HTML um bloco <script type="application/ld+json"> com FAQPage schema
  correspondente
- Se a lista de slugs publicados fornecida no contexto tiver pelo menos 2
  itens, garanta que o HTML tem pelo menos 2 links internos usando
  <a href="/blog/...">, usando exclusivamente slugs dessa lista — nunca
  invente um slug que não esteja nela. Se a lista tiver menos de 2 itens,
  use os que houver (ou nenhum) e não invente.
- Não repita o título dentro do HTML do conteúdo

Responda SOMENTE em JSON, sem texto antes ou depois, no formato:
{
  "titulo": "...",
  "slug": "...",
  "resumo": "...",
  "conteudo": "<html final>",
  "tags": ["...", "..."],
  "metaTitle": "...",
  "metaDescription": "..."
}`;

export interface FinalPost {
  titulo: string; slug: string; resumo: string; conteudo: string;
  tags: string[]; metaTitle: string; metaDescription: string;
}

export interface EditorialContext {
  palavraChaveAlvo?: string;
  slugsPublicados: string[];
  demoPath?: string;
}

export function ensureTrackedCtas(post: FinalPost, demoPath = "/demo"): FinalPost {
  const base = `${demoPath}?utm_source=blog&utm_medium=article&utm_campaign=${encodeURIComponent(post.slug)}`;
  let conteudo = post.conteudo;
  if (!conteudo.includes(`${base}&utm_content=cta-inline`)) conteudo += `<p><a href="${base}&utm_content=cta-inline">Teste grátis por 7 dias</a></p>`;
  if (!conteudo.includes(`${base}&utm_content=cta-final`)) conteudo += `<p><a href="${base}&utm_content=cta-final">Comece seu teste grátis</a></p>`;
  return conteudo === post.conteudo ? post : { ...post, conteudo };
}

export async function editAndFinalize(
  ctx: WorkspaceContext,
  plan: ContentPlan,
  draftHtml: string,
  context: EditorialContext = { slugsPublicados: [] },
): Promise<FinalPost> {
  const raw = await runAgent(ctx, {
    system: SYSTEM_TEMPLATE(ctx),
    prompt: `Título planejado: ${plan.titulo}
Meta description planejada: ${plan.metaDescription}

Rascunho HTML:
${draftHtml}

Slugs publicados disponíveis para link interno (use somente estes, nunca invente outro): ${
      context.slugsPublicados.length ? context.slugsPublicados.map((slug) => `/blog/${slug}`).join(", ") : "nenhum ainda — não inclua links /blog/... neste artigo"
    }
Palavra-chave principal: "${context.palavraChaveAlvo ?? ""}". Ela deve aparecer naturalmente no título e na meta description.
Inclua dois links para o teste grátis. Em ambos, use ${context.demoPath ?? "/demo"}?utm_source=blog&utm_medium=article&utm_campaign=SLUG_DO_ARTIGO e identifique a posição:
- CTA no meio do artigo: utm_content=cta-inline
- CTA ao final do artigo: utm_content=cta-final
Substitua SLUG_DO_ARTIGO pelo mesmo slug devolvido no JSON.`,
    maxTokens: 8000,
  });
  return ensureTrackedCtas(extractJson<FinalPost>(raw), context.demoPath);
}
```

Note: the `/#funcionalidades` link requirement in the original prompt and `contentQuality.ts`'s validator is NextAssist-specific product copy — leave `contentQuality.ts`'s check as-is for now (it's out of scope; `validateFinalPost` isn't touched by this plan and stays tied to the NextAssist content shape, matching the "not yet abstracted" state of Writer/SEO agents, which still work the same way for any workspace but with NextAssist-flavored quality rules). Drop the `/#funcionalidades` line from the prompt above since it's not generic — this plan does not attempt to generalize `contentQuality.ts`.

- [ ] **Step 5: `src/agents/publisher.ts`** — use `ctx.cms.createPost` instead of the raw `fetch`:

```ts
import { generateCoverImage } from "../lib/imageGen.js";
import { uploadCoverImage } from "../lib/storage.js";
import type { WorkspaceContext } from "../context.js";
import type { FinalPost } from "./editorSeo.js";

function buildImagePrompt(ctx: WorkspaceContext, titulo: string): string {
  return `Fotografia realista para capa de blog, tema: "${titulo}".
Contexto: ${ctx.workspace.brand.description}
Foto profissional, luz natural, alta definição, profundidade de campo rasa, sem texto ou logotipos na imagem.`;
}

export interface PublishResult {
  slug: string;
  publicado: boolean;
  imagemCapa: string;
  imagemCapaBuffer: Buffer;
}

export async function publishPost(ctx: WorkspaceContext, post: FinalPost): Promise<PublishResult> {
  const imageBuffer = await generateCoverImage(ctx, buildImagePrompt(ctx, post.titulo));
  const imagemCapa = await uploadCoverImage(ctx, imageBuffer, post.slug);

  const requireApproval = ctx.workspace.autonomy.mode === "copilot";
  const result = await ctx.cms.createPost({
    titulo: post.titulo,
    slug: post.slug,
    resumo: post.resumo,
    conteudo: post.conteudo,
    imagemCapa,
    autor: ctx.workspace.brand.name,
    tags: post.tags,
    publicado: !requireApproval,
    metaTitle: post.metaTitle,
    metaDescription: post.metaDescription,
  });

  return { slug: result.slug, publicado: !requireApproval, imagemCapa, imagemCapaBuffer: imageBuffer };
}
```

`requireApproval` used to be its own `config.requireApproval` env var; folding it into `autonomy.mode === "copilot"` matches the doc's own definition of the "copilot" level ("IA recomenda → Humano aprova → Executa") and removes one more piece of NextAssist-specific config. If a workspace needs the old "always draft regardless of autonomy" behavior, that's a future-phase concern, not this one.

- [ ] **Step 6: `src/agents/instagramPublisher.ts`**

```ts
import { publishReelToInstagram } from "../lib/instagram.js";
import { executeWithFallback } from "../lib/providerFallback.js";
import { uploadReelVideo } from "../lib/storage.js";
import { generateNarration } from "../lib/tts.js";
import { generateVeoReel } from "../lib/veo.js";
import { generateReelFromImage } from "../lib/video.js";
import type { WorkspaceContext } from "../context.js";
import type { FinalPost } from "./editorSeo.js";

function toHashtag(text: string): string {
  const clean = text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
  return clean ? `#${clean}` : "";
}

export function buildCaption(ctx: WorkspaceContext, post: FinalPost, blogUrl: string): string {
  const baseHashtag = toHashtag(ctx.workspace.brand.name);
  const hashtags = Array.from(new Set([...post.tags.map(toHashtag), baseHashtag])).filter(Boolean).slice(0, 30).join(" ");
  const caption = [post.titulo, "", post.resumo, "", `📖 Leia o artigo completo no blog (link na bio):`, blogUrl, "", hashtags].join("\n");
  return caption.slice(0, 2200);
}

function buildNarration(post: FinalPost): string {
  return `${post.titulo}. Confira o artigo completo, link na bio!`;
}

function buildVeoPrompt(ctx: WorkspaceContext, post: FinalPost): string {
  return `Vídeo promocional cinematográfico e realista: ${ctx.workspace.brand.description} Um narrador confiante diz em português do Brasil: "${buildNarration(post)}"`;
}

async function generateVeoReelWithFallback(ctx: WorkspaceContext, post: FinalPost, imagemCapaBuffer: Buffer): Promise<Buffer> {
  const prompt = buildVeoPrompt(ctx, post);
  const fallbackKey = await ctx.secrets.get(ctx.workspace.id, "GEMINI_API_KEY_FALLBACK");
  const { value } = await executeWithFallback({
    primary: () => generateVeoReel(ctx, imagemCapaBuffer, prompt),
    fallback: fallbackKey ? () => generateVeoReel(ctx, imagemCapaBuffer, prompt, fallbackKey) : undefined,
  });
  return value;
}

async function generateFallbackReel(ctx: WorkspaceContext, post: FinalPost, imagemCapaBuffer: Buffer): Promise<Buffer> {
  let narrationBuffer: Buffer | undefined;
  try {
    narrationBuffer = await generateNarration(ctx, buildNarration(post));
  } catch {
    narrationBuffer = undefined;
  }
  return generateReelFromImage(imagemCapaBuffer, narrationBuffer);
}

export interface InstagramResult { ok: boolean; permalink: string | null; detalhes: string; }

export async function publishToInstagram(ctx: WorkspaceContext, post: FinalPost, imagemCapaBuffer: Buffer, blogUrl: string): Promise<InstagramResult> {
  try {
    const caption = buildCaption(ctx, post, blogUrl);
    const geminiKey = await ctx.secrets.get(ctx.workspace.id, "GEMINI_API_KEY");

    let videoBuffer: Buffer;
    if (geminiKey) {
      try {
        videoBuffer = await generateVeoReelWithFallback(ctx, post, imagemCapaBuffer);
      } catch {
        videoBuffer = await generateFallbackReel(ctx, post, imagemCapaBuffer);
      }
    } else {
      videoBuffer = await generateFallbackReel(ctx, post, imagemCapaBuffer);
    }

    const videoUrl = await uploadReelVideo(ctx, videoBuffer, post.slug);
    const { mediaId, permalink } = await publishReelToInstagram(ctx, videoUrl, caption);
    return { ok: true, permalink, detalhes: permalink ? `Reel publicado no Instagram: ${permalink}` : `Reel publicado no Instagram (media ${mediaId})` };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, permalink: null, detalhes: `Falha ao publicar no Instagram: ${message}` };
  }
}
```

- [ ] **Step 7: `src/agents/indexer.ts`**

```ts
import { googleFetch } from "../lib/google.js";
import type { WorkspaceContext } from "../context.js";

export function postUrl(ctx: WorkspaceContext, slug: string): string {
  return `${ctx.workspace.integrations.siteUrl}/blog/${slug}`;
}

async function validatePublishedUrl(url: string): Promise<void> {
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) throw new Error(`URL pública respondeu HTTP ${response.status}`);
}

async function validateUrlInSitemap(ctx: WorkspaceContext, url: string): Promise<void> {
  const sitemapUrl = ctx.workspace.integrations.searchConsole?.sitemapUrl;
  if (!sitemapUrl) throw new Error(`Workspace "${ctx.workspace.id}": sitemapUrl não configurado.`);
  const response = await fetch(sitemapUrl, { cache: "no-store" });
  if (!response.ok) throw new Error(`sitemap respondeu HTTP ${response.status}`);
  const sitemap = await response.text();
  if (!sitemap.includes(`<loc>${url}</loc>`)) throw new Error("URL publicada ainda não aparece no sitemap");
}

async function resubmitSitemap(ctx: WorkspaceContext): Promise<void> {
  const sc = ctx.workspace.integrations.searchConsole;
  if (!sc) throw new Error(`Workspace "${ctx.workspace.id}": integrations.searchConsole não configurado.`);
  const site = encodeURIComponent(sc.siteUrl);
  const sitemap = encodeURIComponent(sc.sitemapUrl);
  await googleFetch(ctx, `https://www.googleapis.com/webmasters/v3/sites/${site}/sitemaps/${sitemap}`, { method: "PUT" });
}

export interface IndexResult {
  url: string; urlPublicaOk: boolean; sitemapContemUrl: boolean; sitemapOk: boolean; detalhes: string;
}

export async function indexPublishedPost(ctx: WorkspaceContext, slug: string): Promise<IndexResult> {
  const url = postUrl(ctx, slug);
  const result: IndexResult = { url, urlPublicaOk: false, sitemapContemUrl: false, sitemapOk: false, detalhes: "" };
  const notas: string[] = [];

  try {
    await validatePublishedUrl(url);
    result.urlPublicaOk = true;
    notas.push("URL pública: confirmada");
  } catch (err) {
    notas.push(`validação da URL falhou: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (result.urlPublicaOk) {
    try {
      await validateUrlInSitemap(ctx, url);
      result.sitemapContemUrl = true;
      notas.push("URL no sitemap: confirmada");
    } catch (err) {
      notas.push(`validação do sitemap falhou: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (result.sitemapContemUrl) {
    try {
      await resubmitSitemap(ctx);
      result.sitemapOk = true;
      notas.push("sitemap enviado ao Search Console");
    } catch (err) {
      notas.push(`envio do sitemap falhou: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  notas.push("indexação: aguardando decisão do Google");
  result.detalhes = notas.join(" · ");
  return result;
}
```

- [ ] **Step 8: Update `src/performance.ts`'s `getPublishedBlogPosts` and calls into `searchConsole.ts`/`indexer.ts` with `ctx`**

In `src/performance.ts` (touched again here, on top of Task 6's path change): replace `config.blogApiUrl` with `ctx.workspace.integrations.cms.apiUrl`, and change `postUrl(entry.slug)` / `getIndexStatus(url)` / `getUrlMetrics(url, inicio, fim)` calls to `postUrl(ctx, entry.slug)` / `getIndexStatus(ctx, url)` / `getUrlMetrics(ctx, url, inicio, fim)`.

- [ ] **Step 9: Type-check and test**

Run: `npm run build`
Expected: PASS — this is the first point where the whole project should compile clean. Fix any leftover call site the previous tasks missed (`pipeline.ts`, `index.ts`, `server.ts` are not yet updated — Tasks 10-13 — so `npm run build` will still fail on those three files specifically; confirm the *only* remaining errors are in `pipeline.ts`, `index.ts`, `server.ts`, `lib/panelIngest.ts`, `lib/githubDispatch.ts`, and `scripts/update-post-seo.ts`).

Run: `npm test`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add src/agents/ src/performance.ts
git commit -m "refactor: agentes recebem WorkspaceContext, publisher usa CmsProvider"
```

---

### Task 10: `pipeline.ts` — `runPipeline(workspaceId, onEvent)`

**Files:**
- Modify: `src/pipeline.ts`

**Interfaces:**
- Consumes: `loadWorkspace` (Task 1), `EnvSecretProvider` (Task 2), `buildWorkspaceContext` (Task 4), all agent functions (Task 9).
- Produces: `runPipeline(workspaceId: string, onEvent?: OnEvent): Promise<PipelineResult | null>`; `AgentId`, `AgentStatus`, `PipelineEvent`, `OnEvent`, `PipelineResult` (unchanged shapes).

- [ ] **Step 1: Rewrite `pipeline.ts`**

```ts
// src/pipeline.ts
import { getNextTopic, markTopicPublished } from "./contentCalendar.js";
import { researchMarket } from "./agents/marketResearch.js";
import { planTopic } from "./agents/topicPlanner.js";
import { writeArticle } from "./agents/writer.js";
import { editAndFinalize } from "./agents/editorSeo.js";
import { publishPost } from "./agents/publisher.js";
import { publishToInstagram } from "./agents/instagramPublisher.js";
import { indexPublishedPost, postUrl } from "./agents/indexer.js";
import { appendHistory } from "./history.js";
import { validateFinalPost } from "./lib/contentQuality.js";
import { loadWorkspace } from "./workspace.js";
import { EnvSecretProvider } from "./lib/secrets.js";
import { buildWorkspaceContext, type WorkspaceContext } from "./context.js";

export type AgentId =
  | "pesquisa-mercado" | "pesquisa-pauta" | "redator" | "editor-seo"
  | "publicador" | "instagram" | "indexador";

export type AgentStatus = "idle" | "working" | "done" | "error";

export interface PipelineEvent {
  agent: AgentId;
  status: AgentStatus;
  message?: string;
  tema?: string;
  timestamp: string;
}

export type OnEvent = (event: PipelineEvent) => void;

async function getPublishedSlugs(ctx: WorkspaceContext): Promise<string[]> {
  const response = await fetch(`${ctx.workspace.integrations.cms.apiUrl}/blog/posts`, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`Não foi possível carregar posts existentes: HTTP ${response.status}`);
  const payload = (await response.json()) as { data?: Array<{ slug?: string }> };
  return (payload.data ?? []).map((post) => post.slug).filter((slug): slug is string => Boolean(slug));
}

function emit(onEvent: OnEvent | undefined, event: Omit<PipelineEvent, "timestamp">) {
  onEvent?.({ ...event, timestamp: new Date().toISOString() });
}

export interface PipelineResult {
  tema: string;
  slugPublicado: string;
}

/**
 * Roda o pipeline completo uma vez para um workspace: pesquisa de mercado →
 * pesquisa de pauta → redação → edição/SEO → publicação → Instagram →
 * indexação. Chama `onEvent` a cada mudança de estado de um agente.
 */
export async function runPipeline(workspaceId: string, onEvent?: OnEvent): Promise<PipelineResult | null> {
  const workspace = await loadWorkspace(workspaceId);
  const ctx = await buildWorkspaceContext(workspace, new EnvSecretProvider());

  const topic = await getNextTopic(ctx);
  if (!topic) {
    emit(onEvent, { agent: "pesquisa-pauta", status: "error", message: "Nenhum tópico pendente no calendário." });
    return null;
  }

  try {
    emit(onEvent, { agent: "pesquisa-mercado", status: "working", tema: topic.tema, message: "Buscando o que os concorrentes publicaram..." });
    const marketResearch = await researchMarket(ctx, topic.tema);
    emit(onEvent, { agent: "pesquisa-mercado", status: "done", message: marketResearch.slice(0, 240) });

    emit(onEvent, { agent: "pesquisa-pauta", status: "working", message: "Definindo título, ângulo e estrutura..." });
    const plan = await planTopic(ctx, topic.tema, topic.palavraChaveAlvo, marketResearch);
    emit(onEvent, { agent: "pesquisa-pauta", status: "done", message: `Título: ${plan.titulo}` });

    emit(onEvent, { agent: "redator", status: "working", message: "Escrevendo o rascunho..." });
    const draftHtml = await writeArticle(ctx, topic.tema, topic.palavraChaveAlvo, plan, marketResearch);
    emit(onEvent, { agent: "redator", status: "done", message: `${draftHtml.replace(/<[^>]+>/g, "").slice(0, 200)}...` });

    emit(onEvent, { agent: "editor-seo", status: "working", message: "Revisando e adicionando links internos..." });
    const publishedSlugs = await getPublishedSlugs(ctx);
    const finalPost = await editAndFinalize(ctx, plan, draftHtml, {
      palavraChaveAlvo: topic.palavraChaveAlvo,
      slugsPublicados: publishedSlugs,
    });
    validateFinalPost(finalPost, publishedSlugs, { palavraChaveAlvo: topic.palavraChaveAlvo });
    emit(onEvent, { agent: "editor-seo", status: "done", message: `Slug: ${finalPost.slug} · Tags: ${finalPost.tags.join(", ")}` });

    emit(onEvent, { agent: "publicador", status: "working", message: "Gerando capa e publicando no blog..." });
    const published = await publishPost(ctx, finalPost);
    const publishedSlug = published.slug;
    emit(onEvent, {
      agent: "publicador", status: "done",
      message: published.publicado ? `Publicado em /blog/${publishedSlug}` : `Rascunho criado em /blog/${publishedSlug} — aguardando aprovação`,
    });

    if (ctx.workspace.channels.instagram) {
      emit(onEvent, { agent: "instagram", status: "working", message: "Publicando no Instagram..." });
      const igResult = await publishToInstagram(ctx, finalPost, published.imagemCapaBuffer, postUrl(ctx, publishedSlug));
      emit(onEvent, { agent: "instagram", status: igResult.ok ? "done" : "error", message: igResult.detalhes });
    } else {
      emit(onEvent, { agent: "instagram", status: "done", message: "Instagram não habilitado para este workspace — passo ignorado." });
    }

    emit(onEvent, { agent: "indexador", status: "working", message: "Notificando o Google e reenviando o sitemap..." });
    if (published.publicado) {
      const indexResult = await indexPublishedPost(ctx, publishedSlug);
      emit(onEvent, { agent: "indexador", status: "done", message: indexResult.detalhes });
    } else {
      emit(onEvent, { agent: "indexador", status: "done", message: "Indexação aguardará a aprovação do rascunho." });
    }

    if (published.publicado) await markTopicPublished(ctx, topic.tema);
    await appendHistory(ctx, { tema: topic.tema, titulo: finalPost.titulo, slug: publishedSlug, publicadoEm: new Date().toISOString() });

    return { tema: topic.tema, slugPublicado: publishedSlug };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    emit(onEvent, { agent: "publicador", status: "error", message });
    throw err;
  }
}
```

Note: `channels.instagram` (from `workspace.json`) replaces the old `config.instagram.userId && config.instagram.accessToken` presence check — the workspace declares *intent* to use the channel; Task 8's `instagramPublisher.ts` still fails gracefully (`ok: false`) if the secrets are missing despite `channels.instagram: true`, so a misconfigured workspace gets a clear per-run error instead of a silently-skipped channel.

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: errors only in `src/index.ts`, `src/server.ts`, `src/lib/panelIngest.ts`, `src/lib/githubDispatch.ts`, `src/scripts/update-post-seo.ts` (Tasks 11-13, 16).

- [ ] **Step 3: Commit**

```bash
git add src/pipeline.ts
git commit -m "refactor: runPipeline(workspaceId, onEvent) resolve o WorkspaceContext"
```

---

### Task 11: `index.ts` entrypoint resolves `WORKSPACE_ID`

**Files:**
- Modify: `src/index.ts`
- Modify: `src/lib/panelIngest.ts`

**Interfaces:**
- Consumes: `runPipeline(workspaceId, onEvent)` (Task 10).
- Produces: CLI reads `WORKSPACE_ID` env var (falls back to `"nextassist"` for backward compatibility with today's single-workspace `.env`/Action).

- [ ] **Step 1: Rewrite `src/index.ts`**

```ts
// src/index.ts
import { runPipeline, type PipelineEvent } from "./pipeline.js";
import { appendRun, type RunRecord, type RunStatus } from "./runsHistory.js";
import { loadWorkspace } from "./workspace.js";
import { EnvSecretProvider } from "./lib/secrets.js";
import { buildWorkspaceContext } from "./context.js";
import { pushEventToPanel } from "./lib/panelIngest.js";

const workspaceId = process.env.WORKSPACE_ID ?? "nextassist";
const eventos: PipelineEvent[] = [];
const iniciadoEm = new Date().toISOString();
const origem = process.env.GITHUB_ACTIONS === "true" ? "action" : "manual";

async function finalize(status: RunStatus, tema: string | null, slug: string | null, erro: string | null) {
  const workspace = await loadWorkspace(workspaceId);
  const ctx = await buildWorkspaceContext(workspace, new EnvSecretProvider());
  const record: RunRecord = {
    id: iniciadoEm, origem, iniciadoEm, finalizadoEm: new Date().toISOString(),
    tema, status, slug, erro, eventos, usage: ctx.usage.get(),
  };
  return appendRun(ctx, record);
}

try {
  const result = await runPipeline(workspaceId, (event) => {
    console.log(`[${workspaceId}][${event.agent}] ${event.status}${event.message ? " — " + event.message : ""}`);
    eventos.push(event);
    void pushEventToPanel(workspaceId, event);
  });

  if (result) {
    console.log(`Post publicado: /blog/${result.slugPublicado}`);
    await finalize("publicado", result.tema, result.slugPublicado, null);
  } else {
    console.log("Nenhum tópico pendente no calendário.");
    await finalize("sem-tema", null, null, null);
  }
  process.exit(0);
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  console.error("Falha no pipeline:", message);
  const tema = eventos.find((e) => e.tema)?.tema ?? null;
  await finalize("falhou", tema, null, message);
  process.exit(1);
}
```

Note: `finalize` now re-resolves the workspace/context to get `ctx.usage.get()` and `ctx.paths` for `appendRun` — it can't reuse the context `runPipeline` built internally (Task 10 intentionally doesn't expose it, to keep `runPipeline`'s signature simple: `(workspaceId, onEvent)`). This means usage-tracking at the top level (`index.ts`) is always empty (a fresh context's tracker starts at zero) — **this is a real regression from today's behavior**, where `getAnthropicUsage()` read the same global singleton the pipeline had just written to. Fix: change `runPipeline`'s return type to include the `WorkspaceContext.usage` snapshot.

- [ ] **Step 1b: Amend `runPipeline` (Task 10) to return usage**

In `src/pipeline.ts`, change `PipelineResult`:

```ts
export interface PipelineResult {
  tema: string;
  slugPublicado: string;
  usage: AnthropicUsage;
}
```//add `import type { AnthropicUsage } from "./context.js";` and change both `return { tema: topic.tema, slugPublicado: publishedSlug };` → `return { tema: topic.tema, slugPublicado: publishedSlug, usage: ctx.usage.get() };`, and the `null` early-return path stays `null` (no result, no usage — matches today's "sem tópico" case, which never called `getAnthropicUsage()` either since `resetAnthropicUsage()` ran but nothing accumulated).

For the `catch` block (pipeline threw), `index.ts`'s `finalize("falhou", ...)` still needs *some* usage snapshot (today's code called the global `getAnthropicUsage()` even on failure, to capture partial spend). Since `runPipeline` re-throws without returning, thread the context out via a differently-shaped catch: have `runPipeline` attach `ctx.usage.get()` to the thrown error as a property, and `index.ts` reads it back:

In `src/pipeline.ts`'s catch block:
```ts
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    emit(onEvent, { agent: "publicador", status: "error", message });
    const wrapped = err instanceof Error ? err : new Error(message);
    (wrapped as Error & { usage?: AnthropicUsage }).usage = ctx.usage.get();
    throw wrapped;
  }
```

In `src/index.ts`'s catch block, replace `await finalize("falhou", tema, null, message);` with a version that extracts `err.usage`:

```ts
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  console.error("Falha no pipeline:", message);
  const tema = eventos.find((e) => e.tema)?.tema ?? null;
  const usage = (err as Error & { usage?: import("./context.js").AnthropicUsage }).usage;
  const workspace = await loadWorkspace(workspaceId);
  const ctx = await buildWorkspaceContext(workspace, new EnvSecretProvider());
  await appendRun(ctx, {
    id: iniciadoEm, origem, iniciadoEm, finalizadoEm: new Date().toISOString(),
    tema, status: "falhou", slug: null, erro: message, eventos, usage,
  });
  process.exit(1);
}
```

And simplify `finalize` to only handle the two non-throw outcomes (`"publicado"` / `"sem-tema"`), taking `usage: AnthropicUsage | undefined` as a parameter instead of re-resolving it:

```ts
async function finalize(status: "publicado" | "sem-tema", tema: string | null, slug: string | null, usage?: import("./context.js").AnthropicUsage) {
  const workspace = await loadWorkspace(workspaceId);
  const ctx = await buildWorkspaceContext(workspace, new EnvSecretProvider());
  const record: RunRecord = {
    id: iniciadoEm, origem, iniciadoEm, finalizadoEm: new Date().toISOString(),
    tema, status, slug, erro: null, eventos, usage,
  };
  return appendRun(ctx, record);
}
```

and call sites become `await finalize("publicado", result.tema, result.slugPublicado, result.usage);` / `await finalize("sem-tema", null, null, undefined);`.

- [ ] **Step 2: Update `src/lib/panelIngest.ts` to take `workspaceId`**

```ts
// src/lib/panelIngest.ts
import { config } from "../config.js";
import type { PipelineEvent } from "../pipeline.js";

export async function pushEventToPanel(workspaceId: string, event: PipelineEvent): Promise<void> {
  if (!config.panelIngestUrl || !config.panelIngestToken) return;
  try {
    await fetch(config.panelIngestUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Panel-Ingest-Token": config.panelIngestToken },
      body: JSON.stringify({ ...event, workspaceId }),
    });
  } catch {
    // painel indisponível ou fora do ar — não é motivo pra falhar o pipeline
  }
}
```

(`config.panelIngestUrl`/`panelIngestToken` stay in `config.ts` — they're not per-workspace, the ingest endpoint and its shared secret belong to the panel deployment itself, not to any one client.)

- [ ] **Step 3: Type-check and run tests**

Run: `npx tsc --noEmit src/index.ts src/pipeline.ts src/lib/panelIngest.ts src/context.ts 2>&1`
Expected: no errors from these files (server.ts/githubDispatch.ts/update-post-seo.ts errors still pending, ignore for this step).

Run: `npm test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/index.ts src/pipeline.ts src/lib/panelIngest.ts
git commit -m "refactor: index.ts resolve WORKSPACE_ID, propaga uso de IA sem singleton"
```

---

### Task 12: `githubDispatch.ts` takes a `workspaceId` input; `update-post-seo.ts` script

**Files:**
- Modify: `src/lib/githubDispatch.ts`
- Modify: `src/scripts/update-post-seo.ts`

**Interfaces:**
- Produces: `triggerDailyPostWorkflow(workspaceId: string): Promise<void>`.

- [ ] **Step 1: `src/lib/githubDispatch.ts`**

```ts
// src/lib/githubDispatch.ts
import { config } from "../config.js";

const WORKFLOW_FILE = "daily-post.yml";

/**
 * Dispara manualmente o workflow diário do GitHub Actions para um workspace
 * específico (`workflow_dispatch` com `inputs.workspace_id`). Usado pelo
 * botão "Rodar pipeline agora" do painel hospedado.
 */
export async function triggerDailyPostWorkflow(workspaceId: string): Promise<void> {
  if (!config.githubDispatchToken) {
    throw new Error("GITHUB_DISPATCH_TOKEN não configurada — necessária para disparar a Action.");
  }

  const res = await fetch(
    `https://api.github.com/repos/${config.githubRepo}/actions/workflows/${WORKFLOW_FILE}/dispatches`,
    {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${config.githubDispatchToken}`,
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ref: config.githubBranch, inputs: { workspace_id: workspaceId } }),
    },
  );

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Falha ao disparar a GitHub Action: HTTP ${res.status} ${detail}`);
  }
}
```

- [ ] **Step 2: `src/scripts/update-post-seo.ts`** — this is a standalone CLI script; give it the same `WORKSPACE_ID` env convention as `index.ts`:

```ts
// src/scripts/update-post-seo.ts
import { loadWorkspace } from "../workspace.js";
import { EnvSecretProvider } from "../lib/secrets.js";
import { buildWorkspaceContext } from "../context.js";

interface AdminPost { id: string; slug: string; }

const updates = [
  {
    slug: "garantia-conserto-celular-o-que-a-lei-exige",
    metaTitle: "Garantia de Conserto de Celular: os 90 Dias que Você Precisa Cumprir",
    metaDescription: "O CDC exige garantia de 90 dias em conserto de celular. Veja o que é obrigatório, o que não é coberto e como estruturar isso na sua assistência sem prejuízo.",
  },
  {
    slug: "como-abrir-uma-assistencia-tecnica-de-celular-guia-completo-2026",
    metaTitle: "Como Abrir uma Assistência Técnica de Celular em 2026: Passo a Passo e Custos",
    metaDescription: "Quanto custa abrir uma assistência técnica de celular, o que é obrigatório por lei e os erros mais caros de quem está começando. Guia completo 2026.",
  },
] as const;

const workspaceId = process.env.WORKSPACE_ID ?? "nextassist";
const workspace = await loadWorkspace(workspaceId);
const ctx = await buildWorkspaceContext(workspace, new EnvSecretProvider());
const apiUrl = ctx.workspace.integrations.cms.apiUrl;

async function request<T>(path: string, idToken: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${apiUrl}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}`, ...init.headers },
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${init.method ?? "GET"} ${path} falhou (${response.status}): ${body}`);
  }
  return response.json() as Promise<T>;
}

const idToken = await ctx.getIdToken();
const list = await request<{ data: AdminPost[] }>("/blog/admin/posts", idToken);

for (const update of updates) {
  const post = list.data.find((candidate) => candidate.slug === update.slug);
  if (!post) throw new Error(`Post não encontrado: ${update.slug}`);
  await request(`/blog/admin/posts/${encodeURIComponent(post.id)}`, idToken, {
    method: "PUT",
    body: JSON.stringify({ metaTitle: update.metaTitle, metaDescription: update.metaDescription }),
  });
  console.log(`SEO atualizado: ${update.slug}`);
}
```

- [ ] **Step 3: Type-check and commit**

Run: `npx tsc --noEmit`
Expected: errors only in `src/server.ts` (Task 13).

```bash
git add src/lib/githubDispatch.ts src/scripts/update-post-seo.ts
git commit -m "refactor: dispatch e script de SEO recebem workspaceId"
```

---

### Task 13: `server.ts` — per-workspace runtime state and routes

**Files:**
- Modify: `src/server.ts`

**Interfaces:**
- Consumes: `listWorkspaces`/`loadWorkspace` (Task 1), `EnvSecretProvider` (Task 2), `buildWorkspaceContext` (Task 4), `getHistory`/`getRuns`/`getPerformance`/`refreshPerformance`/`getConversionSummary`/`recordConversion` (Tasks 6/9), `runPipeline` (Task 10), `triggerDailyPostWorkflow(workspaceId)` (Task 12).
- Produces new routes: `GET /api/workspaces`; every existing route gains a required `?workspace=` query param (except `/api/events/ingest`, which reads `workspaceId` from the POST body).

- [ ] **Step 1: Rewrite `server.ts`**

```ts
// src/server.ts
import express from "express";
import { timingSafeEqual } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { runPipeline, type AgentId, type AgentStatus, type PipelineEvent } from "./pipeline.js";
import { getHistory } from "./history.js";
import { getRuns } from "./runsHistory.js";
import { getPerformance, refreshPerformance } from "./performance.js";
import { config } from "./config.js";
import { getConversionSummary, recordConversion, type ConversionEventName } from "./conversions.js";
import { triggerDailyPostWorkflow } from "./lib/githubDispatch.js";
import { listWorkspaces, loadWorkspace, type MarketingWorkspace } from "./workspace.js";
import { EnvSecretProvider } from "./lib/secrets.js";
import { buildWorkspaceContext, type WorkspaceContext } from "./context.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT ? Number(process.env.PORT) : 4173;
const secrets = new EnvSecretProvider();

type RunMode = "local" | "dispatch" | "disabled";
const runMode: RunMode =
  config.dataSource !== "github" ? "local" : config.githubDispatchToken ? "dispatch" : "disabled";

interface WorkspaceRuntimeState {
  running: boolean;
  lastEvents: PipelineEvent[];
  clients: Set<express.Response>;
  dispatching: boolean;
  refreshingPerf: boolean;
}

const runtimeStates = new Map<string, WorkspaceRuntimeState>();

function getRuntimeState(workspaceId: string): WorkspaceRuntimeState {
  let state = runtimeStates.get(workspaceId);
  if (!state) {
    state = { running: false, lastEvents: [], clients: new Set(), dispatching: false, refreshingPerf: false };
    runtimeStates.set(workspaceId, state);
  }
  return state;
}

function broadcast(workspaceId: string, event: PipelineEvent) {
  const state = getRuntimeState(workspaceId);
  state.lastEvents.push(event);
  if (state.lastEvents.length > 50) state.lastEvents = state.lastEvents.slice(-50);
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of state.clients) res.write(payload);
}

async function contextFor(workspaceId: string): Promise<WorkspaceContext> {
  const workspace = await loadWorkspace(workspaceId);
  return buildWorkspaceContext(workspace, secrets);
}

function requireWorkspaceId(req: express.Request, res: express.Response): string | null {
  const workspaceId = String(req.query.workspace ?? "");
  if (!workspaceId) {
    res.status(400).json({ error: "Parâmetro ?workspace= é obrigatório." });
    return null;
  }
  return workspaceId;
}

const app = express();

if (config.panelPassword) {
  app.use((req, res, next) => {
    if (req.path === "/api/events/ingest") return next();
    const [scheme, encoded] = (req.headers.authorization ?? "").split(" ");
    if (scheme?.toLowerCase() === "basic" && encoded) {
      const credentials = Buffer.from(encoded, "base64").toString("utf8");
      const separator = credentials.indexOf(":");
      const receivedPassword = separator >= 0 ? credentials.slice(separator + 1) : "";
      const received = Buffer.from(receivedPassword);
      const expected = Buffer.from(config.panelPassword);
      if (received.length === expected.length && timingSafeEqual(received, expected)) {
        return next();
      }
    }
    res.set("WWW-Authenticate", 'Basic realm="Escritorio"');
    res.status(401).send("Autenticação necessária.");
  });
}

app.use(express.static(path.join(__dirname, "../web/public")));
app.use((req, res, next) => { res.header("Access-Control-Allow-Origin", "*"); next(); });

app.get("/api/workspaces", async (_req, res) => {
  const workspaces = await listWorkspaces();
  res.json(workspaces.map((w: MarketingWorkspace) => ({ id: w.id, name: w.name })));
});

app.post("/api/conversions", express.json(), async (req, res) => {
  const workspaceId = requireWorkspaceId(req, res);
  if (!workspaceId) return;
  const allowed: ConversionEventName[] = ["demo_view", "demo_submit", "contact_submit", "whatsapp_click"];
  if (!allowed.includes(req.body?.name)) { res.status(400).json({ error: "Evento inválido" }); return; }
  const campaign = String(req.body.campaign ?? "").slice(0, 80);
  const content = String(req.body.content ?? "").slice(0, 80);
  const utmValue = /^[a-z0-9-]*$/;
  if (!utmValue.test(campaign) || !utmValue.test(content)) {
    res.status(400).json({ error: "Parâmetros UTM inválidos" });
    return;
  }
  const ctx = await contextFor(workspaceId);
  await recordConversion(ctx, { name: req.body.name, path: String(req.body.path ?? "").slice(0, 200), source: String(req.body.source ?? "").slice(0, 80), medium: String(req.body.medium ?? "").slice(0, 80), campaign, content });
  res.status(204).end();
});

app.get("/api/conversions", async (req, res) => {
  const workspaceId = requireWorkspaceId(req, res);
  if (!workspaceId) return;
  const ctx = await contextFor(workspaceId);
  res.json(await getConversionSummary(ctx));
});

app.get("/api/events", (req, res) => {
  const workspaceId = requireWorkspaceId(req, res);
  if (!workspaceId) return;
  res.set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
  res.flushHeaders();
  const state = getRuntimeState(workspaceId);
  state.clients.add(res);
  for (const event of state.lastEvents) res.write(`data: ${JSON.stringify(event)}\n\n`);
  req.on("close", () => state.clients.delete(res));
});

app.get("/api/status", (req, res) => {
  const workspaceId = requireWorkspaceId(req, res);
  if (!workspaceId) return;
  const state = getRuntimeState(workspaceId);
  res.json({ running: state.running, lastEvents: state.lastEvents, runMode });
});

const AGENT_IDS: AgentId[] = ["pesquisa-mercado", "pesquisa-pauta", "redator", "editor-seo", "publicador", "instagram", "indexador"];
const AGENT_STATUSES: AgentStatus[] = ["idle", "working", "done", "error"];

function validIngestToken(req: express.Request): boolean {
  if (!config.panelIngestToken) return false;
  const received = Buffer.from(String(req.header("X-Panel-Ingest-Token") ?? ""));
  const expected = Buffer.from(config.panelIngestToken);
  return received.length === expected.length && timingSafeEqual(received, expected);
}

app.post("/api/events/ingest", express.json(), (req, res) => {
  if (!validIngestToken(req)) { res.status(401).json({ error: "Token de ingestão inválido." }); return; }

  const body = req.body ?? {};
  const workspaceId = String(body.workspaceId ?? "");
  if (!workspaceId || !AGENT_IDS.includes(body.agent) || !AGENT_STATUSES.includes(body.status) || typeof body.timestamp !== "string") {
    res.status(400).json({ error: "Evento inválido." });
    return;
  }

  const event: PipelineEvent = {
    agent: body.agent, status: body.status, timestamp: body.timestamp,
    ...(typeof body.message === "string" ? { message: body.message } : {}),
    ...(typeof body.tema === "string" ? { tema: body.tema } : {}),
  };

  const state = getRuntimeState(workspaceId);
  if (event.agent === "pesquisa-mercado" && event.status === "working") state.running = true;
  if (event.status === "error" || (event.agent === "indexador" && event.status === "done")) state.running = false;

  broadcast(workspaceId, event);
  res.status(204).end();
});

app.post("/api/run", express.json(), async (req, res) => {
  const workspaceId = String(req.body?.workspaceId ?? "");
  if (!workspaceId) { res.status(400).json({ error: "workspaceId é obrigatório." }); return; }
  const state = getRuntimeState(workspaceId);

  if (runMode === "disabled") {
    res.status(403).json({ error: "Execução manual desabilitada neste ambiente — a publicação roda pela GitHub Action." });
    return;
  }

  if (runMode === "dispatch") {
    if (state.dispatching) { res.status(409).json({ error: "Já disparei uma execução há pouco — aguarde." }); return; }
    state.dispatching = true;
    setTimeout(() => { state.dispatching = false; }, 60_000);
    try {
      await triggerDailyPostWorkflow(workspaceId);
      res.json({ ok: true, mode: "dispatch" });
    } catch (err) {
      state.dispatching = false;
      res.status(502).json({ error: err instanceof Error ? err.message : String(err) });
    }
    return;
  }

  if (state.running) { res.status(409).json({ error: "O pipeline já está rodando." }); return; }
  state.running = true;
  res.json({ ok: true, mode: "local" });

  try {
    await runPipeline(workspaceId, (event) => broadcast(workspaceId, event));
  } catch {
    // erro já foi transmitido como evento "error" pelo broadcast
  } finally {
    state.running = false;
  }
});

app.get("/api/history", async (req, res) => {
  const workspaceId = requireWorkspaceId(req, res);
  if (!workspaceId) return;
  res.json(await getHistory(await contextFor(workspaceId)));
});

app.get("/api/runs", async (req, res) => {
  const workspaceId = requireWorkspaceId(req, res);
  if (!workspaceId) return;
  res.json(await getRuns(await contextFor(workspaceId)));
});

app.get("/api/usage", async (req, res) => {
  const workspaceId = requireWorkspaceId(req, res);
  if (!workspaceId) return;
  const runs = await getRuns(await contextFor(workspaceId));
  const tracked = runs.filter((run) => run.usage);
  const now = new Date();
  const monthStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
  const published = tracked.filter((run) => run.status === "publicado");
  const monthRuns = tracked.filter((run) => new Date(run.finalizadoEm || run.iniciadoEm).getTime() >= monthStart);
  const sum = (items: typeof tracked, field: "estimatedUsd" | "inputTokens" | "outputTokens" | "webSearchRequests") =>
    items.reduce((total, run) => total + (run.usage?.[field] ?? 0), 0);

  res.json({
    trackedRuns: tracked.length,
    month: { estimatedUsd: sum(monthRuns, "estimatedUsd"), inputTokens: sum(monthRuns, "inputTokens"), outputTokens: sum(monthRuns, "outputTokens"), webSearchRequests: sum(monthRuns, "webSearchRequests") },
    total: { estimatedUsd: sum(tracked, "estimatedUsd"), inputTokens: sum(tracked, "inputTokens"), outputTokens: sum(tracked, "outputTokens"), webSearchRequests: sum(tracked, "webSearchRequests") },
    averagePublishedUsd: published.length ? sum(published, "estimatedUsd") / published.length : 0,
  });
});

app.get("/api/performance", async (req, res) => {
  const workspaceId = requireWorkspaceId(req, res);
  if (!workspaceId) return;
  res.json(await getPerformance(await contextFor(workspaceId)));
});

app.post("/api/performance/refresh", express.json(), async (req, res) => {
  const workspaceId = String(req.body?.workspaceId ?? "");
  if (!workspaceId) { res.status(400).json({ error: "workspaceId é obrigatório." }); return; }
  const state = getRuntimeState(workspaceId);
  if (state.refreshingPerf) { res.status(409).json({ error: "Já estou atualizando as métricas." }); return; }
  state.refreshingPerf = true;
  try {
    const ctx = await contextFor(workspaceId);
    const report = await refreshPerformance(ctx, req.body?.inicio, req.body?.fim);
    res.json(report);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const invalidPeriod = message.includes("data inicial") || message.includes("data final") || message.includes("formato AAAA-MM-DD");
    res.status(invalidPeriod ? 400 : 500).json({ error: message });
  } finally {
    state.refreshingPerf = false;
  }
});

app.listen(PORT, () => {
  console.log(`Escritório rodando em http://localhost:${PORT}`);
});
```

Note: the CORS header was `Access-Control-Allow-Origin: config.siteBaseUrl` before — that was NextAssist's own site origin. With N workspaces each having their own `integrations.siteUrl`, a single static origin no longer makes sense; this rewrite widens it to `*` for the API (it was already serving JSON, not credentialed cookies, so this doesn't newly expose anything sensitive). If tighter CORS is wanted later, it would need to echo back the requesting workspace's configured `siteUrl` after validating the `Origin` header against it — out of scope for this phase.

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS, no errors anywhere in `src/`.

- [ ] **Step 3: Manual smoke test**

Run: `npm run office`, then:
```bash
curl "http://localhost:4173/api/workspaces"
curl "http://localhost:4173/api/history?workspace=nextassist"
curl "http://localhost:4173/api/status?workspace=nextassist"
curl "http://localhost:4173/api/history"   # expect 400, missing ?workspace=
```
Expected: first three return `200` with JSON; the last returns `400` with the "Parâmetro ?workspace= é obrigatório." message.

- [ ] **Step 4: Commit**

```bash
git add src/server.ts
git commit -m "refactor: painel serve estado e SSE por workspace"
```

---

### Task 14: `web/public/app.js` — workspace selector

**Files:**
- Modify: `web/public/app.js`
- Modify: `web/public/index.html` (or wherever the selector's markup lives — check the file that currently renders the header/toolbar)

**Interfaces:**
- Consumes: `GET /api/workspaces` (Task 13).
- Produces: a `currentWorkspaceId()` helper that every existing fetch call in `app.js` (`loadHistory`, `loadRuns`... whatever the current function names are per `renderHistory`, `renderRuns`, `renderPerformance`, `renderUsage`, `loadUsage`, `loadConversions`, `loadPerformance`, `loadStatus`, `connectEvents`) appends as `?workspace=` (or `&workspace=` if the URL already has a query string).

- [ ] **Step 1: Read the current file to find every `fetch(` and `EventSource(` call**

```bash
grep -n "fetch(\|EventSource(" web/public/app.js
```

- [ ] **Step 2: Add a workspace-selection layer at the top of `app.js`**

```js
// web/public/app.js — add near the top, before any fetch/EventSource call runs
const WORKSPACE_STORAGE_KEY = "office.workspaceId";

function currentWorkspaceId() {
  const url = new URL(window.location.href);
  return url.searchParams.get("workspace") || localStorage.getItem(WORKSPACE_STORAGE_KEY) || "";
}

function setWorkspaceId(id) {
  localStorage.setItem(WORKSPACE_STORAGE_KEY, id);
  const url = new URL(window.location.href);
  url.searchParams.set("workspace", id);
  window.history.replaceState({}, "", url);
}

function withWorkspace(path) {
  const url = new URL(path, window.location.origin);
  url.searchParams.set("workspace", currentWorkspaceId());
  return url.pathname + url.search;
}

async function initWorkspaceSelector() {
  const res = await fetch("/api/workspaces");
  const workspaces = await res.json();
  const select = document.getElementById("workspace-select");
  select.innerHTML = workspaces.map((w) => `<option value="${w.id}">${w.name}</option>`).join("");

  let selected = currentWorkspaceId();
  if (!workspaces.some((w) => w.id === selected)) selected = workspaces[0]?.id ?? "";
  select.value = selected;
  setWorkspaceId(selected);

  select.addEventListener("change", () => {
    setWorkspaceId(select.value);
    window.location.reload(); // simplest correct behavior: re-init everything (SSE, history, etc.) for the new workspace
  });
}
```

Then, for every existing call site found in Step 1 that hits one of this app's own `/api/...` endpoints (not third-party URLs), wrap the path with `withWorkspace(...)`:

```js
// before
fetch("/api/history")
// after
fetch(withWorkspace("/api/history"))

// before
new EventSource("/api/events")
// after
new EventSource(withWorkspace("/api/events"))
```

Apply this to every one of `loadHistory`, `renderRuns`'s data fetch, `loadUsage`, `loadPerformance`, `loadConversions`, `loadStatus`, `connectEvents`, and the `POST /api/run` / `POST /api/performance/refresh` calls — the latter two send `workspaceId` in the JSON body instead (since Task 13's server reads it from `req.body`, not the query string, for POST routes): add `workspaceId: currentWorkspaceId()` to their `JSON.stringify({...})` payloads.

- [ ] **Step 3: Add the selector markup**

In whichever HTML file renders the page shell (find it: `grep -rn "id=\"floor\"\|<body" web/public/*.html`), add near the top of the toolbar/header:

```html
<select id="workspace-select" aria-label="Workspace"></select>
```

And call `initWorkspaceSelector()` before the rest of the page's init sequence (find the existing `DOMContentLoaded` or top-level init call in `app.js` and call `await initWorkspaceSelector();` as its first line).

- [ ] **Step 4: Manual smoke test**

Run: `npm run office`, open `http://localhost:4173/` in a browser. Expected: the workspace selector shows "NextAssist" (the only active workspace), the dashboard loads history/runs/performance exactly as before, and the URL gains `?workspace=nextassist`.

- [ ] **Step 5: Commit**

```bash
git add web/public/app.js web/public/*.html
git commit -m "feat: seletor de workspace no painel"
```

---

### Task 15: GitHub Action — matrix per workspace, per-workspace concurrency and Environment

**Files:**
- Modify: `.github/workflows/daily-post.yml`

**Interfaces:**
- Consumes: `workspaces/*/workspace.json`'s `active` field (Task 1/5); `runPipeline` reads `WORKSPACE_ID` (Task 11).

- [ ] **Step 1: Rewrite the workflow**

```yaml
name: Post diário do blog

on:
  schedule:
    - cron: "18 13 * * *" # 10:18 BRT
  workflow_dispatch:
    inputs:
      workspace_id:
        description: "Rodar só este workspace (vazio = todos os ativos)"
        required: false
        type: string

permissions:
  contents: write

jobs:
  list-workspaces:
    runs-on: ubuntu-latest
    outputs:
      workspaces: ${{ steps.list.outputs.workspaces }}
    steps:
      - uses: actions/checkout@v4
      - id: list
        run: |
          if [ -n "${{ github.event.inputs.workspace_id }}" ]; then
            echo "workspaces=[\"${{ github.event.inputs.workspace_id }}\"]" >> "$GITHUB_OUTPUT"
          else
            ids=$(for f in workspaces/*/workspace.json; do
              active=$(jq -r '.active' "$f")
              if [ "$active" = "true" ]; then jq -r '.id' "$f"; fi
            done | jq -R . | jq -sc .)
            echo "workspaces=$ids" >> "$GITHUB_OUTPUT"
          fi

  publish:
    needs: list-workspaces
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false
      matrix:
        workspace: ${{ fromJson(needs.list-workspaces.outputs.workspaces) }}
    environment: ${{ matrix.workspace }}
    concurrency:
      group: daily-post-${{ matrix.workspace }}
      cancel-in-progress: false
    steps:
      - name: Checkout do repositório
        uses: actions/checkout@v4

      - name: Configurar Node.js
        uses: actions/setup-node@v4
        with:
          node-version: "22"
          cache: "npm"

      - name: Instalar dependências
        run: npm ci

      - name: Rodar pipeline (gera e publica o post do dia)
        env:
          WORKSPACE_ID: ${{ matrix.workspace }}
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
          FIREBASE_WEB_API_KEY: ${{ secrets.FIREBASE_WEB_API_KEY }}
          FIREBASE_ADMIN_EMAIL: ${{ secrets.FIREBASE_ADMIN_EMAIL }}
          FIREBASE_ADMIN_PASSWORD: ${{ secrets.FIREBASE_ADMIN_PASSWORD }}
          FIREBASE_SERVICE_ACCOUNT_JSON: ${{ secrets.FIREBASE_SERVICE_ACCOUNT_JSON }}
          FIREBASE_STORAGE_BUCKET: ${{ secrets.FIREBASE_STORAGE_BUCKET }}
          IG_USER_ID: ${{ secrets.IG_USER_ID }}
          IG_ACCESS_TOKEN: ${{ secrets.IG_ACCESS_TOKEN }}
          GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY }}
          GEMINI_API_KEY_FALLBACK: ${{ secrets.GEMINI_API_KEY_FALLBACK }}
          PANEL_INGEST_URL: ${{ secrets.PANEL_INGEST_URL }}
          PANEL_INGEST_TOKEN: ${{ secrets.PANEL_INGEST_TOKEN }}
        run: npm run run

      - name: Commitar estado atualizado (calendário, histórico e execuções)
        if: always()
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git add "workspaces/${{ matrix.workspace }}"/*.json
          if git diff --staged --quiet; then
            echo "Nada mudou no estado — nenhum commit necessário."
          else
            git commit -m "chore: registro de execução do pipeline (${{ matrix.workspace }}) [skip ci]"

            for tentativa in 1 2 3; do
              echo "Tentativa ${tentativa} de publicar o estado..."
              if git pull --rebase origin main; then
                if git push origin HEAD:main; then
                  exit 0
                fi
              else
                if git diff --name-only --diff-filter=U | grep -qx "workspaces/${{ matrix.workspace }}/runs-history.json"; then
                  git show :2:"workspaces/${{ matrix.workspace }}/runs-history.json" > /tmp/runs-remote.json
                  git show :3:"workspaces/${{ matrix.workspace }}/runs-history.json" > /tmp/runs-local.json
                  jq -s 'add | unique_by(.id) | sort_by(.iniciadoEm) | reverse | .[:100]' /tmp/runs-remote.json /tmp/runs-local.json > "workspaces/${{ matrix.workspace }}/runs-history.json"
                  git add "workspaces/${{ matrix.workspace }}/runs-history.json"
                  GIT_EDITOR=true git -c core.editor=true rebase --continue
                else
                  git rebase --abort || true
                fi
              fi
              sleep 5
            done

            echo "Não foi possível publicar o estado após 3 tentativas."
            exit 1
          fi
```

Notes: `AI_PROVIDER_PRIMARY`/`OPENAI_MODEL` env vars are gone from the step — `buildWorkspaceContext` (Task 4) now picks the primary provider from which key exists, and the model is a `buildWorkspaceContext` option, not an env var, in this phase (hardcoded defaults `"claude-sonnet-5"` / `"gpt-5.6"` — no workspace needed a different model yet, and adding a `models` field to `workspace.json` before it's needed would be scope creep for this phase). `IMAGE_GEN_API_KEY`/`IMAGE_GEN_PROVIDER` are gone too — Task 8's `imageGen.ts` reads `OPENAI_API_KEY` directly, matching the single-provider simplification made there.

- [ ] **Step 2: Set up the GitHub Environment**

In the repo's Settings → Environments, create an environment named `nextassist` and move the existing repo-level secrets (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `FIREBASE_*`, `IG_*`, `GEMINI_*`) into it. `PANEL_INGEST_URL`/`PANEL_INGEST_TOKEN` can stay as plain repo secrets (they're referenced without `environment:` scoping anywhere else, and their value isn't workspace-specific) — but since the `publish` job now runs under `environment: nextassist`, repo-level secrets remain visible to it either way, so this is only a cleanliness note, not a functional requirement.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/daily-post.yml
git commit -m "ci: Action roda em matrix por workspace, com Environment e lock proprios"
```

---

### Task 16: `config.ts` — strip to app-level settings only

**Files:**
- Modify: `src/config.ts`
- Modify: `.env.example`

**Interfaces:**
- Produces: `config` retains only `dataSource`, `githubRepo`, `githubBranch`, `githubToken`, `githubDispatchToken`, `panelPassword`, `panelIngestUrl`, `panelIngestToken`. Everything else (AI keys/models, blog/site URLs, Firebase, Search Console, Instagram, Gemini, image gen, `requireApproval`, `demoPath`) is deleted — it now lives in `workspace.json` or is resolved via `SecretProvider`.

This task runs last (not earlier) because every other task's code already stopped reading the fields being deleted here — deleting them earlier would have broken the build for files not yet migrated.

- [ ] **Step 1: Grep for any remaining reference to the fields being removed**

```bash
grep -rn "config\.\(anthropicApiKey\|anthropicModel\|openaiApiKey\|openaiModel\|aiPrimaryProvider\|blogApiUrl\|blogAutor\|siteBaseUrl\|searchConsoleSiteUrl\|sitemapUrl\|firebase\|imageGen\|instagram\.\|geminiApiKey\|geminiVeoModel\|requireApproval\|demoPath\)" src/
```

Expected: no matches (Tasks 6-13 already removed every call site). If any turn up, fix that file before proceeding — it's a leftover this plan missed.

- [ ] **Step 2: Rewrite `config.ts`**

```ts
// src/config.ts
import "dotenv/config";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Variável de ambiente obrigatória ausente: ${name}`);
  return value;
}

export const config = {
  // De onde o painel lê os arquivos de estado (histórico, execuções):
  //  - "local": lê do disco (rodando na sua máquina após um git pull)
  //  - "github": busca os arquivos crus do repositório (painel hospedado,
  //    que não recebe os commits da Action diretamente)
  dataSource: (process.env.DATA_SOURCE ?? "local") as "local" | "github",
  githubRepo: process.env.GITHUB_REPO ?? "cleberfarias/NextAssist-blog-Automation",
  githubBranch: process.env.GITHUB_BRANCH ?? "main",
  githubToken: process.env.PANEL_GITHUB_TOKEN ?? process.env.GITHUB_TOKEN ?? "",
  // Token separado, só com permissão de disparar Actions (actions:write).
  // Usado pelo botão "Rodar pipeline agora" do painel hospedado.
  githubDispatchToken: process.env.GITHUB_DISPATCH_TOKEN ?? "",
  // Senha do painel (Basic Auth). Vazio = sem proteção (ok localmente).
  panelPassword: process.env.PANEL_PASSWORD ?? "",
  // URL/token do endpoint de ingestão de eventos do painel hospedado (usado
  // pela Action pra empurrar o progresso do pipeline em tempo real).
  panelIngestUrl: process.env.PANEL_INGEST_URL ?? "",
  panelIngestToken: process.env.PANEL_INGEST_TOKEN ?? "",
};

export { required };
```

`required` is exported in case a future app-level (non-workspace) setting needs it — currently unused outside this file, so this export can also just be removed if `tsc` flags it as dead; keep it only if something still imports it (grep first: `grep -rn "required.*from \"\.\./\?config.js\"\|import.*required.*config" src/`).

- [ ] **Step 3: Update `.env.example`**

Remove the now-workspace-owned variables (`ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, `OPENAI_API_KEY`, `OPENAI_MODEL`, `AI_PROVIDER_PRIMARY`, `BLOG_API_URL`, `BLOG_AUTOR`, `SITE_BASE_URL`, `SEARCH_CONSOLE_SITE_URL`, `SITEMAP_URL`, `FIREBASE_*`, `IMAGE_GEN_*`, `IG_*`, `GEMINI_*`, `REQUIRE_APPROVAL`, `DEMO_PATH`) and add a note pointing at the new location:

```
# Segredos de workspace (chaves de IA, Firebase, Instagram, Gemini, etc.)
# não vivem mais aqui — veja workspaces/<id>/workspace.json para a config
# não-secreta, e prefixe a variável de ambiente com o id do workspace em
# maiúsculas (ex: NEXTASSIST_OPENAI_API_KEY). Sem prefixo funciona como
# fallback quando só existe um workspace configurado localmente.

# --- App-level (não depende de workspace) ---
DATA_SOURCE=local
GITHUB_REPO=cleberfarias/NextAssist-blog-Automation
GITHUB_BRANCH=main
GITHUB_DISPATCH_TOKEN=
PANEL_PASSWORD=
PANEL_INGEST_URL=
PANEL_INGEST_TOKEN=
```

- [ ] **Step 4: Update local `.env`**

For local dev, keep secret values under their unprefixed names (`ANTHROPIC_API_KEY=...`, `OPENAI_API_KEY=...`, etc.) — `EnvSecretProvider`'s fallback (Task 2) resolves them for the single `nextassist` workspace without needing the `NEXTASSIST_` prefix. Remove the now-unused non-secret values that moved into `workspaces/nextassist/workspace.json` (`BLOG_API_URL`, `SITE_BASE_URL`, etc.) from `.env` — they'd be silently ignored now, which is confusing to leave in place.

- [ ] **Step 5: Full verification**

Run: `npm run build && npm test`
Expected: both PASS — this is the point where the whole migration should compile and test clean end-to-end.

Run: `WORKSPACE_ID=nextassist npm run run` (needs a real `.env` with valid credentials)
Expected: behaves identically to before this plan — publishes (or drafts) the next pending topic from `workspaces/nextassist/content-calendar.json`, appends to `workspaces/nextassist/runs-history.json`.

- [ ] **Step 6: Commit**

```bash
git add src/config.ts .env.example
git commit -m "refactor: config.ts vira configuracao so de aplicacao"
```

---

### Task 17: End-to-end smoke test (manual, no code changes)

**Files:** none — verification only.

- [ ] **Step 1: Pipeline smoke test**

Run: `WORKSPACE_ID=nextassist npm run run`
Confirm: console logs show `[nextassist][pesquisa-mercado]...` through `[nextassist][indexador]...`; `workspaces/nextassist/runs-history.json` gains a new entry with `usage` populated (non-zero tokens); if the calendar had a pending topic, `workspaces/nextassist/content-calendar.json`'s matching entry becomes `publicado: true`.

- [ ] **Step 2: Dashboard smoke test**

Run: `npm run office`, open `http://localhost:4173/`.
Confirm: workspace selector shows "NextAssist" and is selected by default; history/runs/performance panels populate from `workspaces/nextassist/*.json`; clicking "Rodar pipeline agora" (if `runMode` is `local` in this environment) starts a run and the office desks light up via SSE in real time.

- [ ] **Step 3: Multi-workspace isolation check**

Create a throwaway second workspace to confirm isolation, then discard it:
```bash
mkdir -p workspaces/_smoketest
cp workspaces/nextassist/workspace.json workspaces/_smoketest/workspace.json
node --import tsx -e "
import('node:fs/promises').then(async (fs) => {
  const w = JSON.parse(await fs.readFile('workspaces/_smoketest/workspace.json', 'utf-8'));
  w.id = '_smoketest'; w.name = 'Smoke Test'; w.active = false; // inactive: won't be picked up by the Action matrix
  await fs.writeFile('workspaces/_smoketest/workspace.json', JSON.stringify(w, null, 2));
});
"
curl "http://localhost:4173/api/workspaces"   # expect only nextassist (smoketest is active:false)
rm -rf workspaces/_smoketest
```
Confirm: `/api/workspaces` never lists `_smoketest` (proves `listWorkspaces()`'s `active` filter works), and no file under `workspaces/nextassist/` was touched by creating the second folder (proves path isolation).

- [ ] **Step 4: Report results**

No commit for this task — if all three checks pass, the phase is done. If anything fails, go back to the task that owns the broken behavior and fix it there (don't patch around it in this task).
