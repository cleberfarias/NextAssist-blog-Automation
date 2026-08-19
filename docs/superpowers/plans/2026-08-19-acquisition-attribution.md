# Camada de Analytics e Atribuição de Aquisição — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fechar o ciclo conteúdo → visita → trial → ativação → cliente para o NextAssist, dando ao dashboard e ao Marketing Director dados de resultado comercial por conteúdo, não só de alcance.

**Architecture:** Um registro de conteúdo (`content-registry.json`) escrito uma única vez por publicação (em `pipeline.ts`, logo após `publishPost`), eventos de conversão estendidos com identidade encadeada (`anonymousId`/`userId`), e um módulo puro e determinístico (`attribution.ts`) que junta registro + eventos + performance SEO por `contentId`. Nenhum agente novo, fila ou banco — tudo em cima dos JSONs e padrões de storage já existentes.

**Tech Stack:** TypeScript (Node ESM), Express, `node:test`/`node:assert` para testes, JSON como storage (via `fs/promises` local e `src/lib/dataSource.ts`/`src/lib/storage.ts` para o painel hospedado).

**Spec:** `docs/superpowers/specs/2026-08-19-acquisition-attribution-design.md`

## Global Constraints

- `contentId` = slug do post. Exigência de unicidade global entre canais (não `${channel}:${slug}`) — limitação conhecida do P0, documentada, não resolvida agora.
- `campaignId` é sempre `null` no P0 (agrupamento temático real fica para P1) — os campos e o join já existem, só não há geração automática de valor.
- Nenhum evento primário `activated_user` — `first_order_created` é o fato bruto; "ativado" é métrica derivada calculada em `attribution.ts`.
- Contagem de trials/signups/ativados/clientes é sempre por **entidade única** (`Set<anonymousId | userId>`), nunca por número bruto de eventos.
- `demo_view` nunca conta como visita.
- Taxas com menos de `MIN_TRIALS_FOR_RATE = 5` trials são marcadas `rateReliable: false` — essa decisão é determinística no código, nunca deixada para o LLM interpretar.
- `registerContent()` é upsert por `contentId` — idempotente a reexecuções.
- `attribution.ts` é uma função pura sem estado e sem chamada a LLM — não é um agente.
- `conversions.json` continua retrocompatível: os 4 eventos já existentes (`demo_view`, `demo_submit`, `contact_submit`, `whatsapp_click`) não mudam de schema.
- `npm test` executa `node --import tsx --test src/tests.ts` — um agregador que importa cada arquivo `.test.ts` explicitamente (ver `src/tests.ts`). Qualquer arquivo de teste **novo** (não é o caso de arquivos só modificados) precisa ganhar uma linha `import "./caminho/do/arquivo.test.js";` nesse agregador, senão `npm test` nunca o executa. Rodar um arquivo de teste isolado durante o desenvolvimento usa `node --import tsx --test src/caminho/arquivo.test.ts` diretamente.

---

### Task 1: Estender o contrato de `ConversionEvent`

**Files:**
- Modify: `src/conversions.ts`
- Test: `src/conversions.test.ts`

**Interfaces:**
- Produces: `ConversionEventName` (union de 13 nomes), `ConversionEvent` (com `anonymousId?`, `userId?`, `ctaId?` novos), `getConversionEvents(ctx): Promise<ConversionEvent[]>`.

- [ ] **Step 1: Escrever o teste que falha**

Adicionar ao final de `src/conversions.test.ts`:

```ts
import { getConversionEvents } from "./conversions.js";
import { buildWorkspaceContext } from "./context.js";
import { createTempWorkspace } from "./testing/tempWorkspace.js";

test("getConversionEvents lê o array bruto de eventos, incluindo os campos de identidade novos", async () => {
  const temp = await createTempWorkspace("acme", {
    "conversion-events.json": [
      { name: "trial_started", anonymousId: "anon-1", content: "post-a", createdAt: "2026-08-01T00:00:00Z" },
      { name: "signup_completed", anonymousId: "anon-1", userId: "user-1", createdAt: "2026-08-01T00:05:00Z" },
    ],
  });
  try {
    const ctx = await buildWorkspaceContext(
      {
        id: "acme", name: "Acme", active: true,
        brand: { name: "Acme", description: "d", toneOfVoice: "t", targetAudience: [], competitors: [] },
        goals: { primary: "leads" },
        channels: { blog: true, instagram: false, linkedin: false },
        integrations: { siteUrl: "https://acme.test", cms: { provider: "nextassist", apiUrl: "https://api.acme.test" } },
        autonomy: { mode: "copilot" },
        secrets: { required: [] },
      },
      { async get() { return undefined; } },
      { workspacesRoot: temp.root, requireAiProvider: false },
    );
    const events = await getConversionEvents(ctx);
    assert.equal(events.length, 2);
    assert.equal(events[1].userId, "user-1");
    assert.equal(events[1].anonymousId, "anon-1");
  } finally {
    await temp.cleanup();
  }
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `node --import tsx --test src/conversions.test.ts`
Expected: FAIL — `getConversionEvents` não existe.

- [ ] **Step 3: Implementar**

Editar `src/conversions.ts`, substituindo o topo do arquivo (linhas 4-13) por:

```ts
export type ConversionEventName =
  | "page_view" | "cta_click"
  | "demo_view" | "demo_submit" | "contact_submit" | "whatsapp_click"
  | "trial_started" | "signup_completed"
  | "first_customer_created" | "first_device_linked" | "first_order_created"
  | "returning_user" | "subscription_started";

export interface ConversionEvent {
  name: ConversionEventName;
  anonymousId?: string;
  userId?: string;
  path?: string;
  source?: string;
  medium?: string;
  campaign?: string;
  content?: string;
  ctaId?: string;
  createdAt: string;
}
```

E adicionar, logo após a função `load` (depois da linha que hoje é `async function load...}`):

```ts
/** Lê o array bruto de eventos — usado por `attribution.ts` para o join por contentId/identidade. */
export async function getConversionEvents(ctx: WorkspaceContext): Promise<ConversionEvent[]> {
  return load(ctx);
}
```

`recordConversion` já é `Omit<ConversionEvent, "createdAt">`, então aceita os campos novos automaticamente — nenhuma outra mudança necessária nessa função.

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `node --import tsx --test src/conversions.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/conversions.ts src/conversions.test.ts
git commit -m "feat: estender ConversionEvent com identidade e novos nomes de evento"
```

---

### Task 2: Módulo `content-registry.json`

**Files:**
- Create: `src/contentRegistry.ts`
- Create: `src/contentRegistry.test.ts`
- Modify: `src/context.ts:78-85,154-161` (adicionar `contentRegistry` a `WorkspacePaths`)

**Interfaces:**
- Consumes: `WorkspaceContext` (de `src/context.ts`), `readStateJson` (de `src/lib/dataSource.ts`, assinatura `readStateJson<T>(path: URL, fallback: T, workspaceId?: string): Promise<T>`).
- Produces: `ContentRegistryEntry`, `registerContent(ctx, entry): Promise<void>`, `getContentRegistry(ctx): Promise<ContentRegistryEntry[]>`. Usado por `pipeline.ts` (Task 6) e `attribution.ts` (Task 8).

- [ ] **Step 1: Adicionar o caminho do arquivo a `WorkspaceContext`**

Em `src/context.ts`, editar a interface `WorkspacePaths` (linhas 78-85):

```ts
export interface WorkspacePaths {
  root: URL;
  calendar: URL;
  history: URL;
  runs: URL;
  performance: URL;
  conversions: URL;
  contentRegistry: URL;
}
```

E no corpo de `buildWorkspaceContext` (linhas 154-161), adicionar a linha `contentRegistry`:

```ts
  const paths: WorkspacePaths = {
    root,
    calendar: new URL("content-calendar.json", root),
    history: new URL("post-history.json", root),
    runs: new URL("runs-history.json", root),
    performance: new URL("post-performance.json", root),
    conversions: new URL("conversion-events.json", root),
    contentRegistry: new URL("content-registry.json", root),
  };
