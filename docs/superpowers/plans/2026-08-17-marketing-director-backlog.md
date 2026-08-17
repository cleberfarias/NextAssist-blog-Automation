# Marketing Director — Backlog Autoalimentado Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The pipeline never stops just because `content-calendar.json` ran out of pending topics — a new `marketing-director` agent detects a low backlog, analyzes workspace context (brand, goals, published history, performance, conversions, Search Console), proposes new `ContentOpportunity[]`, and the system validates/deduplicates/persists them before the pipeline continues.

**Architecture:** A new orchestration layer (`ensureContentBacklog` in `src/backlog.ts`) sits between the pipeline entrypoint and `getNextTopic`. It counts pending topics via `contentCalendar.ts`, and when below threshold, calls an injectable "skill" (`generateContentBacklog` in `src/lib/marketingDirector.ts`) that gathers workspace context and asks the LLM for structured `ContentOpportunity[]`. The LLM never writes JSON to disk directly — `backlog.ts` validates schema, deduplicates (exact + near-duplicate via token-set similarity), enforces `forbiddenTerms`, caps at `replenishAmount`, then persists via `contentCalendar.ts`. `ensureContentBacklog` never throws; failures become a `marketing-director` "error" event plus a `BacklogResult.error`, letting the pipeline fall back to any existing pending topic or fail with the same "no topic" error as today.

**Tech Stack:** TypeScript (Node `--test` runner via `tsx`), existing `runAgent`/`extractJson` LLM layer (`src/lib/anthropic.ts`), existing JSON-file persistence pattern (`readFile`/`writeFile` per workspace path).

**Spec:** `docs/superpowers/specs/2026-08-17-marketing-director-backlog.md`

## Global Constraints

- No vector DB, RAG, PostgreSQL, LinkedIn integration, recommendation engine, or new scheduler — this phase only.
- The LLM must never write directly to `content-calendar.json` — only validated, deduplicated `ContentOpportunity[]` get persisted.
- `ensureContentBacklog` must never throw — Director failures become an `error` event + `BacklogResult.error`, never an unhandled rejection.
- Default strategy when a workspace has no `contentStrategy` block: `{ minimumPendingTopics: 5, replenishAmount: 15 }`.
- `npm run build` (tsc, strict mode) and `npm test` (`node --import tsx --test src/tests.ts`) must pass after every task.
- New test files must be registered in `src/tests.ts` in the same task that introduces them.
- Follow existing repo conventions: Portuguese user-facing strings/log messages, `.js` extensions on relative imports (NodeNext ESM), agents live under `src/agents/*.ts` or `src/lib/*.ts`, tests co-located as `*.test.ts` next to the module they cover.

---

## File Structure