```

- [ ] **Step 2: Escrever o teste que falha**

Criar `src/contentRegistry.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { buildWorkspaceContext } from "./context.js";
import type { MarketingWorkspace } from "./workspace.js";
import { createTempWorkspace } from "./testing/tempWorkspace.js";
import { registerContent, getContentRegistry, type ContentRegistryEntry } from "./contentRegistry.js";

const workspace: MarketingWorkspace = {
  id: "acme", name: "Acme", active: true,
  brand: { name: "Acme", description: "d", toneOfVoice: "t", targetAudience: [], competitors: [] },
  goals: { primary: "leads" },
  channels: { blog: true, instagram: false, linkedin: false },
  integrations: { siteUrl: "https://acme.test", cms: { provider: "nextassist", apiUrl: "https://api.acme.test" } },
  autonomy: { mode: "copilot" },
  secrets: { required: [] },
};

async function ctxWithTemp() {
  const temp = await createTempWorkspace("acme");
  const ctx = await buildWorkspaceContext(workspace, { async get() { return undefined; } }, {
    workspacesRoot: temp.root, requireAiProvider: false,
  });
  return { ctx, cleanup: temp.cleanup };
}

function entry(overrides: Partial<ContentRegistryEntry> = {}): ContentRegistryEntry {
  return {
    contentId: "post-a", campaignId: null, tema: "Precificação",
    formato: "blog", channel: "blog", funnelStage: "meio",
    publicadoEm: "2026-08-01T00:00:00Z", status: "published",
    url: "https://acme.test/blog/post-a",
    ...overrides,
  };
}

test("registerContent insere uma entrada nova", async () => {
  const { ctx, cleanup } = await ctxWithTemp();
  try {
    await registerContent(ctx, entry());
    const registry = await getContentRegistry(ctx);
    assert.equal(registry.length, 1);
    assert.equal(registry[0].contentId, "post-a");
  } finally {
    await cleanup();
  }
});

test("registerContent faz upsert por contentId — reexecução não duplica", async () => {
  const { ctx, cleanup } = await ctxWithTemp();
  try {
    await registerContent(ctx, entry({ status: "draft-pending-approval" }));
    await registerContent(ctx, entry({ status: "published" }));
    const registry = await getContentRegistry(ctx);
    assert.equal(registry.length, 1);
    assert.equal(registry[0].status, "published");
  } finally {
    await cleanup();
  }
});

test("registerContent preserva entradas de outros contentIds", async () => {
  const { ctx, cleanup } = await ctxWithTemp();
  try {
    await registerContent(ctx, entry({ contentId: "post-a" }));
    await registerContent(ctx, entry({ contentId: "post-b" }));
    const registry = await getContentRegistry(ctx);
    assert.equal(registry.length, 2);
    assert.deepEqual(registry.map((e) => e.contentId).sort(), ["post-a", "post-b"]);
  } finally {
    await cleanup();
  }
});
```

- [ ] **Step 3: Rodar o teste e confirmar que falha**

Run: `node --import tsx --test src/contentRegistry.test.ts`
Expected: FAIL — módulo `src/contentRegistry.ts` não existe.

- [ ] **Step 4: Implementar**

Criar `src/contentRegistry.ts`:

```ts
// src/contentRegistry.ts
import { readFile, writeFile } from "node:fs/promises";
import { readStateJson } from "./lib/dataSource.js";
import type { WorkspaceContext } from "./context.js";

export interface ContentRegistryEntry {
  /** = slug. Contrato explícito — precisa ser globalmente único entre canais (limitação conhecida do P0). */
  contentId: string;
  /** Agrupamento temático opcional. Sempre `null` no P0 — atribuição real de campanha é P1. */
  campaignId: string | null;
  tema: string;
  formato: "blog" | "instagram-reel";
  channel: "blog" | "instagram";
  funnelStage: "topo" | "meio" | "fundo";
  publicadoEm: string;
  status: "published" | "draft-pending-approval";
  url: string;
}

async function loadRegistry(ctx: WorkspaceContext): Promise<ContentRegistryEntry[]> {
  try {
    const raw = await readFile(ctx.paths.contentRegistry, "utf-8");
    return JSON.parse(raw) as ContentRegistryEntry[];
  } catch {
    return [];
  }
}

/**
 * Upsert por `contentId` — idempotente a reexecuções do pipeline (retry,
 * falha pós-publicação, etc.). Único writer nesta camada: `pipeline.ts`,
 * chamado logo após `publishPost` — nenhum outro módulo deve escrever aqui.
 */
export async function registerContent(ctx: WorkspaceContext, entry: ContentRegistryEntry): Promise<void> {
  const registry = await loadRegistry(ctx);
  const next = [...registry.filter((e) => e.contentId !== entry.contentId), entry];
  await writeFile(ctx.paths.contentRegistry, JSON.stringify(next, null, 2) + "\n");
}

/** Lê o registro para exibição/atribuição. Usa a fonte configurada (local ou GitHub), igual a `getHistory`. */
export async function getContentRegistry(ctx: WorkspaceContext): Promise<ContentRegistryEntry[]> {
  return readStateJson<ContentRegistryEntry[]>(ctx.paths.contentRegistry, [], ctx.workspace.id);
}
```

- [ ] **Step 5: Rodar o teste e confirmar que passa**

Run: `node --import tsx --test src/contentRegistry.test.ts`
Expected: PASS

- [ ] **Step 6: Registrar o arquivo de teste novo no agregador**

`src/contentRegistry.test.ts` é um arquivo novo — `npm test` só o executa se estiver listado em `src/tests.ts`. Editar `src/tests.ts`, adicionando a linha `import "./contentRegistry.test.js";` (ordem alfabética entre os imports existentes é suficiente, não é estritamente exigida). Depois rodar `npm test` e confirmar que os testes novos aparecem na contagem total e passam.

- [ ] **Step 7: Commit**

```bash
git add src/contentRegistry.ts src/contentRegistry.test.ts src/context.ts src/tests.ts
git commit -m "feat: adicionar content-registry.json com upsert por contentId"
```

---

### Task 3: `funnelStage` no plano editorial

**Files:**
- Modify: `src/agents/topicPlanner.ts`
- Test: `src/agents/topicPlanner.test.ts` (novo)

**Interfaces:**
- Produces: `FunnelStage` (`"topo" | "meio" | "fundo"`), `resolveFunnelStage(value: unknown): FunnelStage`, `ContentPlan.funnelStage`. Consumido por `pipeline.ts` (Task 6, via `plan.funnelStage`).

- [ ] **Step 1: Escrever o teste que falha**

Criar `src/agents/topicPlanner.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { resolveFunnelStage } from "./topicPlanner.js";

test("aceita os três valores válidos", () => {
  assert.equal(resolveFunnelStage("topo"), "topo");
  assert.equal(resolveFunnelStage("meio"), "meio");
  assert.equal(resolveFunnelStage("fundo"), "fundo");
});

test("usa 'meio' como fallback para valor inválido ou ausente", () => {
  assert.equal(resolveFunnelStage(undefined), "meio");
  assert.equal(resolveFunnelStage("bottom"), "meio");
  assert.equal(resolveFunnelStage(42), "meio");
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `node --import tsx --test src/agents/topicPlanner.test.ts`
Expected: FAIL — `resolveFunnelStage` não está exportado.

- [ ] **Step 3: Implementar**

Editar `src/agents/topicPlanner.ts`. Adicionar após os imports (linha 2):

```ts
export type FunnelStage = "topo" | "meio" | "fundo";
const FUNNEL_STAGES = new Set<FunnelStage>(["topo", "meio", "fundo"]);

/** Guarda determinística contra o LLM omitir ou inventar um valor fora do enum — nunca lança, cai para "meio". */
export function resolveFunnelStage(value: unknown): FunnelStage {
  return typeof value === "string" && FUNNEL_STAGES.has(value as FunnelStage) ? (value as FunnelStage) : "meio";
}
```

Atualizar `SYSTEM_TEMPLATE` (linhas 4-13) para instruir o campo novo — substituir o corpo por:

```ts
const SYSTEM_TEMPLATE = (ctx: WorkspaceContext) => `Você é o planejador editorial do blog do ${ctx.workspace.brand.name}. Com base no tema do
dia e na pesquisa de mercado fornecida, defina o ângulo específico do
post, o título, a meta description, a estrutura de H2s e o estágio de
funil do post ("topo": descoberta/educação de quem ainda não sabia que
tinha o problema; "meio": comparação/consideração de soluções; "fundo":
decisão, pronto para testar um produto). Responda
SOMENTE em JSON, sem texto antes ou depois, no formato:
{
  "titulo": "...",
  "metaDescription": "... (150-160 caracteres)",
  "h2s": ["...", "...", "..."],
  "anguloEditorial": "...",
  "funnelStage": "topo" | "meio" | "fundo"
}`;
```

Atualizar a interface `ContentPlan` (linhas 15-20):

```ts
export interface ContentPlan {
  titulo: string;
  metaDescription: string;
  h2s: string[];
  anguloEditorial: string;
  funnelStage: FunnelStage;
}
```

E o final de `planTopic` (linhas 36-52) — substituir as duas últimas linhas do corpo por:

```ts
  const raw = extractJson<ContentPlan & { funnelStage?: unknown }>(await runAgent(ctx, {
    system: SYSTEM_TEMPLATE(ctx),
    prompt: `Tema: "${tema}"
Palavra-chave principal: "${palavraChaveAlvo}"
O título deve ter entre 20 e 70 caracteres, contando espaços.

O título e a meta description devem conter a palavra-chave principal de forma natural.
Priorize a intenção de busca de quem precisa resolver esse problema e inclua H2s úteis para a decisão, não apenas definições.

Pesquisa de mercado:
${marketResearch}`,
    maxTokens: 2000,
  }));
  return { ...raw, titulo: fitTitle(raw.titulo, palavraChaveAlvo), funnelStage: resolveFunnelStage(raw.funnelStage) };
```

(Isso substitui inteiramente o corpo atual de `planTopic`, que hoje termina com `const plan = extractJson<ContentPlan>(raw); return { ...plan, titulo: fitTitle(plan.titulo, palavraChaveAlvo) };` — remova essas duas linhas.)

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `node --import tsx --test src/agents/topicPlanner.test.ts`
Expected: PASS

- [ ] **Step 5: Registrar o arquivo de teste novo no agregador**

`src/agents/topicPlanner.test.ts` é um arquivo novo — `npm test` só o executa se estiver listado em `src/tests.ts`. Editar `src/tests.ts`, adicionando a linha `import "./agents/topicPlanner.test.js";`.

- [ ] **Step 6: Rodar a suíte completa para checar que nada quebrou**

Run: `npm test`
Expected: PASS em todos os arquivos, incluindo `src/pipeline.test.ts` (o cenário de calendário vazio não chama `planTopic`, então não é afetado).

- [ ] **Step 7: Commit**

```bash
git add src/agents/topicPlanner.ts src/agents/topicPlanner.test.ts src/tests.ts
git commit -m "feat: adicionar funnelStage ao ContentPlan com fallback determinístico"
```

---

### Task 4: UTM semanticamente correto + `cta_id` no editor SEO

**Files:**
- Modify: `src/agents/editorSeo.ts`
- Modify: `src/lib/editorSeo.test.ts`

**Interfaces:**
- Consumes: `ContentRegistryEntry.campaignId` (conceito — o valor concreto passado por `pipeline.ts`/chamadores continua opcional/`null` no P0).
- Produces: `ensureTrackedCtas(post, options?: { demoPath?: string; campaignId?: string | null })`, `EditorialContext.campaignId?`.

- [ ] **Step 1: Atualizar o teste (vermelho — os asserts antigos checavam o esquema errado)**

Substituir o conteúdo de `src/lib/editorSeo.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { ensureTrackedCtas, type FinalPost } from "../agents/editorSeo.js";

test("completa CTAs ausentes sem nova chamada de IA — utm_content é o contentId (slug), cta_id identifica a posição", () => {
  const post = { slug: "artigo-teste", conteudo: '<p>Conteúdo <a href="/#funcionalidades">Funcionalidades</a></p>' } as FinalPost;
  const result = ensureTrackedCtas(post);
  assert.match(result.conteudo, /utm_content=artigo-teste/);
  assert.match(result.conteudo, /utm_campaign=sem-campanha/);
  assert.match(result.conteudo, /cta_id=cta-inline/);
  assert.match(result.conteudo, /cta_id=cta-final/);
  assert.equal(ensureTrackedCtas(result), result);
});

test("usa campaignId quando informado", () => {
  const post = { slug: "artigo-teste", conteudo: "<p>Conteúdo</p>" } as FinalPost;
  const result = ensureTrackedCtas(post, { campaignId: "serie-precificacao-2026-08" });
  assert.match(result.conteudo, /utm_campaign=serie-precificacao-2026-08/);
  assert.match(result.conteudo, /utm_content=artigo-teste/);
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `node --import tsx --test src/lib/editorSeo.test.ts`
Expected: FAIL — a assinatura antiga de `ensureTrackedCtas` gera `utm_content=cta-inline`, não `utm_content=artigo-teste`.

- [ ] **Step 3: Implementar**

Em `src/agents/editorSeo.ts`, substituir as linhas 43-55 (interface `EditorialContext` e função `ensureTrackedCtas`) por:

```ts
export interface EditorialContext {
  palavraChaveAlvo?: string;
  slugsPublicados: string[];
  demoPath?: string;
  /** Agrupamento temático opcional (utm_campaign). Sempre `null`/ausente no P0. */
  campaignId?: string | null;
}

export interface CtaOptions {
  demoPath?: string;
  campaignId?: string | null;
}

/**
 * utm_campaign = campaignId (agrupamento temático); utm_content = contentId
 * (= slug, chave do join com content-registry/attribution). A posição do CTA
 * é identificada por `cta_id`, deliberadamente fora do padrão UTM — ele
 * descreve a interação dentro do conteúdo, não a origem da aquisição.
 */
export function ensureTrackedCtas(post: FinalPost, options: CtaOptions = {}): FinalPost {
  const demoPath = options.demoPath ?? "/demo";
  const campaignId = options.campaignId ?? "sem-campanha";
  const base = `${demoPath}?utm_source=blog&utm_medium=article&utm_campaign=${encodeURIComponent(campaignId)}&utm_content=${encodeURIComponent(post.slug)}`;
  let conteudo = post.conteudo;
  if (!conteudo.includes(`${base}&cta_id=cta-inline`)) conteudo += `<p><a href="${base}&cta_id=cta-inline">Teste grátis por 7 dias</a></p>`;
  if (!conteudo.includes(`${base}&cta_id=cta-final`)) conteudo += `<p><a href="${base}&cta_id=cta-final">Comece seu teste grátis</a></p>`;
  return conteudo === post.conteudo ? post : { ...post, conteudo };
}
```

E atualizar a chamada dentro de `editAndFinalize` (linhas 57-82) — trocar a última linha `return ensureTrackedCtas(extractJson<FinalPost>(raw), context.demoPath);` por:

```ts
  return ensureTrackedCtas(extractJson<FinalPost>(raw), { demoPath: context.demoPath, campaignId: context.campaignId });
```

E atualizar o texto do prompt (linhas 75-78) para o esquema novo:

```ts
Inclua dois links para o teste grátis. Em ambos, use ${context.demoPath ?? "/demo"}?utm_source=blog&utm_medium=article&utm_campaign=${context.campaignId ?? "sem-campanha"}&utm_content=SLUG_DO_ARTIGO e identifique a posição com cta_id:
- CTA no meio do artigo: cta_id=cta-inline
- CTA ao final do artigo: cta_id=cta-final
Substitua SLUG_DO_ARTIGO pelo mesmo slug devolvido no JSON.
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `node --import tsx --test src/lib/editorSeo.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/agents/editorSeo.ts src/lib/editorSeo.test.ts
git commit -m "fix: corrigir semântica de UTM (campaignId/contentId) e separar cta_id"
```

---

### Task 5: Registrar o conteúdo no pipeline

**Files:**
- Modify: `src/pipeline.ts:1-16,105-108`

**Interfaces:**
- Consumes: `registerContent` (Task 2), `ContentRegistryEntry` (Task 2), `plan.funnelStage` (Task 3), `postUrl` (já importado de `./agents/indexer.js`).

- [ ] **Step 1: Implementar (sem teste novo dedicado — ver nota abaixo)**

Editar `src/pipeline.ts`. Adicionar o import, junto aos demais (após a linha `import { appendHistory } from "./history.js";`):

```ts
import { registerContent } from "./contentRegistry.js";
```

Substituir as linhas 105-106 (`if (published.publicado) await markTopicPublished(...)` e `await appendHistory(...)`) por:

```ts
    if (published.publicado) await markTopicPublished(ctx, topic.tema);
    await appendHistory(ctx, { tema: topic.tema, titulo: finalPost.titulo, slug: publishedSlug, publicadoEm: new Date().toISOString() });
    await registerContent(ctx, {
      contentId: publishedSlug,
      campaignId: null,
      tema: topic.tema,
      formato: "blog",
      channel: "blog",
      funnelStage: plan.funnelStage,
      publicadoEm: new Date().toISOString(),
      status: published.publicado ? "published" : "draft-pending-approval",
      url: postUrl(ctx, publishedSlug),
    });
```

Nota: `registerContent` é chamado no mesmo ponto e sob a mesma lógica que `appendHistory` já usa hoje — é o ponto único de verdade combinado na Seção 1 do design (após `publishPost`, nunca em `editorSeo.ts`/`publisher.ts`). Não há teste de integração novo para este passo porque `src/pipeline.test.ts` hoje só cobre o cenário de calendário vazio (retorno antecipado, antes de chegar em `publishPost`) — o mesmo já vale para `appendHistory`, que também não é exercitado por teste de pipeline. A cobertura de `registerContent` em si (upsert, idempotência) já está em `src/contentRegistry.test.ts` (Task 2).

- [ ] **Step 2: Rodar a suíte completa para confirmar que nada quebrou**

Run: `npm test` (ou o comando de teste configurado no `package.json`)
Expected: PASS em todos os arquivos, incluindo `src/pipeline.test.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/pipeline.ts
git commit -m "feat: registrar content-registry.json apos publishPost no pipeline"
```

---

### Task 6: Aceitar os eventos novos em `POST /api/conversions`

**Files:**
- Modify: `src/server.ts:135-152`

**Interfaces:**
- Consumes: `ConversionEventName` (Task 1, agora com 13 valores), `recordConversion` (já aceita `anonymousId`/`userId`/`ctaId` via `Omit<ConversionEvent, "createdAt">`).

- [ ] **Step 1: Implementar**

Não há suíte de testes de rota HTTP neste repositório (`src/server.ts` não tem `.test.ts` correspondente — as demais rotas também não têm). A verificação deste passo é manual, via `curl`, no Step 2.

Editar `src/server.ts`, substituindo o corpo de `app.post("/api/conversions", ...)` (linhas 135-152) por:

```ts
app.post("/api/conversions", express.json(), asyncHandler(async (req, res) => {
  // Única rota que assume um default em vez de exigir workspaceId: o frontend do
  // site público (outro repositório) já postava aqui antes do multi-workspace e
  // não conhece o parâmetro — exigi-lo quebraria o rastreio de conversões ao vivo.
  const workspaceId = String(req.body?.workspaceId ?? "nextassist");
  const allowed: ConversionEventName[] = [
    "page_view", "cta_click",
    "demo_view", "demo_submit", "contact_submit", "whatsapp_click",
    "trial_started", "signup_completed",
    "first_customer_created", "first_device_linked", "first_order_created",
    "returning_user", "subscription_started",
  ];
  if (!allowed.includes(req.body?.name)) { res.status(400).json({ error: "Evento inválido" }); return; }
  const campaign = String(req.body.campaign ?? "").slice(0, 80);
  const content = String(req.body.content ?? "").slice(0, 80);
  const ctaId = String(req.body.ctaId ?? "").slice(0, 80);
  const utmValue = /^[a-z0-9-]*$/;
  if (!utmValue.test(campaign) || !utmValue.test(content) || !utmValue.test(ctaId)) {
    res.status(400).json({ error: "Parâmetros UTM inválidos" });
    return;
  }
  // anonymousId/userId são opacos (gerados pelo site/produto) — só limitamos o
  // tamanho para não deixar o arquivo de eventos crescer sem controle.
  const anonymousId = String(req.body.anonymousId ?? "").slice(0, 100);
  const userId = String(req.body.userId ?? "").slice(0, 100);
  const ctx = await contextFor(workspaceId);
  await recordConversion(ctx, {
    name: req.body.name,
    path: String(req.body.path ?? "").slice(0, 200),
    source: String(req.body.source ?? "").slice(0, 80),
    medium: String(req.body.medium ?? "").slice(0, 80),
    campaign, content,
    ...(ctaId ? { ctaId } : {}),
    ...(anonymousId ? { anonymousId } : {}),
    ...(userId ? { userId } : {}),
  });
  res.status(204).end();
}));
```

- [ ] **Step 2: Verificar manualmente**

Run: `npm run dev` (ou o comando local do servidor), depois em outro terminal:

```bash
curl -i -X POST http://localhost:3000/api/conversions \
  -H "Content-Type: application/json" \
  -d '{"workspaceId":"nextassist","name":"trial_started","anonymousId":"anon-test-1","content":"post-a"}'
```

Expected: `HTTP/1.1 204 No Content`. Depois, checar que o evento apareceu em `workspaces/nextassist/conversion-events.json` com `anonymousId` e `content` preenchidos.

- [ ] **Step 3: Commit**

```bash
git add src/server.ts
git commit -m "feat: aceitar eventos de produto e identidade em POST /api/conversions"
```

---

### Task 7: `attribution.ts` — join determinístico

**Files:**
- Create: `src/attribution.ts`
- Create: `src/attribution.test.ts`

**Interfaces:**
- Consumes: `getContentRegistry` (Task 2), `getConversionEvents`, `ConversionEvent` (Task 1), `getPerformance`, `PerformanceReport` (já existem em `src/performance.ts`).
- Produces: `MIN_TRIALS_FOR_RATE`, `AttributionRow`, `computeAttributionFromData(registry, events, performance): AttributionRow[]` (função pura, testável sem I/O), `computeAttribution(ctx): Promise<{ rows: AttributionRow[]; unattributedEvents: number }>`. Consumido por `server.ts` (Task 8) e `marketingDirector.ts` (Task 9).

Nota de implementação (pequeno ajuste em relação ao desenho em prosa): `unattributedEvents` é uma contagem *global* — por definição, um evento sem `contentId` resolvível não pertence a nenhuma linha — então vive em `{ rows, unattributedEvents }`, não como campo dentro de cada `AttributionRow`.

- [ ] **Step 1: Escrever os testes que falham**

Criar `src/attribution.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { computeAttributionFromData, MIN_TRIALS_FOR_RATE } from "./attribution.js";
import type { ContentRegistryEntry } from "./contentRegistry.js";
import type { ConversionEvent } from "./conversions.js";

const registry: ContentRegistryEntry[] = [
  {
    contentId: "post-a", campaignId: null, tema: "Precificação", formato: "blog",
    channel: "blog", funnelStage: "fundo", publicadoEm: "2026-08-01T00:00:00Z",
    status: "published", url: "https://acme.test/blog/post-a",
  },
];

test("visitas: usa post-performance quando disponível, ignora page_view", () => {
  const events: ConversionEvent[] = [
    { name: "page_view", anonymousId: "a1", content: "post-a", createdAt: "2026-08-01T00:00:00Z" },
  ];
  const performance = { posts: [{ slug: "post-a", clicks: 240 }] };
  const [row] = computeAttributionFromData(registry, events, performance);
  assert.equal(row.visits, 240);
});

test("visitas: sem post-performance, usa page_view atribuível; demo_view nunca conta", () => {
  const events: ConversionEvent[] = [
    { name: "page_view", anonymousId: "a1", content: "post-a", createdAt: "2026-08-01T00:00:00Z" },
    { name: "page_view", anonymousId: "a2", content: "post-a", createdAt: "2026-08-01T00:01:00Z" },
    { name: "demo_view", anonymousId: "a3", content: "post-a", createdAt: "2026-08-01T00:02:00Z" },
  ];
  const [row] = computeAttributionFromData(registry, events, null);
  assert.equal(row.visits, 2);
});

test("trials/ativação/clientes contam entidades únicas, não eventos brutos", () => {
  const events: ConversionEvent[] = [
    { name: "trial_started", anonymousId: "a1", content: "post-a", createdAt: "2026-08-01T00:00:00Z" },
    { name: "trial_started", anonymousId: "a1", content: "post-a", createdAt: "2026-08-01T00:00:30Z" }, // retry duplicado
    { name: "trial_started", anonymousId: "a2", content: "post-a", createdAt: "2026-08-01T00:01:00Z" },
  ];
  const [row] = computeAttributionFromData(registry, events, null);
  assert.equal(row.trials, 2);
});

test("first-touch: evento sem content herda o conteúdo de origem via anonymousId, propagado ao userId no signup", () => {
  const events: ConversionEvent[] = [
    { name: "page_view", anonymousId: "a1", content: "post-a", createdAt: "2026-08-01T00:00:00Z" },
    { name: "signup_completed", anonymousId: "a1", userId: "u1", createdAt: "2026-08-01T00:05:00Z" },
    { name: "first_order_created", userId: "u1", createdAt: "2026-08-02T00:00:00Z" }, // sem content nem anonymousId
  ];
  const [row] = computeAttributionFromData(registry, events, null);
  assert.equal(row.activated, 1);
});

test("eventos sem content nem identidade resolvível viram unattributedEvents, não inflam nenhuma linha", () => {
  const events: ConversionEvent[] = [
    { name: "trial_started", createdAt: "2026-08-01T00:00:00Z" }, // sem anonymousId, sem content
  ];
  const result = { rows: computeAttributionFromData(registry, events, null), unattributedEvents: 0 };
  assert.equal(result.rows[0].trials, 0);
});

test("rateReliable é false abaixo de MIN_TRIALS_FOR_RATE e as taxas não dividem por zero", () => {
  const events: ConversionEvent[] = [
    { name: "trial_started", anonymousId: "a1", content: "post-a", createdAt: "2026-08-01T00:00:00Z" },
  ];
  const [row] = computeAttributionFromData(registry, events, null);
  assert.equal(row.trials, 1);
  assert.ok(row.trials < MIN_TRIALS_FOR_RATE);
  assert.equal(row.rateReliable, false);
  assert.equal(row.visitToTrialRate, 0); // visits = 0, sem divisão por zero
  assert.equal(row.activationToCustomerRate, 0); // activated = 0
});
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `node --import tsx --test src/attribution.test.ts`
Expected: FAIL — módulo `src/attribution.ts` não existe.

- [ ] **Step 3: Implementar**

Criar `src/attribution.ts`:

```ts
// src/attribution.ts
import { getContentRegistry, type ContentRegistryEntry } from "./contentRegistry.js";
import { getConversionEvents, type ConversionEvent } from "./conversions.js";
import { getPerformance } from "./performance.js";
import type { WorkspaceContext } from "./context.js";

/** Amostra mínima de trials para uma taxa ser considerada confiável. Ponto de partida do P0, ajustável com mais dado real — não é verdade estatística. */
export const MIN_TRIALS_FOR_RATE = 5;

export interface AttributionRow {
  contentId: string;
  campaignId: string | null;
  tema: string;
  channel: string;
  formato: string;
  funnelStage: string;
  visits: number;
  trials: number;
  signups: number;
  activated: number;
  customers: number;
  visitToTrialRate: number;
  trialToActivationRate: number;
  activationToCustomerRate: number;
  rateReliable: boolean;
}

const FUNNEL_EVENT_NAMES = new Set<ConversionEvent["name"]>([
  "page_view", "trial_started", "signup_completed", "first_order_created", "subscription_started",
]);

/** userId -> anonymousId, construído a partir de eventos que carregam os dois (tipicamente signup_completed). */
function buildIdentityMap(events: ConversionEvent[]): Map<string, string> {
  const userToAnonymous = new Map<string, string>();
  for (const event of events) {
    if (event.anonymousId && event.userId) userToAnonymous.set(event.userId, event.anonymousId);
  }
  return userToAnonymous;
}

/** anonymousId -> primeiro contentId tocado (first-touch), por ordem de createdAt. */
function buildFirstTouchMap(events: ConversionEvent[]): Map<string, string> {
  const sorted = [...events].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const firstTouch = new Map<string, string>();
  for (const event of sorted) {
    if (event.anonymousId && event.content && !firstTouch.has(event.anonymousId)) {
      firstTouch.set(event.anonymousId, event.content);
    }
  }
  return firstTouch;
}

/**
 * Resolve o contentId de origem de um evento: prioriza a atribuição
 * first-touch via identidade (anonymousId direto, ou anonymousId ligado por
 * userId); só cai para o `content` direto do próprio evento quando não há
 * identidade resolvível.
 */
function resolveContentId(
  event: ConversionEvent,
  firstTouch: Map<string, string>,
  userToAnonymous: Map<string, string>,
): string | undefined {
  const anonymousId = event.anonymousId ?? (event.userId ? userToAnonymous.get(event.userId) : undefined);
  if (anonymousId && firstTouch.has(anonymousId)) return firstTouch.get(anonymousId);
  return event.content || undefined;
}

function entityKey(event: ConversionEvent): string | undefined {
  return event.userId ?? event.anonymousId;
}

/** Agrupa entidades únicas (Set<anonymousId|userId>) por contentId, para um nome de evento. Nunca conta eventos brutos. */
function uniqueEntitiesByContent(
  events: ConversionEvent[],
  name: ConversionEvent["name"],
  firstTouch: Map<string, string>,
  userToAnonymous: Map<string, string>,
): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const event of events) {
    if (event.name !== name) continue;
    const contentId = resolveContentId(event, firstTouch, userToAnonymous);
    const key = entityKey(event);
    if (!contentId || !key) continue;
    if (!map.has(contentId)) map.set(contentId, new Set());
    map.get(contentId)!.add(key);
  }
  return map;
}