- `src/pipelineEvents.ts` **(new)** — `AgentId` (with `"marketing-director"` added), `AgentStatus`, `PipelineEvent`, `OnEvent`, `emit()`. Extracted out of `pipeline.ts` so both `pipeline.ts` and the new `backlog.ts` can emit events without a circular import.
- `src/lib/text.ts` **(new)** — `normalizeText()`, `jaccardSimilarity()`. Pure text-similarity helpers used for near-duplicate detection.
- `src/testing/tempWorkspace.ts` **(new)** — `createTempWorkspace()` test helper: writes a temp `workspaces/<id>/*.json` directory tree and returns a `workspacesRoot` URL usable with `buildWorkspaceContext`, plus a `cleanup()`.
- `src/workspace.ts` **(modify)** — add optional `contentStrategy` to `MarketingWorkspace` + runtime schema validation.
- `src/contentCalendar.ts` **(modify)** — extend `CalendarTopic` with `generatedBy`/`createdAt`/`reason`/`priority`; add `countPendingTopics()`, `getAllTopics()`, `addTopics()`.
- `src/lib/searchConsole.ts` **(modify)** — add `getTopSearchQueries()` (best-effort, site-wide top queries for the Director's context).
- `src/lib/marketingDirector.ts` **(new)** — `ContentOpportunity` type, `parseContentOpportunities()` (schema validation), `generateContentBacklog()` (the "skill": gathers context, calls the LLM, returns validated opportunities).
- `src/backlog.ts` **(new)** — `validateOpportunities()` (dedup/business rules), `ensureContentBacklog()` (orchestration), `BacklogResult` type.
- `src/pipeline.ts` **(modify)** — call `ensureContentBacklog()` before `getNextTopic()`; `PipelineResult` gains `backlog: BacklogResult` and always resolves (no more `| null`).
- `src/index.ts`, `src/runsHistory.ts` **(modify)** — persist `BacklogResult` on `RunRecord.backlog`.
- `src/server.ts`, `web/public/app.js` **(modify)** — add `"marketing-director"` to the panel's agent roster.
- `workspaces/nextassist/workspace.json` **(modify)** — add the `contentStrategy` block from the spec.

---

### Task 1: Shared pipeline event types + `marketing-director` agent id

**Files:**
- Create: `src/pipelineEvents.ts`
- Modify: `src/pipeline.ts`
- Modify: `src/server.ts:179`
- Modify: `web/public/app.js:44-52`

**Interfaces:**
- Produces: `AgentId` (union including `"marketing-director"`), `AgentStatus`, `PipelineEvent`, `OnEvent`, `emit(onEvent, event)` — all consumed by every later task.

This is a pure refactor (extract + re-export) plus one new union member and one new UI roster entry — no behavior change, verified by the existing suite still passing.

- [ ] **Step 1: Create `src/pipelineEvents.ts`**

```ts
// src/pipelineEvents.ts
export type AgentId =
  | "marketing-director"
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

export function emit(onEvent: OnEvent | undefined, event: Omit<PipelineEvent, "timestamp">): void {
  onEvent?.({ ...event, timestamp: new Date().toISOString() });
}
```

- [ ] **Step 2: Update `src/pipeline.ts` to import from `pipelineEvents.ts` instead of defining these locally**

Replace lines 14-28 and 37-39 of `src/pipeline.ts`:

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
import { emit, type AgentId, type AgentStatus, type PipelineEvent, type OnEvent } from "./pipelineEvents.js";
import type { WorkspaceContext, AnthropicUsage } from "./context.js";

export type { AgentId, AgentStatus, PipelineEvent, OnEvent } from "./pipelineEvents.js";

async function getPublishedSlugs(ctx: WorkspaceContext): Promise<string[]> {
  const response = await fetch(`${ctx.workspace.integrations.cms.apiUrl}/blog/posts`, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`Não foi possível carregar posts existentes: HTTP ${response.status}`);
  const payload = (await response.json()) as { data?: Array<{ slug?: string }> };
  return (payload.data ?? []).map((post) => post.slug).filter((slug): slug is string => Boolean(slug));
}
```

(This drops the old local `export type AgentId = ...`, `export type AgentStatus = ...`, `export interface PipelineEvent`, `export type OnEvent`, and local `function emit(...)` — everything else in the file stays as-is for this step; `runPipeline` still calls `emit(...)` exactly as before, now imported instead of locally defined.)

- [ ] **Step 3: Add `"marketing-director"` to the panel's agent id allowlist**

In `src/server.ts:179`:

```ts
const AGENT_IDS: AgentId[] = ["marketing-director", "pesquisa-mercado", "pesquisa-pauta", "redator", "editor-seo", "publicador", "instagram", "indexador"];
```

- [ ] **Step 4: Add the Marketing Director to the panel's visual roster**

In `web/public/app.js`, replace the `AGENTS` array (lines 44-52) with:

```js
const AGENTS = [
  { id: "marketing-director", name: "Marina", role: "Marketing Director", emoji: "📊" },
  { id: "pesquisa-mercado", name: "Ana", role: "Pesquisa de mercado", emoji: "🔍" },
  { id: "pesquisa-pauta", name: "Bruno", role: "Pesquisa de pauta", emoji: "🗂️" },
  { id: "redator", name: "Carla", role: "Redação", emoji: "✍️" },
  { id: "editor-seo", name: "Diego", role: "Editor / SEO", emoji: "🧐" },
  { id: "publicador", name: "Elis", role: "Publicação", emoji: "🚀" },
  { id: "instagram", name: "Gabi", role: "Instagram", emoji: "📸" },
  { id: "indexador", name: "Fábio", role: "Indexação / Google", emoji: "📈" },
];
```

- [ ] **Step 5: Verify build and existing suite still pass**

Run: `npm run build && npm test`
Expected: both succeed with no errors (pure refactor, no behavior change yet).

- [ ] **Step 6: Commit**

```bash
git add src/pipelineEvents.ts src/pipeline.ts src/server.ts web/public/app.js
git commit -m "refactor: extract pipeline event types, add marketing-director agent id"
```

---

### Task 2: `contentStrategy` workspace config

**Files:**
- Modify: `src/workspace.ts`
- Test: `src/workspace.test.ts`

**Interfaces:**
- Produces: `MarketingWorkspace.contentStrategy?: { minimumPendingTopics: number; replenishAmount: number }` — consumed by `src/backlog.ts` (Task 7).

- [ ] **Step 1: Write the failing tests**

`src/workspace.test.ts` already has a `makeFixtureRoot(workspaces: Record<string, object | null>): Promise<URL>` helper and a `baseWorkspace` fixture object (lines 9-31) — reuse both instead of writing new temp-dir plumbing. Add these tests to the end of the file:

```ts
test("contentStrategy é opcional — workspace sem o campo carrega normalmente", async () => {
  const root = await makeFixtureRoot({ acme: baseWorkspace });
  const workspace = await loadWorkspace("acme", root);
  assert.equal(workspace.contentStrategy, undefined);
});

test("contentStrategy inválido (minimumPendingTopics não numérico) falha ao carregar", async () => {
  const root = await makeFixtureRoot({
    acme: { ...baseWorkspace, contentStrategy: { minimumPendingTopics: "cinco", replenishAmount: 15 } },
  });
  await assert.rejects(
    () => loadWorkspace("acme", root),
    /contentStrategy\.minimumPendingTopics.*inteiro positivo/,
  );
});

test("contentStrategy válido é aceito e exposto no workspace carregado", async () => {
  const root = await makeFixtureRoot({
    acme: { ...baseWorkspace, contentStrategy: { minimumPendingTopics: 5, replenishAmount: 15 } },
  });
  const workspace = await loadWorkspace("acme", root);
  assert.deepEqual(workspace.contentStrategy, { minimumPendingTopics: 5, replenishAmount: 15 });
});
```

No new imports needed — `assert`, `test`, `makeFixtureRoot`, `baseWorkspace`, and `loadWorkspace` are all already imported/defined earlier in the file.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --import tsx --test src/workspace.test.ts`
Expected: FAIL — `workspace.contentStrategy` type doesn't exist yet / no validation error thrown for the invalid case.

- [ ] **Step 3: Implement `contentStrategy` on `MarketingWorkspace` + validation**

In `src/workspace.ts`, add the field to the interface (after `autonomy`, before `secrets`):

```ts
  autonomy: {
    mode: "copilot" | "semi-autonomous" | "autonomous";
  };
  contentStrategy?: {
    minimumPendingTopics: number;
    replenishAmount: number;
  };
  secrets: {
```

Add a `requirePositiveInteger` helper next to the other `require*` helpers (after `requireEnum`):

```ts
  const requirePositiveInteger = (v: unknown, path: string): number => {
    if (typeof v !== "number" || !Number.isInteger(v) || v <= 0) fail(`"${path}" precisa ser um inteiro positivo`);
    return v as number;
  };
```

Add validation right after the `autonomy` block (before `const secretsRaw = ...`):

```ts
  if (w.contentStrategy !== undefined) {
    const contentStrategyRaw = requireObject(w.contentStrategy, "contentStrategy");
    requirePositiveInteger(contentStrategyRaw.minimumPendingTopics, "contentStrategy.minimumPendingTopics");
    requirePositiveInteger(contentStrategyRaw.replenishAmount, "contentStrategy.replenishAmount");
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --import tsx --test src/workspace.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/workspace.ts src/workspace.test.ts
git commit -m "feat: add optional contentStrategy config to workspace schema"
```

---

### Task 3: Text similarity utility

**Files:**
- Create: `src/lib/text.ts`
- Test: `src/lib/text.test.ts`

**Interfaces:**
- Produces: `normalizeText(value: string): string`, `jaccardSimilarity(a: string, b: string): number` — consumed by `src/backlog.ts` (Task 7).

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/text.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import { normalizeText, jaccardSimilarity } from "./text.js";

test("normalizeText remove acentos, baixa a caixa e tira espaços nas pontas", () => {
  assert.equal(normalizeText("  Atendimento via WhatsApp  "), "atendimento via whatsapp");
  assert.equal(normalizeText("Programação e Gestão"), "programacao e gestao");
});

test("jaccardSimilarity é 1 para textos idênticos após normalização", () => {
  assert.equal(jaccardSimilarity("Estoque de Celular", "estoque de   celular"), 1);
});

test("jaccardSimilarity é 0 quando não há nenhum termo em comum", () => {
  assert.equal(jaccardSimilarity("Estoque de celular", "Marketing digital hoje"), 0);
});

test("jaccardSimilarity fica alta para reformulações do mesmo tema", () => {
  const score = jaccardSimilarity(
    "Atendimento via WhatsApp: como organizar o fluxo sem perder cliente",
    "Como organizar o atendimento via WhatsApp sem perder cliente",
  );
  assert.ok(score >= 0.6, `esperado >= 0.6, recebido ${score}`);
});

test("jaccardSimilarity com string vazia é 0", () => {
  assert.equal(jaccardSimilarity("", "qualquer coisa"), 0);
  assert.equal(jaccardSimilarity("qualquer coisa", ""), 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test src/lib/text.test.ts`
Expected: FAIL with "Cannot find module './text.js'"

- [ ] **Step 3: Implement `src/lib/text.ts`**

```ts
// src/lib/text.ts

/** Remove acentos, baixa a caixa e normaliza espaços — base para comparação de texto tolerante a variação. */
export function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

function tokenize(value: string): Set<string> {
  return new Set(normalizeText(value).split(/[^a-z0-9]+/).filter(Boolean));
}

/**
 * Similaridade de Jaccard (interseção / união) sobre o conjunto de palavras
 * normalizadas de cada texto. Usado para detectar pautas "muito parecidas"
 * sem precisar de embeddings/banco vetorial (fora de escopo desta fase).
 */
export function jaccardSimilarity(a: string, b: string): number {
  const tokensA = tokenize(a);
  const tokensB = tokenize(b);
  if (tokensA.size === 0 || tokensB.size === 0) return 0;

  let intersection = 0;
  for (const token of tokensA) if (tokensB.has(token)) intersection++;
  const union = tokensA.size + tokensB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test src/lib/text.test.ts`
Expected: PASS

- [ ] **Step 5: Register the test in `src/tests.ts`**

Add `import "./lib/text.test.js";` to `src/tests.ts` (alongside the other `./lib/*.test.js` imports).

- [ ] **Step 6: Commit**

```bash
git add src/lib/text.ts src/lib/text.test.ts src/tests.ts
git commit -m "feat: add text normalization and jaccard similarity util"
```

---

### Task 4: `contentCalendar.ts` — pending count, full listing, append

**Files:**
- Create: `src/testing/tempWorkspace.ts`
- Modify: `src/contentCalendar.ts`
- Test: `src/contentCalendar.test.ts`

**Interfaces:**
- Consumes: `WorkspaceContext` from `src/context.ts` (existing), `buildWorkspaceContext(workspace, secrets, { workspacesRoot, requireAiProvider })` (existing, `workspacesRoot`/`requireAiProvider` already supported).
- Produces:
  - `createTempWorkspace(id: string, files: Record<string, unknown>): Promise<{ root: URL; cleanup: () => Promise<void> }>` — used by this task's tests and by Tasks 7 and 8.
  - `CalendarTopic` (extended with `generatedBy?: "marketing-director"`, `createdAt?: string`, `reason?: string`, `priority?: "high" | "medium" | "low"`).
  - `NewTopicInput { tema: string; palavraChaveAlvo: string; reason?: string; priority?: "high" | "medium" | "low" }` — the shape `src/backlog.ts` (Task 7) passes to `addTopics`.
  - `countPendingTopics(ctx: WorkspaceContext): Promise<number>`
  - `getAllTopics(ctx: WorkspaceContext): Promise<CalendarTopic[]>`
  - `addTopics(ctx: WorkspaceContext, inputs: NewTopicInput[]): Promise<CalendarTopic[]>`

- [ ] **Step 1: Create the temp-workspace test helper**

```ts
// src/testing/tempWorkspace.ts
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export interface TempWorkspace {
  root: URL;
  cleanup: () => Promise<void>;
}

/**
 * Cria um diretório temporário `<tmp>/<id>/` com os arquivos JSON informados
 * (ex: `{ "content-calendar.json": { topicos: [...] } }`), no formato que
 * `buildWorkspaceContext({ workspacesRoot })` espera. Usado pelos testes que
 * precisam de leitura/escrita real em disco sem tocar nos workspaces reais
 * do repositório.
 */
export async function createTempWorkspace(id: string, files: Record<string, unknown> = {}): Promise<TempWorkspace> {
  const base = await mkdtemp(join(tmpdir(), "nextassist-test-"));
  const workspaceDir = join(base, id);
  await mkdir(workspaceDir, { recursive: true });
  for (const [fileName, content] of Object.entries(files)) {
    await writeFile(join(workspaceDir, fileName), `${JSON.stringify(content, null, 2)}\n`);
  }
  const root = new URL(`${pathToFileURL(base).href}/`);
  return { root, cleanup: () => rm(base, { recursive: true, force: true }) };
}
```

- [ ] **Step 2: Write the failing tests**

```ts
// src/contentCalendar.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import { buildWorkspaceContext } from "./context.js";
import type { MarketingWorkspace } from "./workspace.js";
import type { SecretProvider } from "./lib/secrets.js";
import { createTempWorkspace } from "./testing/tempWorkspace.js";
import { getNextTopic, markTopicPublished, countPendingTopics, getAllTopics, addTopics } from "./contentCalendar.js";

const workspace: MarketingWorkspace = {
  id: "acme", name: "Acme", active: true,
  brand: { name: "Acme", description: "d", toneOfVoice: "t", targetAudience: [], competitors: [] },
  goals: { primary: "leads" },
  channels: { blog: true, instagram: false, linkedin: false },
  integrations: { siteUrl: "https://acme.test", cms: { provider: "nextassist", apiUrl: "https://api.acme.test" } },
  autonomy: { mode: "copilot" },
  secrets: { required: [] },
};

function fakeSecrets(): SecretProvider {
  return { async get() { return undefined; } };
}

async function contextWithCalendar(topicos: unknown[]) {
  const temp = await createTempWorkspace("acme", { "content-calendar.json": { topicos } });
  const ctx = await buildWorkspaceContext(workspace, fakeSecrets(), {
    workspacesRoot: temp.root,
    requireAiProvider: false,
  });
  return { ctx, cleanup: temp.cleanup };
}

test("getNextTopic devolve o primeiro tópico não publicado", async () => {
  const { ctx, cleanup } = await contextWithCalendar([
    { tema: "A", palavraChaveAlvo: "a", publicado: true },
    { tema: "B", palavraChaveAlvo: "b", publicado: false },
  ]);
  try {
    const topic = await getNextTopic(ctx);
    assert.equal(topic?.tema, "B");
  } finally {
    await cleanup();
  }
});

test("getNextTopic devolve null quando não há pendentes (calendário cheio de publicados)", async () => {
  const { ctx, cleanup } = await contextWithCalendar([{ tema: "A", palavraChaveAlvo: "a", publicado: true }]);
  try {
    assert.equal(await getNextTopic(ctx), null);
  } finally {
    await cleanup();
  }
});

test("countPendingTopics conta só os não publicados", async () => {
  const { ctx, cleanup } = await contextWithCalendar([
    { tema: "A", palavraChaveAlvo: "a", publicado: true },
    { tema: "B", palavraChaveAlvo: "b", publicado: false },
    { tema: "C", palavraChaveAlvo: "c", publicado: false },
  ]);
  try {
    assert.equal(await countPendingTopics(ctx), 2);
  } finally {
    await cleanup();
  }
});

test("countPendingTopics devolve 0 para calendário vazio", async () => {
  const { ctx, cleanup } = await contextWithCalendar([]);
  try {
    assert.equal(await countPendingTopics(ctx), 0);
  } finally {
    await cleanup();
  }
});

test("markTopicPublished continua funcionando com itens no formato antigo (sem os campos novos)", async () => {
  const { ctx, cleanup } = await contextWithCalendar([{ tema: "A", palavraChaveAlvo: "a", publicado: false }]);
  try {
    await markTopicPublished(ctx, "A");
    const all = await getAllTopics(ctx);
    assert.equal(all[0].publicado, true);
    assert.ok(all[0].publicadoEm);
  } finally {
    await cleanup();
  }
});

test("addTopics acrescenta tópicos marcados como gerados pelo marketing-director", async () => {
  const { ctx, cleanup } = await contextWithCalendar([{ tema: "A", palavraChaveAlvo: "a", publicado: true }]);
  try {
    const added = await addTopics(ctx, [
      { tema: "B", palavraChaveAlvo: "b", reason: "lacuna de concorrência", priority: "high" },
    ]);
    assert.equal(added.length, 1);
    assert.equal(added[0].generatedBy, "marketing-director");
    assert.ok(added[0].createdAt);
    assert.equal(added[0].publicado, false);
    assert.equal(added[0].reason, "lacuna de concorrência");
    assert.equal(added[0].priority, "high");

    const all = await getAllTopics(ctx);
    assert.equal(all.length, 2);
    assert.equal(await countPendingTopics(ctx), 1);
  } finally {
    await cleanup();
  }
});

test("addTopics com lista vazia não altera o calendário", async () => {
  const { ctx, cleanup } = await contextWithCalendar([{ tema: "A", palavraChaveAlvo: "a", publicado: true }]);
  try {
    const added = await addTopics(ctx, []);
    assert.equal(added.length, 0);
    assert.equal((await getAllTopics(ctx)).length, 1);
  } finally {
    await cleanup();
  }
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `node --import tsx --test src/contentCalendar.test.ts`
Expected: FAIL — `countPendingTopics`, `getAllTopics`, `addTopics` don't exist yet.

- [ ] **Step 4: Implement the additions in `src/contentCalendar.ts`**

Replace the full file with:

```ts
// src/contentCalendar.ts
import { readFile, writeFile } from "node:fs/promises";
import type { WorkspaceContext } from "./context.js";

export interface CalendarTopic {
  tema: string;
  palavraChaveAlvo: string;
  publicado: boolean;
  publicadoEm?: string;
  /** Presente quando o tópico foi gerado pelo Marketing Director em vez de curado manualmente. */
  generatedBy?: "marketing-director";
  createdAt?: string;
  reason?: string;
  priority?: "high" | "medium" | "low";
}

/** O que o Marketing Director (ou qualquer outro gerador futuro) precisa fornecer para virar um `CalendarTopic`. */
export interface NewTopicInput {
  tema: string;
  palavraChaveAlvo: string;
  reason?: string;
  priority?: "high" | "medium" | "low";
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

/** Pega o próximo tópico não publicado. */
export async function getNextTopic(ctx: WorkspaceContext): Promise<CalendarTopic | null> {
  const calendar = await load(ctx);
  return calendar.topicos.find((t) => !t.publicado) ?? null;
}

/** Marca um tópico como publicado. */
export async function markTopicPublished(ctx: WorkspaceContext, tema: string): Promise<void> {
  const calendar = await load(ctx);
  const topic = calendar.topicos.find((t) => t.tema === tema);
  if (topic) {
    topic.publicado = true;
    topic.publicadoEm = new Date().toISOString();
    await save(ctx, calendar);
  }
}

/** Conta quantos tópicos ainda não foram publicados — usado por `ensureContentBacklog` para decidir se reabastece. */
export async function countPendingTopics(ctx: WorkspaceContext): Promise<number> {
  const calendar = await load(ctx);
  return calendar.topicos.filter((t) => !t.publicado).length;
}

/** Todos os tópicos (pendentes e publicados) — base para deduplicar novas pautas geradas pelo Marketing Director. */
export async function getAllTopics(ctx: WorkspaceContext): Promise<CalendarTopic[]> {
  return (await load(ctx)).topicos;
}

/**
 * Acrescenta novos tópicos ao calendário. Quem chama (`ensureContentBacklog`)
 * já validou duplicidade/qualidade — esta função só persiste, marcando a
 * origem para diferenciar de tópicos curados manualmente.
 */
export async function addTopics(ctx: WorkspaceContext, inputs: NewTopicInput[]): Promise<CalendarTopic[]> {
  if (inputs.length === 0) return [];
  const calendar = await load(ctx);
  const createdAt = new Date().toISOString();
  const newTopics: CalendarTopic[] = inputs.map((input) => ({
    tema: input.tema,
    palavraChaveAlvo: input.palavraChaveAlvo,
    publicado: false,
    generatedBy: "marketing-director",
    createdAt,
    reason: input.reason,
    priority: input.priority,
  }));
  calendar.topicos.push(...newTopics);
  await save(ctx, calendar);
  return newTopics;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --import tsx --test src/contentCalendar.test.ts`
Expected: PASS

- [ ] **Step 6: Register the test in `src/tests.ts`**

Add `import "./contentCalendar.test.js";` to `src/tests.ts`.

- [ ] **Step 7: Commit**

```bash
git add src/testing/tempWorkspace.ts src/contentCalendar.ts src/contentCalendar.test.ts src/tests.ts
git commit -m "feat: add countPendingTopics/getAllTopics/addTopics to content calendar"
```

---

### Task 5: Search Console top queries (best-effort context source)

**Files:**
- Modify: `src/lib/searchConsole.ts`

**Interfaces:**
- Produces: `SearchQueryMetric { query: string; clicks: number; impressions: number; position: number }`, `getTopSearchQueries(ctx: WorkspaceContext, limit?: number): Promise<SearchQueryMetric[]>` — consumed by `src/lib/marketingDirector.ts` (Task 6).

No test for this step: it calls the live Google Search Console API through the existing `googleFetch`/JWT client (same as the untested `getUrlMetrics`/`getIndexStatus` already in this file) — there's no existing mocking seam for `google.ts`'s JWT client in this codebase, so this follows the established (untested) pattern for that boundary. Its caller wraps it in `.catch(() => [])`, so a broken/misconfigured Search Console never breaks backlog generation.

- [ ] **Step 1: Add `getTopSearchQueries` to `src/lib/searchConsole.ts`**

Append to the end of `src/lib/searchConsole.ts`:

```ts
export interface SearchQueryMetric { query: string; clicks: number; impressions: number; position: number; }

/**
 * Termos de busca com mais impressões nos últimos 28 dias, para o Marketing
 * Director identificar oportunidades (termo com impressões altas mas posição
 * ruim = pauta em potencial). Devolve `[]` se o workspace não tiver Search
 * Console configurado — o Director trata isso como "sem esse sinal", não
 * como erro.
 */
export async function getTopSearchQueries(ctx: WorkspaceContext, limit = 20): Promise<SearchQueryMetric[]> {
  const siteUrl = ctx.workspace.integrations.searchConsole?.siteUrl;
  if (!siteUrl) return [];

  const end = new Date();
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 28);
  const site = encodeURIComponent(siteUrl);

  const data = await googleFetch<{ rows?: Array<{ keys: string[]; clicks: number; impressions: number; position: number }> }>(
    ctx,
    `https://www.googleapis.com/webmasters/v3/sites/${site}/searchAnalytics/query`,
    {
      method: "POST",
      body: {
        startDate: start.toISOString().slice(0, 10),
        endDate: end.toISOString().slice(0, 10),
        dimensions: ["query"],
        rowLimit: limit,
      },
    },
  );

  return (data.rows ?? []).map((row) => ({
    query: row.keys[0],
    clicks: row.clicks,
    impressions: row.impressions,
    position: row.position,
  }));
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: succeeds with no type errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/searchConsole.ts
git commit -m "feat: add getTopSearchQueries for marketing director context"
```

---

### Task 6: `generateContentBacklog` skill

**Files:**
- Create: `src/lib/marketingDirector.ts`
- Test: `src/lib/marketingDirector.test.ts`

**Interfaces:**
- Consumes: `runAgent`, `extractJson` from `src/lib/anthropic.ts` (existing); `getPerformance` from `src/performance.ts` (existing); `getConversionSummary` from `src/conversions.ts` (existing); `getTopSearchQueries` from `src/lib/searchConsole.ts` (Task 5); `WorkspaceContext` from `src/context.ts`.
- Produces:
  - `ContentOpportunity { tema: string; palavraChaveAlvo: string; reason: string; priority: "high" | "medium" | "low"; source: "search-console" | "conversion" | "competitor" | "content-gap" | "workspace-goal" | "other" }` — consumed by `src/backlog.ts` (Task 7) and `src/contentCalendar.ts`'s `NewTopicInput` (structurally compatible, no cast needed).
  - `GenerateContentBacklogOptions { count: number; existingThemes: string[]; existingKeywords: string[]; publishedTitles: string[] }` — the shape `src/backlog.ts`'s injectable `generate` option must match exactly.
  - `parseContentOpportunities(raw: unknown): ContentOpportunity[]` — schema validation, unit-tested directly (no LLM call).
  - `generateContentBacklog(ctx: WorkspaceContext, options: GenerateContentBacklogOptions): Promise<ContentOpportunity[]>` — the real "skill", not unit-tested here (it calls the live LLM); `src/backlog.ts` tests inject a fake replacement instead.

Only `parseContentOpportunities` is unit-tested in this task — it's the pure, LLM-independent part. `generateContentBacklog` itself is exercised indirectly in Task 7/8 via dependency injection, consistent with how `src/agents/*.ts` (which also call `runAgent`) have no direct unit tests in this codebase.

- [ ] **Step 1: Write the failing tests for `parseContentOpportunities`**

```ts
// src/lib/marketingDirector.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import { parseContentOpportunities } from "./marketingDirector.js";

test("aceita um array válido de oportunidades", () => {
  const raw = [
    { tema: "T", palavraChaveAlvo: "k", reason: "r", priority: "high", source: "search-console" },
  ];
  const result = parseContentOpportunities(raw);
  assert.equal(result.length, 1);
  assert.equal(result[0].tema, "T");
});

test("array vazio é válido (nenhuma oportunidade identificada)", () => {
  assert.deepEqual(parseContentOpportunities([]), []);
});

test("descarta itens com priority ou source fora do enum, mantendo os válidos", () => {
  const raw = [
    { tema: "T1", palavraChaveAlvo: "k1", reason: "r", priority: "urgent", source: "other" },
    { tema: "T2", palavraChaveAlvo: "k2", reason: "r", priority: "high", source: "made-up" },
    { tema: "T3", palavraChaveAlvo: "k3", reason: "r", priority: "low", source: "content-gap" },
  ];
  const result = parseContentOpportunities(raw);
  assert.equal(result.length, 1);
  assert.equal(result[0].tema, "T3");
});

test("descarta itens com tema ou palavraChaveAlvo vazios/ausentes", () => {
  const raw = [
    { tema: "", palavraChaveAlvo: "k", reason: "r", priority: "high", source: "other" },
    { palavraChaveAlvo: "k", reason: "r", priority: "high", source: "other" },
    { tema: "T", palavraChaveAlvo: "k", reason: "r", priority: "high", source: "other" },
  ];
  const result = parseContentOpportunities(raw);
  assert.equal(result.length, 1);
  assert.equal(result[0].tema, "T");
});

test("lança erro quando a resposta não é um array", () => {
  assert.throws(() => parseContentOpportunities({ tema: "T" }), /lista de oportunidades/);
});

test("lança erro quando uma lista não vazia não tem nenhum item válido", () => {
  assert.throws(
    () => parseContentOpportunities([{ tema: "", palavraChaveAlvo: "k", reason: "r", priority: "high", source: "other" }]),
    /nenhuma/i,
  );
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --import tsx --test src/lib/marketingDirector.test.ts`
Expected: FAIL with "Cannot find module './marketingDirector.js'"

- [ ] **Step 3: Implement `src/lib/marketingDirector.ts`**

```ts
// src/lib/marketingDirector.ts
import { runAgent, extractJson } from "./anthropic.js";
import { getPerformance } from "../performance.js";
import { getConversionSummary } from "../conversions.js";
import { getTopSearchQueries } from "./searchConsole.js";
import type { WorkspaceContext } from "../context.js";
import type { PerformanceReport } from "../performance.js";

export interface ContentOpportunity {
  tema: string;
  palavraChaveAlvo: string;
  reason: string;
  priority: "high" | "medium" | "low";
  source: "search-console" | "conversion" | "competitor" | "content-gap" | "workspace-goal" | "other";
}

export interface GenerateContentBacklogOptions {
  count: number;
  existingThemes: string[];
  existingKeywords: string[];
  publishedTitles: string[];
}

const PRIORITIES = new Set(["high", "medium", "low"]);
const SOURCES = new Set(["search-console", "conversion", "competitor", "content-gap", "workspace-goal", "other"]);

function isValidOpportunity(item: unknown): item is ContentOpportunity {
  if (typeof item !== "object" || item === null) return false;
  const candidate = item as Record<string, unknown>;
  return (
    typeof candidate.tema === "string" && candidate.tema.trim().length > 0 &&
    typeof candidate.palavraChaveAlvo === "string" && candidate.palavraChaveAlvo.trim().length > 0 &&
    typeof candidate.reason === "string" &&
    typeof candidate.priority === "string" && PRIORITIES.has(candidate.priority) &&
    typeof candidate.source === "string" && SOURCES.has(candidate.source)
  );
}

/**
 * Valida a resposta do LLM contra o schema de `ContentOpportunity`. Itens
 * malformados são descartados silenciosamente (o LLM às vezes erra um campo
 * isolado); só lança erro se a resposta inteira não for uma lista, ou se uma
 * lista não vazia não tiver sobrado nenhum item válido.
 */
export function parseContentOpportunities(raw: unknown): ContentOpportunity[] {
  if (!Array.isArray(raw)) {
    throw new Error("Resposta do Marketing Director não é uma lista de oportunidades.");
  }
  const valid = raw.filter(isValidOpportunity);
  if (raw.length > 0 && valid.length === 0) {
    throw new Error(`Nenhuma das ${raw.length} oportunidade(s) retornada(s) pelo Marketing Director passou na validação de schema.`);
  }
  return valid;
}

const SYSTEM_TEMPLATE = (ctx: WorkspaceContext) => `Você é o Marketing Director do ${ctx.workspace.brand.name} — ${ctx.workspace.brand.description}
Tom de voz: ${ctx.workspace.brand.toneOfVoice}
Público-alvo: ${ctx.workspace.brand.targetAudience.join(", ") || "não especificado"}
Concorrentes diretos: ${ctx.workspace.brand.competitors.join(", ") || "não especificado"}
Propostas de valor: ${(ctx.workspace.brand.valuePropositions ?? []).join(", ") || "não especificado"}
Objetivo principal do workspace: ${ctx.workspace.goals.primary}

Sua responsabilidade é perceber quando o backlog de pautas do blog está
ficando baixo e propor novas oportunidades de conteúdo com potencial real de
impacto nesse objetivo — nunca gere temas aleatórios ou genéricos.

Priorize, nesta ordem quando o contexto disponível permitir:
1. Oportunidades do Search Console (termos com impressões altas e posição ou CTR ruins).
2. Temas relacionados a conteúdo que já converte bem (campanhas/CTAs com mais leads).
3. Lacunas em relação aos concorrentes.
4. Atualização de clusters de conteúdo já existentes.
5. Outras oportunidades alinhadas ao objetivo principal do workspace.

Responda SOMENTE com um array JSON, sem texto antes ou depois, no formato:
[
  {
    "tema": "...",
    "palavraChaveAlvo": "...",
    "reason": "explicação curta e concreta do porquê essa pauta importa agora",
    "priority": "high" | "medium" | "low",
    "source": "search-console" | "conversion" | "competitor" | "content-gap" | "workspace-goal" | "other"
  }
]`;

function buildPrompt(
  ctx: WorkspaceContext,
  options: GenerateContentBacklogOptions,
  performance: PerformanceReport | null,
  conversions: Awaited<ReturnType<typeof getConversionSummary>> | null,
  topQueries: Awaited<ReturnType<typeof getTopSearchQueries>>,
): string {
  const forbidden = ctx.workspace.brand.forbiddenTerms ?? [];

  const topByClicks = [...(performance?.posts ?? [])]
    .sort((a, b) => b.clicks - a.clicks)
    .slice(0, 5)
    .map((p) => `- "${p.titulo}" (${p.clicks} cliques, posição média ${p.position.toFixed(1)})`)
    .join("\n") || "(sem dados de performance ainda)";

  const topByCampaign = (conversions?.byCampaign ?? [])
    .slice(0, 5)
    .map((c) => `- ${c.campaign}: ${c.leads} leads (taxa de demo ${(c.demoRate * 100).toFixed(0)}%)`)
    .join("\n") || "(sem dados de conversão ainda)";

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

Campanhas/conteúdo com melhor conversão em lead:
${topByCampaign}

Termos de busca com maior potencial (impressões altas, posição ou CTR ruins):
${searchOpportunities}
${forbidden.length ? `\nTermos proibidos — nunca use nem referencie: ${forbidden.join(", ")}` : ""}`;
}

/**
 * A "skill" do Marketing Director: junta o contexto de marketing disponível
 * para o workspace e pede ao LLM uma lista estruturada de oportunidades de
 * conteúdo. NÃO grava nada em disco — quem chama (`ensureContentBacklog`)
 * ainda precisa validar duplicidade/qualidade antes de persistir.
 */
export async function generateContentBacklog(
  ctx: WorkspaceContext,
  options: GenerateContentBacklogOptions,
): Promise<ContentOpportunity[]> {
  const [performance, conversions, topQueries] = await Promise.all([
    getPerformance(ctx),
    getConversionSummary(ctx),
    getTopSearchQueries(ctx).catch(() => []),
  ]);

  const raw = await runAgent(ctx, {
    system: SYSTEM_TEMPLATE(ctx),
    prompt: buildPrompt(ctx, options, performance, conversions, topQueries),
    maxTokens: 3000,
  });

  return parseContentOpportunities(extractJson<unknown>(raw));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --import tsx --test src/lib/marketingDirector.test.ts`
Expected: PASS

- [ ] **Step 5: Verify build**

Run: `npm run build`
Expected: succeeds — this is the first place `ContentOpportunity` and `GenerateContentBacklogOptions` are defined; confirm no type errors from the `performance.ts`/`conversions.ts`/`searchConsole.ts` imports.

- [ ] **Step 6: Register the test in `src/tests.ts`**

Add `import "./lib/marketingDirector.test.js";` to `src/tests.ts`.

- [ ] **Step 7: Commit**

```bash
git add src/lib/marketingDirector.ts src/lib/marketingDirector.test.ts src/tests.ts
git commit -m "feat: add generateContentBacklog marketing director skill"
```

---

### Task 7: `ensureContentBacklog` orchestration

**Files:**
- Create: `src/backlog.ts`
- Test: `src/backlog.test.ts`

**Interfaces:**
- Consumes: `countPendingTopics`, `getAllTopics`, `addTopics` from `src/contentCalendar.ts` (Task 4); `getHistory` from `src/history.ts` (existing); `generateContentBacklog`, `ContentOpportunity`, `GenerateContentBacklogOptions` from `src/lib/marketingDirector.ts` (Task 6); `normalizeText`, `jaccardSimilarity` from `src/lib/text.ts` (Task 3); `emit`, `OnEvent` from `src/pipelineEvents.ts` (Task 1); `createTempWorkspace` from `src/testing/tempWorkspace.ts` (Task 4, test only).
- Produces:
  - `BacklogResult { skipped: boolean; pendingBefore: number; generated: number; discardedDuplicates: number; discardedForbidden: number; discardedInvalid: number; pendingAfter: number; error: string | null }` — consumed by `src/pipeline.ts` (Task 8), `src/runsHistory.ts` and `src/index.ts` (Task 9).
  - `validateOpportunities(opportunities: ContentOpportunity[], options: { existingThemes: string[]; existingKeywords: string[]; publishedTitles: string[]; forbiddenTerms: string[]; maxCount: number }): { accepted: ContentOpportunity[]; discardedDuplicates: number; discardedForbidden: number; discardedInvalid: number }` — pure, unit-tested directly.
  - `ensureContentBacklog(ctx: WorkspaceContext, onEvent?: OnEvent, options?: { generate?: (ctx, options: GenerateContentBacklogOptions) => Promise<ContentOpportunity[]> }): Promise<BacklogResult>` — consumed by `src/pipeline.ts` (Task 8).

- [ ] **Step 1: Write the failing tests**

```ts
// src/backlog.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import { buildWorkspaceContext } from "./context.js";
import type { MarketingWorkspace } from "./workspace.js";
import type { SecretProvider } from "./lib/secrets.js";
import { createTempWorkspace } from "./testing/tempWorkspace.js";
import { getAllTopics, countPendingTopics } from "./contentCalendar.js";
import { ensureContentBacklog, validateOpportunities } from "./backlog.js";
import type { ContentOpportunity } from "./lib/marketingDirector.js";
import type { PipelineEvent } from "./pipelineEvents.js";

function baseWorkspace(overrides: Partial<MarketingWorkspace> = {}): MarketingWorkspace {
  return {
    id: "acme", name: "Acme", active: true,
    brand: { name: "Acme", description: "d", toneOfVoice: "t", targetAudience: [], competitors: [] },
    goals: { primary: "leads" },
    channels: { blog: true, instagram: false, linkedin: false },
    integrations: { siteUrl: "https://acme.test", cms: { provider: "nextassist", apiUrl: "https://api.acme.test" } },
    autonomy: { mode: "copilot" },
    secrets: { required: [] },
    ...overrides,
  };
}

function fakeSecrets(): SecretProvider {
  return { async get() { return undefined; } };
}

async function contextWithCalendar(workspace: MarketingWorkspace, topicos: unknown[], history: unknown[] = []) {
  const temp = await createTempWorkspace(workspace.id, {
    "content-calendar.json": { topicos },
    "post-history.json": history,
  });
  const ctx = await buildWorkspaceContext(workspace, fakeSecrets(), {
    workspacesRoot: temp.root,
    requireAiProvider: false,
  });
  return { ctx, cleanup: temp.cleanup };
}

function opportunity(overrides: Partial<ContentOpportunity> = {}): ContentOpportunity {
  return {
    tema: "Novo tema qualquer",
    palavraChaveAlvo: "novo tema",
    reason: "motivo",
    priority: "medium",
    source: "other",
    ...overrides,
  };
}

test("calendário cheio: não chama o Director e não altera o calendário", async () => {
  const workspace = baseWorkspace({ contentStrategy: { minimumPendingTopics: 2, replenishAmount: 5 } });
  const { ctx, cleanup } = await contextWithCalendar(workspace, [
    { tema: "A", palavraChaveAlvo: "a", publicado: false },
    { tema: "B", palavraChaveAlvo: "b", publicado: false },
  ]);
  try {
    let called = false;
    const result = await ensureContentBacklog(ctx, undefined, { generate: async () => { called = true; return []; } });
    assert.equal(called, false);
    assert.equal(result.skipped, true);
    assert.equal(result.pendingBefore, 2);
    assert.equal(result.pendingAfter, 2);
    assert.equal(result.generated, 0);
    assert.equal(await countPendingTopics(ctx), 2);
  } finally {
    await cleanup();
  }
});

test("calendário baixo: chama o Director e persiste as novas pautas válidas", async () => {
  const workspace = baseWorkspace({ contentStrategy: { minimumPendingTopics: 3, replenishAmount: 5 } });
  const { ctx, cleanup } = await contextWithCalendar(workspace, [
    { tema: "Tema existente", palavraChaveAlvo: "existente", publicado: false },
  ]);
  try {
    const events: PipelineEvent[] = [];
    const result = await ensureContentBacklog(ctx, (e) => events.push(e), {
      generate: async () => [
        opportunity({ tema: "Tema novo A", palavraChaveAlvo: "novo a" }),
        opportunity({ tema: "Tema novo B", palavraChaveAlvo: "novo b" }),
      ],
    });
    assert.equal(result.skipped, false);
    assert.equal(result.pendingBefore, 1);
    assert.equal(result.generated, 2);
    assert.equal(result.pendingAfter, 3);
    assert.equal(await countPendingTopics(ctx), 3);
    assert.ok(events.some((e) => e.agent === "marketing-director" && e.status === "working"));
    assert.ok(events.some((e) => e.agent === "marketing-director" && e.status === "done"));
  } finally {
    await cleanup();
  }
});

test("calendário vazio: reabastece do zero", async () => {
  const workspace = baseWorkspace({ contentStrategy: { minimumPendingTopics: 5, replenishAmount: 3 } });
  const { ctx, cleanup } = await contextWithCalendar(workspace, []);
  try {
    const result = await ensureContentBacklog(ctx, undefined, {
      generate: async () => [
        opportunity({ tema: "Tema 1", palavraChaveAlvo: "k1" }),
        opportunity({ tema: "Tema 2", palavraChaveAlvo: "k2" }),
        opportunity({ tema: "Tema 3", palavraChaveAlvo: "k3" }),
      ],
    });
    assert.equal(result.pendingBefore, 0);
    assert.equal(result.generated, 3);
    assert.equal(result.pendingAfter, 3);
  } finally {
    await cleanup();
  }
});

test("validateOpportunities respeita o limite máximo configurável", () => {
  const opportunities = [
    opportunity({ tema: "T1", palavraChaveAlvo: "k1" }),
    opportunity({ tema: "T2", palavraChaveAlvo: "k2" }),
    opportunity({ tema: "T3", palavraChaveAlvo: "k3" }),
  ];
  const result = validateOpportunities(opportunities, {
    existingThemes: [], existingKeywords: [], publishedTitles: [], forbiddenTerms: [], maxCount: 2,
  });
  assert.equal(result.accepted.length, 2);
});

test("duplicidades: descarta tema repetido, palavra-chave repetida, termo proibido e pauta muito similar a post publicado", async () => {
  const workspace = baseWorkspace({
    contentStrategy: { minimumPendingTopics: 5, replenishAmount: 10 },
    brand: { ...baseWorkspace().brand, forbiddenTerms: ["concorrente x"] },
  });
  const { ctx, cleanup } = await contextWithCalendar(
    workspace,
    [{ tema: "Como organizar estoque de celular", palavraChaveAlvo: "estoque celular", publicado: false }],
    [{ tema: "t", titulo: "Guia completo de atendimento via WhatsApp para assistência técnica", slug: "s", publicadoEm: "2026-01-01T00:00:00Z" }],
  );
  try {
    const result = await ensureContentBacklog(ctx, undefined, {
      generate: async () => [
        opportunity({ tema: "Como organizar estoque de celular", palavraChaveAlvo: "outra palavra" }), // tema duplicado
        opportunity({ tema: "Outro tema qualquer", palavraChaveAlvo: "estoque celular" }), // keyword duplicada
        opportunity({ tema: "Fale mal do concorrente X aqui", palavraChaveAlvo: "concorrente x review" }), // termo proibido
        opportunity({ tema: "Guia completo de atendimento via WhatsApp para assistências técnicas", palavraChaveAlvo: "whatsapp atendimento" }), // muito similar a post publicado
        opportunity({ tema: "Tema totalmente novo e único sobre garantia estendida", palavraChaveAlvo: "garantia estendida" }), // válido
      ],
    });
    assert.equal(result.generated, 1);
    assert.equal(result.discardedDuplicates, 3);
    assert.equal(result.discardedForbidden, 1);
    const all = await getAllTopics(ctx);
    assert.ok(all.some((t) => t.tema === "Tema totalmente novo e único sobre garantia estendida"));
  } finally {
    await cleanup();
  }
});

test("falha do Director: registra erro, não altera o calendário, pipeline pode seguir com a pauta pendente antiga", async () => {
  const workspace = baseWorkspace({ contentStrategy: { minimumPendingTopics: 3, replenishAmount: 5 } });
  const { ctx, cleanup } = await contextWithCalendar(workspace, [
    { tema: "Tema pendente antigo", palavraChaveAlvo: "antigo", publicado: false },
  ]);
  try {
    const events: PipelineEvent[] = [];
    const result = await ensureContentBacklog(ctx, (e) => events.push(e), {
      generate: async () => { throw new Error("provider indisponível"); },
    });
    assert.equal(result.pendingBefore, 1);
    assert.equal(result.generated, 0);
    assert.equal(result.pendingAfter, 1);
    assert.match(result.error ?? "", /provider indisponível/);
    assert.ok(events.some((e) => e.agent === "marketing-director" && e.status === "error"));

    const all = await getAllTopics(ctx);
    assert.equal(all.length, 1);
    assert.equal(all[0].tema, "Tema pendente antigo");
  } finally {
    await cleanup();
  }
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --import tsx --test src/backlog.test.ts`
Expected: FAIL with "Cannot find module './backlog.js'"

- [ ] **Step 3: Implement `src/backlog.ts`**

```ts
// src/backlog.ts
import { countPendingTopics, getAllTopics, addTopics } from "./contentCalendar.js";
import { getHistory } from "./history.js";
import { generateContentBacklog, type ContentOpportunity, type GenerateContentBacklogOptions } from "./lib/marketingDirector.js";
import { normalizeText, jaccardSimilarity } from "./lib/text.js";
import { emit, type OnEvent } from "./pipelineEvents.js";
import type { WorkspaceContext } from "./context.js";

const DEFAULT_STRATEGY = { minimumPendingTopics: 5, replenishAmount: 15 };
const SIMILARITY_THRESHOLD = 0.6;

export interface BacklogResult {
  skipped: boolean;
  pendingBefore: number;
  generated: number;
  discardedDuplicates: number;
  discardedForbidden: number;
  discardedInvalid: number;
  pendingAfter: number;
  error: string | null;
}

export interface ValidateOpportunitiesOptions {
  existingThemes: string[];
  existingKeywords: string[];
  publishedTitles: string[];
  forbiddenTerms: string[];
  maxCount: number;
}

export interface ValidationResult {
  accepted: ContentOpportunity[];
  discardedDuplicates: number;
  discardedForbidden: number;
  discardedInvalid: number;
}

function isWellFormed(opportunity: ContentOpportunity): boolean {
  return Boolean(opportunity.tema?.trim()) && Boolean(opportunity.palavraChaveAlvo?.trim());
}

/**
 * Aplica as regras de negócio antes de persistir: descarta tema/palavra-chave
 * duplicados, pautas muito parecidas com temas/títulos existentes (via
 * similaridade de Jaccard — sem embeddings/RAG, fora de escopo desta fase),
 * termos proibidos da marca, e limita à quantidade máxima configurada.
 */
export function validateOpportunities(
  opportunities: ContentOpportunity[],
  options: ValidateOpportunitiesOptions,
): ValidationResult {
  const accepted: ContentOpportunity[] = [];
  const seenThemes = new Set(options.existingThemes.map(normalizeText));
  const seenKeywords = new Set(options.existingKeywords.map(normalizeText));
  const forbiddenNorm = options.forbiddenTerms.map(normalizeText);
  let discardedDuplicates = 0;
  let discardedForbidden = 0;
  let discardedInvalid = 0;

  for (const opportunity of opportunities) {
    if (accepted.length >= options.maxCount) break;
    if (!isWellFormed(opportunity)) {
      discardedInvalid++;
      continue;
    }

    const temaNorm = normalizeText(opportunity.tema);
    const keywordNorm = normalizeText(opportunity.palavraChaveAlvo);

    if (forbiddenNorm.some((term) => temaNorm.includes(term) || keywordNorm.includes(term))) {
      discardedForbidden++;
      continue;
    }

    if (seenThemes.has(temaNorm) || seenKeywords.has(keywordNorm)) {
      discardedDuplicates++;
      continue;
    }

    const tooSimilar =
      options.existingThemes.some((t) => jaccardSimilarity(t, opportunity.tema) >= SIMILARITY_THRESHOLD) ||
      options.publishedTitles.some((t) => jaccardSimilarity(t, opportunity.tema) >= SIMILARITY_THRESHOLD) ||
      accepted.some((a) => jaccardSimilarity(a.tema, opportunity.tema) >= SIMILARITY_THRESHOLD);

    if (tooSimilar) {
      discardedDuplicates++;
      continue;
    }

    seenThemes.add(temaNorm);
    seenKeywords.add(keywordNorm);
    accepted.push(opportunity);
  }

  return { accepted, discardedDuplicates, discardedForbidden, discardedInvalid };
}

export interface EnsureContentBacklogOptions {
  generate?: (ctx: WorkspaceContext, options: GenerateContentBacklogOptions) => Promise<ContentOpportunity[]>;
}

/**
 * Garante que o calendário sempre tenha pautas suficientes para o pipeline
 * seguir rodando. NUNCA lança — qualquer falha do Marketing Director vira um
 * evento "error" e um `BacklogResult.error`, deixando o pipeline decidir o
 * que fazer (seguir com um tópico pendente antigo, ou encerrar se não sobrou
 * nenhum — essa decisão é do chamador, não desta função).
 */
export async function ensureContentBacklog(
  ctx: WorkspaceContext,
  onEvent?: OnEvent,
  options: EnsureContentBacklogOptions = {},
): Promise<BacklogResult> {
  const strategy = ctx.workspace.contentStrategy ?? DEFAULT_STRATEGY;
  const pendingBefore = await countPendingTopics(ctx);

  if (pendingBefore >= strategy.minimumPendingTopics) {
    return {
      skipped: true, pendingBefore, generated: 0,
      discardedDuplicates: 0, discardedForbidden: 0, discardedInvalid: 0,
      pendingAfter: pendingBefore, error: null,
    };
  }

  emit(onEvent, {
    agent: "marketing-director", status: "working",
    message: `Backlog com ${pendingBefore} tópico(s) pendente(s) (mínimo: ${strategy.minimumPendingTopics}) — analisando contexto do workspace...`,
  });

  try {
    const [allTopics, history] = await Promise.all([getAllTopics(ctx), getHistory(ctx)]);
    const existingThemes = allTopics.map((t) => t.tema);
    const existingKeywords = allTopics.map((t) => t.palavraChaveAlvo);
    const publishedTitles = history.map((h) => h.titulo);

    const generate = options.generate ?? generateContentBacklog;
    const opportunities = await generate(ctx, {
      count: strategy.replenishAmount,
      existingThemes, existingKeywords, publishedTitles,
    });

    emit(onEvent, { agent: "marketing-director", status: "working", message: `Identificou ${opportunities.length} oportunidade(s) de conteúdo.` });

    const { accepted, discardedDuplicates, discardedForbidden, discardedInvalid } = validateOpportunities(opportunities, {
      existingThemes, existingKeywords, publishedTitles,
      forbiddenTerms: ctx.workspace.brand.forbiddenTerms ?? [],
      maxCount: strategy.replenishAmount,
    });

    await addTopics(ctx, accepted);
    const pendingAfter = pendingBefore + accepted.length;
    const totalDiscarded = discardedDuplicates + discardedForbidden + discardedInvalid;

    emit(onEvent, {
      agent: "marketing-director", status: "done",
      message: `${accepted.length} nova(s) pauta(s) adicionada(s) ao calendário${totalDiscarded > 0 ? ` (${totalDiscarded} descartada(s))` : ""}.`,
    });

    return { skipped: false, pendingBefore, generated: accepted.length, discardedDuplicates, discardedForbidden, discardedInvalid, pendingAfter, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    emit(onEvent, { agent: "marketing-director", status: "error", message: `Falha ao gerar backlog de conteúdo: ${message}` });
    return {
      skipped: false, pendingBefore, generated: 0,
      discardedDuplicates: 0, discardedForbidden: 0, discardedInvalid: 0,
      pendingAfter: pendingBefore, error: message,
    };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --import tsx --test src/backlog.test.ts`
Expected: PASS (all 7 tests)

- [ ] **Step 5: Verify build**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 6: Register the test in `src/tests.ts`**

Add `import "./backlog.test.js";` to `src/tests.ts`.

- [ ] **Step 7: Commit**

```bash
git add src/backlog.ts src/backlog.test.ts src/tests.ts
git commit -m "feat: add ensureContentBacklog orchestration with dedup/validation"
```

---

### Task 8: Wire `ensureContentBacklog` into the pipeline

**Files:**
- Modify: `src/pipeline.ts`
- Test: `src/pipeline.test.ts`

**Interfaces:**
- Consumes: `ensureContentBacklog`, `BacklogResult` from `src/backlog.ts` (Task 7).
- Produces: `PipelineResult { tema: string | null; slugPublicado: string | null; usage: AnthropicUsage; backlog: BacklogResult }` (was `PipelineResult | null` — the `| null` union is removed, `runPipeline` now always resolves to a `PipelineResult`) — consumed by `src/index.ts` and `src/server.ts` (Task 9).

This changes `runPipeline`'s return type from `PipelineResult | null` to always `PipelineResult` (with `tema`/`slugPublicado` now nullable fields instead of the whole result being `null`). `npm run build` will still pass after this task — `src/index.ts`'s existing `if (result) { ... } else { ... }` stays valid TypeScript since `result` is now always a truthy object — but its `else` ("sem-tema") branch becomes dead code and `result.backlog` is not read yet, so a real pipeline run with an empty calendar would misreport as `"publicado"` with `tema: null` until Task 9 fixes `src/index.ts` to match the new contract. Don't run the real pipeline (`npm run run` / the panel's "Rodar agora") against a workspace between Task 8 and Task 9 — `npm run build && npm test` is sufficient to verify this task in isolation.

- [ ] **Step 1: Write the failing test**

```ts
// src/pipeline.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import { buildWorkspaceContext } from "./context.js";
import type { MarketingWorkspace } from "./workspace.js";
import type { SecretProvider } from "./lib/secrets.js";
import { createTempWorkspace } from "./testing/tempWorkspace.js";
import { runPipeline } from "./pipeline.js";
import type { PipelineEvent } from "./pipelineEvents.js";

const workspace: MarketingWorkspace = {
  id: "acme", name: "Acme", active: true,
  brand: { name: "Acme", description: "d", toneOfVoice: "t", targetAudience: [], competitors: [] },
  goals: { primary: "leads" },
  channels: { blog: true, instagram: false, linkedin: false },
  integrations: { siteUrl: "https://acme.test", cms: { provider: "nextassist", apiUrl: "https://api.acme.test" } },
  autonomy: { mode: "copilot" },
  secrets: { required: [] },
  contentStrategy: { minimumPendingTopics: 1, replenishAmount: 5 },
};

function fakeSecrets(): SecretProvider {
  return { async get() { return undefined; } };
}

test("runPipeline com calendário vazio e sem provider de IA: reabastecimento falha, retorna resultado vazio com backlog.error", async () => {
  const temp = await createTempWorkspace("acme", { "content-calendar.json": { topicos: [] }, "post-history.json": [] });
  try {
    const ctx = await buildWorkspaceContext(workspace, fakeSecrets(), {
      workspacesRoot: temp.root,
      requireAiProvider: false,
    });
    const events: PipelineEvent[] = [];
    const result = await runPipeline(ctx, (event) => events.push(event));

    assert.equal(result.tema, null);
    assert.equal(result.slugPublicado, null);
    assert.equal(result.backlog.pendingBefore, 0);
    assert.ok(result.backlog.error);
    assert.ok(events.some((e) => e.agent === "marketing-director" && e.status === "error"));
    assert.ok(events.some((e) => e.agent === "pesquisa-pauta" && e.status === "error" && /Nenhum tópico pendente/.test(e.message ?? "")));
  } finally {
    await temp.cleanup();
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test src/pipeline.test.ts`
Expected: FAIL — `result.tema` is `undefined`/crashes because `runPipeline` currently returns `null` in this scenario (`result.tema` throws on `null`), and `result.backlog` doesn't exist yet.

- [ ] **Step 3: Update `src/pipeline.ts`**

Replace the imports and the top of `runPipeline` — the full new file:

```ts
// src/pipeline.ts
import { getNextTopic, markTopicPublished } from "./contentCalendar.js";
import { ensureContentBacklog } from "./backlog.js";
import { researchMarket } from "./agents/marketResearch.js";
import { planTopic } from "./agents/topicPlanner.js";
import { writeArticle } from "./agents/writer.js";
import { editAndFinalize } from "./agents/editorSeo.js";
import { publishPost } from "./agents/publisher.js";
import { publishToInstagram } from "./agents/instagramPublisher.js";
import { indexPublishedPost, postUrl } from "./agents/indexer.js";
import { appendHistory } from "./history.js";
import { validateFinalPost } from "./lib/contentQuality.js";
import { emit, type OnEvent } from "./pipelineEvents.js";
import type { BacklogResult } from "./backlog.js";
import type { WorkspaceContext, AnthropicUsage } from "./context.js";

export type { AgentId, AgentStatus, PipelineEvent, OnEvent } from "./pipelineEvents.js";

async function getPublishedSlugs(ctx: WorkspaceContext): Promise<string[]> {
  const response = await fetch(`${ctx.workspace.integrations.cms.apiUrl}/blog/posts`, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`Não foi possível carregar posts existentes: HTTP ${response.status}`);
  const payload = (await response.json()) as { data?: Array<{ slug?: string }> };
  return (payload.data ?? []).map((post) => post.slug).filter((slug): slug is string => Boolean(slug));
}

export interface PipelineResult {
  tema: string | null;
  slugPublicado: string | null;
  usage: AnthropicUsage;
  backlog: BacklogResult;
}

/**
 * Roda o pipeline completo uma vez para um workspace: reabastecimento de
 * backlog (Marketing Director, se necessário) → pesquisa de mercado →
 * pesquisa de pauta → redação → edição/SEO → publicação → Instagram →
 * indexação. Chama `onEvent` a cada mudança de estado de um agente.
 *
 * Recebe o `WorkspaceContext` já construído pelo chamador (entrypoint ou
 * painel) — não resolve workspace/segredos por conta própria, para não
 * reconstruir o contexto (e reautenticar) mais de uma vez por execução.
 */
export async function runPipeline(ctx: WorkspaceContext, onEvent?: OnEvent): Promise<PipelineResult> {
  const backlog = await ensureContentBacklog(ctx, onEvent);
  const topic = await getNextTopic(ctx);
  if (!topic) {
    const detail = backlog.error ? ` Motivo do reabastecimento não ter resolvido: ${backlog.error}` : "";
    emit(onEvent, { agent: "pesquisa-pauta", status: "error", message: `Nenhum tópico pendente no calendário.${detail}` });
    return { tema: null, slugPublicado: null, usage: ctx.usage.get(), backlog };
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
    validateFinalPost(finalPost, publishedSlugs, {
      palavraChaveAlvo: topic.palavraChaveAlvo,
      requiredLinks: ctx.workspace.brand.requiredLinks,
    });
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

    return { tema: topic.tema, slugPublicado: publishedSlug, usage: ctx.usage.get(), backlog };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    emit(onEvent, { agent: "publicador", status: "error", message });
    const wrapped = err instanceof Error ? err : new Error(message);
    (wrapped as Error & { usage?: AnthropicUsage }).usage = ctx.usage.get();
    throw wrapped;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test src/pipeline.test.ts`
Expected: PASS

- [ ] **Step 5: Register the test in `src/tests.ts`**

Add `import "./pipeline.test.js";` to `src/tests.ts`.

- [ ] **Step 6: Commit**

```bash
git add src/pipeline.ts src/pipeline.test.ts src/tests.ts
git commit -m "feat: run ensureContentBacklog before topic selection in pipeline"
```

Note: `npm run build` stays green after this task (see the explanation above), but `src/index.ts`'s "sem-tema" branch is now unreachable dead code and doesn't yet record `result.backlog` — Task 9 fixes both. `src/server.ts` needs no change at all — it already discards `runPipeline`'s return value.

---

### Task 9: Persist `BacklogResult` in run history

**Files:**
- Modify: `src/runsHistory.ts`
- Modify: `src/index.ts`

**Interfaces:**
- Consumes: `PipelineResult` (Task 8, always resolves, has `backlog: BacklogResult`), `BacklogResult` from `src/backlog.ts` (Task 7).
- Produces: `RunRecord.backlog?: BacklogResult`.

- [ ] **Step 1: Add `backlog` to `RunRecord`**

In `src/runsHistory.ts`, add the import and field:

```ts
import { readFile, writeFile } from "node:fs/promises";
import { readStateJson } from "./lib/dataSource.js";
import type { WorkspaceContext } from "./context.js";
import type { PipelineEvent } from "./pipeline.js";
import type { AnthropicUsage } from "./context.js";
import type { BacklogResult } from "./backlog.js";

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
  backlog?: BacklogResult;
}
```

(The rest of `src/runsHistory.ts` — `loadLocal`, `appendRun`, `getRuns` — is unchanged.)

- [ ] **Step 2: Update `src/index.ts` for the new (always-resolved) `runPipeline` contract**

Replace `src/index.ts` in full:

```ts
// src/index.ts
import { runPipeline, type PipelineEvent } from "./pipeline.js";
import { appendRun, type RunRecord, type RunStatus } from "./runsHistory.js";
import { loadWorkspace } from "./workspace.js";
import { EnvSecretProvider } from "./lib/secrets.js";
import { buildWorkspaceContext, type AnthropicUsage } from "./context.js";
import { pushEventToPanel } from "./lib/panelIngest.js";
import type { BacklogResult } from "./backlog.js";

const workspaceId = process.env.WORKSPACE_ID ?? "nextassist";
const eventos: PipelineEvent[] = [];
const iniciadoEm = new Date().toISOString();
const origem = process.env.GITHUB_ACTIONS === "true" ? "action" : "manual";

const ctx = await (async () => {
  try {
    const workspace = await loadWorkspace(workspaceId);
    return await buildWorkspaceContext(workspace, new EnvSecretProvider());
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Falha ao resolver o workspace "${workspaceId}":`, message);
    process.exit(1);
  }
})();

/** Grava o registro de execução, reaproveitando o mesmo WorkspaceContext da execução. */
function finalize(status: RunStatus, tema: string | null, slug: string | null, erro: string | null, usage?: AnthropicUsage, backlog?: BacklogResult) {
  const record: RunRecord = {
    id: iniciadoEm, origem, iniciadoEm, finalizadoEm: new Date().toISOString(),
    tema, status, slug, erro, eventos, usage, backlog,
  };
  return appendRun(ctx, record);
}

try {
  const result = await runPipeline(ctx, (event) => {
    console.log(`[${workspaceId}][${event.agent}] ${event.status}${event.message ? " — " + event.message : ""}`);
    eventos.push(event);
    void pushEventToPanel(workspaceId, event);
  });

  if (result.slugPublicado) {
    console.log(`Post publicado: /blog/${result.slugPublicado}`);
    await finalize("publicado", result.tema, result.slugPublicado, null, result.usage, result.backlog);
  } else {
    console.log("Nenhum tópico pendente no calendário.");
    await finalize("sem-tema", null, null, null, result.usage, result.backlog);
  }
  process.exit(0);
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  console.error("Falha no pipeline:", message);
  const tema = eventos.find((e) => e.tema)?.tema ?? null;
  const usage = (err as Error & { usage?: AnthropicUsage }).usage;
  await finalize("falhou", tema, null, message, usage);
  process.exit(1);
}
```

- [ ] **Step 3: Verify build and full suite**

Run: `npm run build && npm test`
Expected: both succeed — this closes out the type errors left open at the end of Task 8.

- [ ] **Step 4: Commit**

```bash
git add src/runsHistory.ts src/index.ts
git commit -m "feat: persist backlog replenishment result in run history"
```

---

### Task 10: Enable `contentStrategy` for the `nextassist` workspace, final verification

**Files:**
- Modify: `workspaces/nextassist/workspace.json`

- [ ] **Step 1: Add the `contentStrategy` block**

In `workspaces/nextassist/workspace.json`, add after the `"autonomy"` block (before `"secrets"`):

```json
  "autonomy": {
    "mode": "semi-autonomous"
  },
  "contentStrategy": {
    "minimumPendingTopics": 5,
    "replenishAmount": 15
  },
  "secrets": {
```

(Keep the rest of the file — `brand`, `goals`, `channels`, `integrations`, `secrets` — exactly as-is; this is a single additive block.)

- [ ] **Step 2: Verify the workspace still loads correctly**

Run: `node --import tsx -e "import('./src/workspace.js').then(m => m.loadWorkspace('nextassist')).then(w => console.log(w.contentStrategy))"`
Expected: prints `{ minimumPendingTopics: 5, replenishAmount: 15 }` with no error.

- [ ] **Step 3: Full verification pass**

Run: `npm run build && npm test`
Expected: both succeed. This is the final gate — every task before this one already left the tree green, so this should be a no-op confirmation.

- [ ] **Step 4: Walk the acceptance criteria from the spec**

Confirm each one against what was actually built (no code changes in this step, just a checklist pass — re-open `docs/superpowers/specs/2026-08-17-marketing-director-backlog.md` and tick through it):

- Pipeline doesn't stop just because the calendar ran out (Task 8: `ensureContentBacklog` runs before `getNextTopic`).
- Threshold configurable per workspace (Task 2 + Task 10).
- Director generates structured pautas (Task 6: `ContentOpportunity[]`, schema-validated).
- Duplicates blocked (Task 7: `validateOpportunities`).
- New pautas persisted per workspace (Task 4: `addTopics` writes to `ctx.paths.calendar`).
- Pipeline continues with the first available pauta after replenishment (Task 8: `getNextTopic` runs right after `ensureContentBacklog`, same as before).
- Events appear in the panel (Task 1: `marketing-director` in `AgentId`/`AGENT_IDS`/`AGENTS` roster; Task 7: `emit(...)` calls).
- History records the replenishment (Task 9: `RunRecord.backlog`).
- Director failure doesn't corrupt the calendar (Task 7: `addTopics` only called after successful generation+validation; failure path never touches the file).
- `npm run build` passes (Step 3 above).
- `npm test` passes (Step 3 above).
- Tests for full/low/empty calendar, duplicates, and Director failure (Task 7's `src/backlog.test.ts`, plus Task 4's `src/contentCalendar.test.ts` and Task 8's `src/pipeline.test.ts`).

- [ ] **Step 5: Commit**

```bash
git add workspaces/nextassist/workspace.json
git commit -m "feat: enable contentStrategy backlog replenishment for nextassist"
```

---

## Manual/Follow-up Notes (not part of this plan's scope)

- The Marketing Director's LLM call (`generateContentBacklog`) consumes tokens like any other agent — it's already tracked via `ctx.usage` (Task 8 always returns `usage: ctx.usage.get()`), so cost shows up in the existing usage/cost reporting with no extra work.
- `getTopSearchQueries` (Task 5) needs `integrations.searchConsole.siteUrl` configured on the workspace to return anything — `nextassist` already has this; workspaces without it simply get an empty list (documented as "quando disponível" in the spec).
- If a future workspace wants a different `minimumPendingTopics`/`replenishAmount`, just add the `contentStrategy` block to its `workspace.json` (Task 2 already validates it); no code changes needed.