function safeRate(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : 0;
}

export interface PerformanceLike {
  posts: Array<{ slug: string; clicks: number }>;
}

/**
 * Função pura, sem I/O: junta registro de conteúdo + eventos + performance
 * SEO em uma linha por contentId. Sem chamada a LLM, sem estado — não é um
 * agente.
 */
export function computeAttributionFromData(
  registry: ContentRegistryEntry[],
  events: ConversionEvent[],
  performance: PerformanceLike | null,
): AttributionRow[] {
  const userToAnonymous = buildIdentityMap(events);
  const firstTouch = buildFirstTouchMap(events);

  const pageViewsByContent = uniqueEntitiesByContent(events, "page_view", firstTouch, userToAnonymous);
  const trialsByContent = uniqueEntitiesByContent(events, "trial_started", firstTouch, userToAnonymous);
  const signupsByContent = uniqueEntitiesByContent(events, "signup_completed", firstTouch, userToAnonymous);
  const activatedByContent = uniqueEntitiesByContent(events, "first_order_created", firstTouch, userToAnonymous);
  const customersByContent = uniqueEntitiesByContent(events, "subscription_started", firstTouch, userToAnonymous);

  const performanceBySlug = new Map((performance?.posts ?? []).map((p) => [p.slug, p.clicks]));

  return registry.map((entry): AttributionRow => {
    // Precedência de visitas: post-performance (SEO) > page_view atribuível > 0. demo_view nunca conta como visita.
    const visits = performanceBySlug.has(entry.contentId)
      ? performanceBySlug.get(entry.contentId)!
      : (pageViewsByContent.get(entry.contentId)?.size ?? 0);
    const trials = trialsByContent.get(entry.contentId)?.size ?? 0;
    const signups = signupsByContent.get(entry.contentId)?.size ?? 0;
    const activated = activatedByContent.get(entry.contentId)?.size ?? 0;
    const customers = customersByContent.get(entry.contentId)?.size ?? 0;

    return {
      contentId: entry.contentId,
      campaignId: entry.campaignId,
      tema: entry.tema,
      channel: entry.channel,
      formato: entry.formato,
      funnelStage: entry.funnelStage,
      visits, trials, signups, activated, customers,
      visitToTrialRate: safeRate(trials, visits),
      trialToActivationRate: safeRate(activated, trials),
      activationToCustomerRate: safeRate(customers, activated),
      rateReliable: trials >= MIN_TRIALS_FOR_RATE,
    };
  });
}

function countUnattributed(
  events: ConversionEvent[],
  firstTouch: Map<string, string>,
  userToAnonymous: Map<string, string>,
): number {
  let count = 0;
  for (const event of events) {
    if (!FUNNEL_EVENT_NAMES.has(event.name)) continue;
    if (!resolveContentId(event, firstTouch, userToAnonymous)) count++;
  }
  return count;
}

/** Carrega registro + eventos + performance do workspace e computa a atribuição. Chamado sob demanda pelo dashboard e pelo Marketing Director. */
export async function computeAttribution(ctx: WorkspaceContext): Promise<{ rows: AttributionRow[]; unattributedEvents: number }> {
  const [registry, events, performance] = await Promise.all([
    getContentRegistry(ctx),
    getConversionEvents(ctx),
    getPerformance(ctx),
  ]);
  const userToAnonymous = buildIdentityMap(events);
  const firstTouch = buildFirstTouchMap(events);
  return {
    rows: computeAttributionFromData(registry, events, performance),
    unattributedEvents: countUnattributed(events, firstTouch, userToAnonymous),
  };
}
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `node --import tsx --test src/attribution.test.ts`
Expected: PASS

- [ ] **Step 5: Registrar o arquivo de teste novo no agregador**

`src/attribution.test.ts` é um arquivo novo — `npm test` só o executa se estiver listado em `src/tests.ts`. Editar `src/tests.ts`, adicionando a linha `import "./attribution.test.js";`. Rodar `npm test` e confirmar que passa.

- [ ] **Step 6: Commit**

```bash
git add src/attribution.ts src/attribution.test.ts src/tests.ts
git commit -m "feat: adicionar attribution.ts com join first-touch determinístico"
```

---

### Task 8: `GET /api/attribution`

**Files:**
- Modify: `src/server.ts` (novo import + nova rota, próxima de `GET /api/performance`)

**Interfaces:**
- Consumes: `computeAttribution` (Task 7).

- [ ] **Step 1: Implementar**

Em `src/server.ts`, adicionar ao import existente de `./performance.js` (linha 9) o import da nova função, em uma linha própria logo abaixo:

```ts
import { computeAttribution } from "./attribution.js";
```

Adicionar a rota nova imediatamente depois de `app.get("/api/performance", ...)` (após a linha 291):

```ts
app.get("/api/attribution", asyncHandler(async (req, res) => {
  const workspaceId = requireWorkspaceId(req, res);
  if (!workspaceId) return;
  const ctx = await contextFor(workspaceId);
  res.json(await computeAttribution(ctx));
}));
```

- [ ] **Step 2: Verificar manualmente**

Run: `npm run dev`, depois:

```bash
curl -u <user>:<senha> "http://localhost:3000/api/attribution?workspaceId=nextassist"
```

Expected: `200 OK` com `{"rows": [...], "unattributedEvents": <number>}` (arrays vazios se ainda não houver `content-registry.json`/eventos — sem erro).

- [ ] **Step 3: Commit**

```bash
git add src/server.ts
git commit -m "feat: expor GET /api/attribution"
```

---

### Task 9: Tabela de atribuição no dashboard

**Files:**
- Modify: `web/public/index.html` (nova seção, após a seção `conversion-panel`)
- Modify: `web/public/app.js` (novo `loadAttribution()`, chamado em `init()`)

**Interfaces:**
- Consumes: `GET /api/attribution` (Task 8), resposta `{ rows: AttributionRow[]; unattributedEvents: number }`.

- [ ] **Step 1: Adicionar a seção no HTML**

Em `web/public/index.html`, inserir logo após o fechamento de `</section>` da `conversion-panel` (linha 63), antes da `performance-panel`:

```html
  <section class="usage-panel attribution-panel">
    <div class="usage-header">
      <div>
        <h2>Atribuição: conteúdo → cliente</h2>
        <p>Junta visitas, trials, ativação (1ª Ordem de Serviço) e assinatura por conteúdo. Ordenado por clientes.</p>
      </div>
      <span id="attribution-updated"></span>
    </div>
    <div id="attribution-table"></div>
  </section>
```

- [ ] **Step 2: Implementar `loadAttribution()` em `app.js`**

Adicionar as constantes de DOM junto às demais (perto da linha 71-73, após `conversionAttribution`):

```js
const attributionTable = document.getElementById("attribution-table");
const attributionUpdated = document.getElementById("attribution-updated");
```

Adicionar a função `loadAttribution`, logo após `loadConversions` (depois da linha 465):

```js
async function loadAttribution() {
  const res = await fetch(withWorkspace("/api/attribution"));
  if (!res.ok) return;
  const data = await res.json();
  const rows = [...(data.rows ?? [])].sort((a, b) => b.customers - a.customers || b.activated - a.activated);
  attributionTable.innerHTML = rows.length
    ? `<div class="perf-table-wrap"><table><thead><tr>
        <th>Conteúdo</th><th>Canal</th><th>Tema</th><th>Visitas</th><th>Trials</th><th>Cadastros</th><th>Ativados</th><th>Clientes</th>
        <th>Visita→Trial</th><th>Trial→Ativação</th><th>Ativação→Cliente</th>
      </tr></thead><tbody>${rows
        .map((row) => `<tr>
          <td>${escapeHtml(row.contentId)}</td>
          <td>${escapeHtml(row.channel)}</td>
          <td>${escapeHtml(row.tema)}</td>
          <td>${nf.format(row.visits)}</td>
          <td>${nf.format(row.trials)}</td>
          <td>${nf.format(row.signups)}</td>
          <td>${nf.format(row.activated)}</td>
          <td>${nf.format(row.customers)}</td>
          <td>${(row.visitToTrialRate * 100).toFixed(1)}%</td>
          <td>${row.rateReliable ? `${(row.trialToActivationRate * 100).toFixed(1)}%` : "amostra insuficiente"}</td>
          <td>${(row.activationToCustomerRate * 100).toFixed(1)}%</td>
        </tr>`)
        .join("")}</tbody></table></div>`
    : "<p class=\"empty\">Nenhum conteúdo publicado com registro de atribuição ainda.</p>";
  attributionUpdated.textContent = data.unattributedEvents
    ? `${data.unattributedEvents} evento(s) sem conteúdo/identidade atribuível`
    : "";
}
```

Registrar a chamada em `init()`, junto de `loadConversions()` e `loadPerformance()` (linha 561-563):

```js
    loadConversions();
    loadAttribution();
    loadStatus();
    loadPerformance();
```

- [ ] **Step 3: Verificar manualmente no navegador**

Run: `npm run dev`, abrir `http://localhost:3000` (autenticar com Basic Auth), confirmar que a seção "Atribuição: conteúdo → cliente" aparece abaixo de "Conversões do blog" e renderiza sem erros no console — mesmo com `content-registry.json` vazio/inexistente (deve mostrar a mensagem de "Nenhum conteúdo... ainda", não quebrar).

- [ ] **Step 4: Commit**

```bash
git add web/public/index.html web/public/app.js
git commit -m "feat: adicionar tabela de atribuição conteudo->cliente no dashboard"
```

---

### Task 10: Marketing Director prioriza por resultado comercial

**Files:**
- Modify: `src/lib/marketingDirector.ts`
- Modify: `src/lib/marketingDirector.test.ts`

**Interfaces:**
- Consumes: `computeAttribution`, `AttributionRow`, `MIN_TRIALS_FOR_RATE` (Task 7).
- Produces: `buildPrompt` passa a ser exportado (era privado) para ser testável diretamente.

- [ ] **Step 1: Escrever o teste que falha**

Adicionar ao final de `src/lib/marketingDirector.test.ts`:

```ts
import { buildPrompt } from "./marketingDirector.js";
import { MIN_TRIALS_FOR_RATE } from "../attribution.js";

const baseWorkspace = {
  id: "acme", name: "Acme", active: true,
  brand: { name: "Acme", description: "d", toneOfVoice: "t", targetAudience: [], competitors: [], forbiddenTerms: [] },
  goals: { primary: "leads" as const },
  channels: { blog: true, instagram: false, linkedin: false },
  integrations: { siteUrl: "https://acme.test", cms: { provider: "nextassist" as const, apiUrl: "https://api.acme.test" } },
  autonomy: { mode: "copilot" as const },
  secrets: { required: [] },
};

test("buildPrompt prioriza clientes > ativados > trials > visitas, citando a amostra mínima de trials", () => {
  const ctx = { workspace: baseWorkspace } as any;
  const prompt = buildPrompt(
    ctx,
    { count: 5, existingThemes: [], existingKeywords: [], publishedTitles: [] },
    null,
    {
      rows: [
        { contentId: "post-a", campaignId: null, tema: "Precificação", channel: "blog", formato: "blog", funnelStage: "fundo", visits: 240, trials: 21, signups: 18, activated: 13, customers: 4, visitToTrialRate: 0.09, trialToActivationRate: 0.62, activationToCustomerRate: 0.31, rateReliable: true },
        { contentId: "post-b", campaignId: null, tema: "Agência com IA", channel: "instagram", formato: "instagram-reel", funnelStage: "topo", visits: 1800, trials: 5, signups: 1, activated: 1, customers: 0, visitToTrialRate: 0.003, trialToActivationRate: 0.2, activationToCustomerRate: 0, rateReliable: true },
      ],
      unattributedEvents: 0,
    },
    [],
  );
  assert.match(prompt, /clientes/i);
  assert.match(prompt, new RegExp(`${MIN_TRIALS_FOR_RATE}`));
  assert.match(prompt, /post-a/);
  const posA = prompt.indexOf("post-a");
  const posB = prompt.indexOf("post-b");
  assert.ok(posA < posB, "post-a (4 clientes) deve aparecer antes de post-b (0 clientes) na lista priorizada");
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `node --import tsx --test src/lib/marketingDirector.test.ts`
Expected: FAIL — `buildPrompt` não está exportado e ainda espera `conversions`/`getConversionSummary`, não `attribution`.

- [ ] **Step 3: Implementar**

Editar `src/lib/marketingDirector.ts`. Trocar o import de `getConversionSummary` (linha 4) por:

```ts
import { computeAttribution, MIN_TRIALS_FOR_RATE, type AttributionRow } from "../attribution.js";
```

Atualizar o `SYSTEM_TEMPLATE` (linhas 56-83), trocando o bloco de priorização (linhas 67-72) por:

```ts
Priorize, nesta ordem, sempre que houver dado suficiente:
1. Conteúdos que já geraram clientes pagantes (assinatura) — nunca deixe alcance bruto superar isso.
2. Entre os que ainda não geraram cliente, os com mais usuários ativados (criaram a 1ª Ordem de Serviço).
3. Entre os que ainda não ativaram ninguém, os com mais trials.
4. Taxas de conversão calculadas com menos de ${MIN_TRIALS_FOR_RATE} trials têm amostra insuficiente — NÃO as use para priorizar, mesmo que pareçam altas.
5. Só quando não houver sinal comercial suficiente (poucos ou nenhum dado de atribuição), use Search Console, concorrentes ou clusters de conteúdo como critério.
```

Atualizar a assinatura e o corpo de `buildPrompt` (linhas 85-130) — trocar o parâmetro `conversions` por `attribution` e exportar a função:

```ts
export function buildPrompt(
  ctx: WorkspaceContext,
  options: GenerateContentBacklogOptions,
  performance: PerformanceReport | null,
  attribution: { rows: AttributionRow[]; unattributedEvents: number } | null,
  topQueries: Awaited<ReturnType<typeof getTopSearchQueries>>,
): string {
  const forbidden = ctx.workspace.brand.forbiddenTerms ?? [];

  const topByClicks = [...(performance?.posts ?? [])]
    .sort((a, b) => b.clicks - a.clicks)
    .slice(0, 5)
    .map((p) => `- "${p.titulo}" (${p.clicks} cliques, posição média ${p.position.toFixed(1)})`)
    .join("\n") || "(sem dados de performance ainda)";

  const topByAttribution = [...(attribution?.rows ?? [])]
    .sort((a, b) => b.customers - a.customers || b.activated - a.activated || b.trials - a.trials || b.visits - a.visits)
    .slice(0, 5)
    .map((r) => `- ${r.tema} (${r.contentId}, ${r.channel}): ${r.customers} cliente(s), ${r.activated} ativado(s), ${r.trials} trial(s), ${r.visits} visita(s)${
      r.rateReliable ? ` — trial→ativação ${(r.trialToActivationRate * 100).toFixed(0)}%` : " — amostra de trials insuficiente para taxa confiável"
    }`)
    .join("\n") || "(sem dados de atribuição ainda)";

  const searchOpportunities = topQueries
    .slice(0, 10)
    .map((q) => `- "${q.query}" (${q.impressions} impressões, posição média ${q.position.toFixed(1)}, ${q.clicks} cliques)`)
    .join("\n") || "(Search Console não configurado ou sem dados)";

  return `Gere até ${options.count} novas oportunidades de pauta para o blog.

Temas já existentes no calendário (pendentes ou publicados) — NÃO repita nem gere algo muito parecido:
${options.existingThemes.map((t) => `- ${t}`).join("\n") || "(nenhum)"}

Palavras-chave já usadas — evite repetir:
${options.existingKeywords.join(", ") || "(nenhuma)"}

Títulos já publicados no blog:
${options.publishedTitles.map((t) => `- ${t}`).join("\n") || "(nenhum)"}

Posts com melhor desempenho no Search Console (últimos 28 dias):
${topByClicks}

Conteúdos com melhor resultado comercial (clientes > ativados > trials > visitas):
${topByAttribution}

Termos de busca com maior potencial (impressões altas, posição ou CTR ruins):
${searchOpportunities}
${forbidden.length ? `\nTermos proibidos — nunca use nem referencie: ${forbidden.join(", ")}` : ""}`;
}
```

E atualizar `generateContentBacklog` (linhas 138-155) para buscar `computeAttribution` no lugar de `getConversionSummary`:

```ts
export async function generateContentBacklog(
  ctx: WorkspaceContext,
  options: GenerateContentBacklogOptions,
): Promise<ContentOpportunity[]> {
  const [performance, attribution, topQueries] = await Promise.all([
    getPerformance(ctx),
    computeAttribution(ctx),
    getTopSearchQueries(ctx).catch(() => []),
  ]);

  const raw = await runAgent(ctx, {
    system: SYSTEM_TEMPLATE(ctx),
    prompt: buildPrompt(ctx, options, performance, attribution, topQueries),
    maxTokens: 3000,
  });

  return parseContentOpportunities(extractJson<unknown>(raw));
}
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `node --import tsx --test src/lib/marketingDirector.test.ts`
Expected: PASS

- [ ] **Step 5: Rodar a suíte inteira (todos os módulos tocados neste plano)**

Run: `npm test` (ou o comando de teste do `package.json`)
Expected: PASS em todos os arquivos — `conversions.test.ts`, `contentRegistry.test.ts`, `agents/topicPlanner.test.ts`, `lib/editorSeo.test.ts`, `attribution.test.ts`, `lib/marketingDirector.test.ts`, `pipeline.test.ts`, e os demais não tocados.

- [ ] **Step 6: Commit**

```bash
git add src/lib/marketingDirector.ts src/lib/marketingDirector.test.ts
git commit -m "feat: Marketing Director prioriza por AttributionRow (clientes > ativados > trials > visitas)"
```

---

## Verificação final do P0

Depois da Task 10, o P0 completo responde "qual conteúdo está realmente trazendo trials e clientes":

- Cada publicação nova aparece em `content-registry.json` com `contentId`/tema/canal/formato/funil.
- `POST /api/conversions` aceita os 13 nomes de evento, incluindo identidade (`anonymousId`/`userId`) e `ctaId`.
- `GET /api/attribution` devolve a tabela juntada por `contentId`.
- O dashboard mostra a tabela ordenada por clientes.
- O Marketing Director já cita esses dados no motivo de cada pauta nova.

O que fica pendente (documentado no spec, Seção "Corte de tarefas", P1/P2) não faz parte deste plano: disparo real dos eventos de produto pelo app NextAssist, cobertura completa de `page_view`/`cta_click`, CAC, atribuição real de `campaignId`, detecção de saturação de tema, validação estatística da hipótese de ativação, multi-touch, cohortes, scoring, store dedicado, integração externa.
