# Agent Office Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current 2-item dashboard shell with a 9-page "Agent Office" navigation (dark theme), add a Reel generation timeline/B-roll detail view backed by new persisted data, and reorganize existing panels into dedicated pages.

**Architecture:** Backend first (persist Reel `scenes`/`timelineSteps`, add two read-only endpoints), then a Tailwind + `react-router-dom` shell, then 9 route-level pages built by migrating existing self-contained panel components (`useWorkspace()` + own `apiGet` fetch, no props) — each existing panel is reused as-is or lightly extended, never rewritten from scratch.

**Tech Stack:** Node/Express (backend, `src/`), React 18 + Vite + TypeScript (frontend, `web/`), Tailwind CSS (new), `react-router-dom` (new), `node:test` (backend tests), Vitest + Testing Library (frontend tests, already configured).

**Spec:** [docs/superpowers/specs/2026-09-15-agent-office-redesign-design.md](../specs/2026-09-15-agent-office-redesign-design.md)

## Global Constraints

- Retrocompatibility: `ReelRecord.scenes`/`timelineSteps` are optional — existing reels without them must keep working (spec, Fase 1).
- `GET /api/reels` (list) contract **does not change** — scenes/timeline only ever appear in the new `GET /api/reels/:id` (spec, Fase 1).
- No HeyGen credit/quota endpoint is implemented in this plan — the Finance Agent card shows AI cost only, explicitly labeled as such (spec, "Fora de escopo").
- No new write-actions for Sales/Revenue in the agent drill-down "Ações" tab — read-only except Reels, which keep their existing `/reels` review/publish flow (spec, "Fora de escopo").
- All new frontend data fetching tied to `workspace` must cancel via `AbortController` on workspace change or unmount, per the existing requirement in [2026-09-01-react-panel-shell-design.md](../specs/2026-09-01-react-panel-shell-design.md#requisito-cancelamento-em-toda-requisição-dependente-de-workspace).
- Migration principle: preserve existing panel *behavior*, not their implementation — no DOM-imperative code inside React components (same spec, "Princípio de migração").
- Backend tests run via `npm test` (`node --import tsx --test src/tests.ts`) — every new `*.test.ts` file **must** be added to `src/tests.ts`, or it silently never runs (this exact mistake happened before in this repo — see PR #12 history).
- Frontend tests run via `npm --prefix web run test` (Vitest) — no explicit registry file, `*.test.tsx` next to the component it tests is auto-discovered.

---

## Fase 1 — Backend

### Task 1: `ReelRecord` timeline/scene fields + `appendTimelineStep` helper

**Files:**
- Modify: `src/reels/state.ts:1-38` (types), append new exported function near `patchStoredReel` (~line 113)
- Test: `src/reels/state.test.ts`

**Interfaces:**
- Produces: `TimelineStepName` (union), `TimelineStep { step, at }`, `SceneSummary { type, label, assetId?, thumbnailUrl? }`, `ReelRecord.scenes?: SceneSummary[]`, `ReelRecord.timelineSteps?: TimelineStep[]`, `appendTimelineStep(ctx: WorkspaceContext, reelId: string, step: TimelineStepName): Promise<ReelRecord>` — idempotent (a step already present is not duplicated).

- [ ] **Step 1: Write the failing test**

Append to `src/reels/state.test.ts` (check the file first — if it doesn't exist yet, create it with this content plus the necessary imports mirroring `reconciler.test.ts`'s `fixtureCtx`/`createTempWorkspace` pattern):

```ts
import { appendTimelineStep, createQueuedReel, transitionStoredReel } from "./state.js";

test("appendTimelineStep: adiciona o step com timestamp e é idempotente (não duplica)", async () => {
  const { temp, ctx } = await fixtureCtx();
  try {
    const created = await createQueuedReel(ctx, {
      id: "nextassist:teste", workspaceId: "nextassist", slug: "teste", title: "Teste",
      blogUrl: "https://example.com/teste", caption: "Legenda", provider: "heygen-api",
      avatarId: "avatar", voiceId: "voice",
    });
    await transitionStoredReel(ctx, created.id, "rendering", "system", "Renderização iniciada.");

    const once = await appendTimelineStep(ctx, created.id, "enviado_heygen");
    assert.equal(once.timelineSteps?.length, 1);
    assert.equal(once.timelineSteps?.[0].step, "enviado_heygen");

    const twice = await appendTimelineStep(ctx, created.id, "enviado_heygen");
    assert.equal(twice.timelineSteps?.length, 1); // não duplicou
  } finally {
    await temp.cleanup();
  }
});
```

Use the same `fixtureCtx()` helper already defined in `reconciler.test.ts`/`generator.test.ts` (`createTempWorkspace("nextassist")` + a minimal `WorkspaceContext`); if `state.test.ts` doesn't already define one, copy it verbatim from `reconciler.test.ts` lines 9-13.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test src/reels/state.test.ts`
Expected: FAIL — `appendTimelineStep` is not exported from `./state.js`.

- [ ] **Step 3: Write minimal implementation**

In `src/reels/state.ts`, add after the `ReelAuditEvent` interface (after line 16):

```ts
export type TimelineStepName =
  | "roteiro_gerado"
  | "cenas_montadas"
  | "enviado_heygen"
  | "processando"
  | "video_concluido"
  | "aguardando_aprovacao"
  | "publicado";

export interface TimelineStep {
  step: TimelineStepName;
  at: string;
}

export interface SceneSummary {
  type: "avatar_video" | "video";
  label: string;
  /** Presente só em cenas de B-roll (asset_id do HeyGen). */
  assetId?: string;
  thumbnailUrl?: string;
}
```

Add the two new optional fields to `ReelRecord` (after `audit: ReelAuditEvent[];`, line 37):

```ts
  scenes?: SceneSummary[];
  timelineSteps?: TimelineStep[];
```

Add the helper after `patchStoredReel` (after line 113):

```ts
/**
 * Registra um marco da timeline de geração — idempotente (chamar de novo com
 * o mesmo `step` não duplica), porque o reconciler pode observar o mesmo
 * estado remoto em várias execuções seguidas antes de `completed`.
 */
export async function appendTimelineStep(ctx: WorkspaceContext, reelId: string, step: TimelineStepName): Promise<ReelRecord> {
  const record = await getReel(ctx, reelId);
  if (record.timelineSteps?.some((entry) => entry.step === step)) return record;
  const timelineSteps = [...(record.timelineSteps ?? []), { step, at: new Date().toISOString() }];
  return patchStoredReel(ctx, reelId, { timelineSteps });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test src/reels/state.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/reels/state.ts src/reels/state.test.ts
git commit -m "feat(reels): persist scenes/timelineSteps on ReelRecord"
```

---

### Task 2: Populate `scenes` + roteiro/cenas/envio steps in `generator.ts`

**Files:**
- Modify: `src/reels/generator.ts:1-12` (imports), `:125-143` (heygen-api branch)
- Test: `src/reels/generator.test.ts:42-64` (extend existing test)

**Interfaces:**
- Consumes: `appendTimelineStep`, `SceneSummary` from Task 1 (`./state.js`); `StudioScene` from `./studioScenes.js`; `BrollAsset` from `./broll.js`.
- Produces: `toSceneSummaries(scenes: StudioScene[], broll: BrollAsset[]): SceneSummary[]` (module-private, not exported — only `generator.ts` needs it).

- [ ] **Step 1: Write the failing test**

Modify the existing test in `src/reels/generator.test.ts` (lines 42-64) — add assertions after the existing ones (after line 60, before the closing `finally`):

```ts
test("generateInstagramReelDraft (heygen-api): envia ao HeyGen via Studio multi-cena, persiste rendering+videoId e retorna sem esperar conclusão", async () => {
  const { temp, ctx } = await fixtureCtx();
  try {
    let calls = 0;
    let body: { type?: string; scenes?: unknown[] } = {};
    const record = await withFetch(async (url, init) => {
      calls++;
      assert.equal(url, "https://api.heygen.com/v3/videos");
      assert.equal(init?.method, "POST");
      body = JSON.parse(String(init?.body));
      return Response.json({ data: { video_id: "hg_new", status: "waiting" } });
    }, () => generateInstagramReelDraft(ctx, post, "https://x.test/teste", { caption: "c", prompt: "p", brief }));

    assert.equal(calls, 1);
    assert.equal(body.type, "studio");
    assert.equal(body.scenes?.length, 7);
    assert.equal(record.status, "rendering");
    assert.equal(record.videoId, "hg_new");
    assert.equal(record.provider, "heygen-api");

    // novo: scenes persistidas com rótulos, e a timeline registra os 3 marcos de envio.
    assert.equal(record.scenes?.length, 7);
    assert.deepEqual(record.scenes?.map((s) => s.type), [
      "avatar_video", "video", "video", "avatar_video", "video", "video", "avatar_video",
    ]);
    assert.ok(record.scenes?.every((s) => s.type === "video" ? Boolean(s.assetId) : true));
    const stepNames = record.timelineSteps?.map((s) => s.step);
    assert.deepEqual(stepNames, ["roteiro_gerado", "cenas_montadas", "enviado_heygen"]);
  } finally {
    await temp.cleanup();
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test src/reels/generator.test.ts`
Expected: FAIL — `record.scenes` is `undefined`.

- [ ] **Step 3: Write minimal implementation**

In `src/reels/generator.ts`, extend the imports (replace lines 10-12):

```ts
import { selectBrollForPost, type BrollAsset } from "./broll.js";
import { buildStudioScenes, type StudioScene } from "./studioScenes.js";
import { createQueuedReel, findReel, patchStoredReel, planReelGeneration, transitionStoredReel, appendTimelineStep, type ReelRecord, type SceneSummary } from "./state.js";
```

Add a module-private mapper above `generateInstagramReelDraft` (after `providerLabel`, before `renderWithHeyGenMcp`):

```ts
function toSceneSummaries(scenes: StudioScene[], broll: BrollAsset[]): SceneSummary[] {
  const brollById = new Map(broll.map((asset) => [asset.assetId, asset]));
  return scenes.map((scene, index) => {
    if (scene.type === "avatar_video") {
      const label = index === 0 ? "Abertura (avatar)" : index === scenes.length - 1 ? "Fechamento / CTA (avatar)" : "Transição (avatar)";
      return { type: "avatar_video" as const, label };
    }
    const asset = brollById.get(scene.source.asset_id);
    return { type: "video" as const, label: asset?.label ?? "B-roll", assetId: scene.source.asset_id };
  });
}
```

Replace the heygen-api branch (lines 128-138):

```ts
  try {
    if (!input.brief) throw new Error("HeyGen API (Studio) exige o roteiro estruturado (brief) para montar as cenas.");
    await appendTimelineStep(ctx, reelId, "roteiro_gerado");
    const client = createHeyGenApiClient(ctx, ctx.workspace.id);
    const broll = selectBrollForPost(post);
    const scenes = buildStudioScenes({ brief: input.brief, broll, avatarId: strategy.avatarId, voiceId: strategy.voiceId });
    await appendTimelineStep(ctx, reelId, "cenas_montadas");
    const { videoId } = await client.generateStudio({
      title: `NextAssist - ${post.titulo}`,
      scenes,
      aspectRatio: strategy.format ?? "9:16",
    });
    await patchStoredReel(ctx, reelId, { videoId, scenes: toSceneSummaries(scenes, broll) });
    return await appendTimelineStep(ctx, reelId, "enviado_heygen");
  } catch (err) {
```

(The `catch` block below is unchanged.)

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test src/reels/generator.test.ts`
Expected: PASS (all tests in the file, including the 4 pre-existing ones — confirm none regressed).

- [ ] **Step 5: Commit**

```bash
git add src/reels/generator.ts src/reels/generator.test.ts
git commit -m "feat(reels): record scenes and send-timeline steps in the Studio generator"
```

---

### Task 3: `processando`/`video_concluido` steps in `reconciler.ts`

**Files:**
- Modify: `src/reels/reconciler.ts:2-3` (imports), `:48-59`
- Test: `src/reels/reconciler.test.ts` (extend)

**Interfaces:**
- Consumes: `appendTimelineStep` from Task 1.

- [ ] **Step 1: Write the failing test**

Add to `src/reels/reconciler.test.ts`, after the existing `remoteStatus` loop test (after line 53):

```ts
test("reconcileReelWithRemote: still-rendering registra o step 'processando' uma única vez mesmo em polls repetidos", async () => {
  const { temp, ctx } = await fixtureCtx();
  try {
    const record = await renderingReel(ctx);
    const client = fakeClient(async () => ({ status: "rendering" }));
    const first = await reconcileReelWithRemote(ctx, client, record);
    const second = await reconcileReelWithRemote(ctx, client, first.record);
    assert.deepEqual(second.record.timelineSteps?.map((s) => s.step), ["processando"]);
  } finally {
    await temp.cleanup();
  }
});

test("reconcileReelWithRemote: completed registra o step 'video_concluido'", async () => {
  const { temp, ctx } = await fixtureCtx();
  try {
    const record = await renderingReel(ctx);
    const client = fakeClient(async () => ({ status: "completed", videoUrl: "https://files.heygen.ai/v.mp4" }));
    const result = await reconcileReelWithRemote(ctx, client, record);
    assert.deepEqual(result.record.timelineSteps?.map((s) => s.step), ["video_concluido"]);
  } finally {
    await temp.cleanup();
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test src/reels/reconciler.test.ts`
Expected: FAIL — `timelineSteps` is `undefined`.

- [ ] **Step 3: Write minimal implementation**

In `src/reels/reconciler.ts`, extend the import (line 3):

```ts
import { getReelState, transitionStoredReel, appendTimelineStep, type ReelRecord } from "./state.js";
```

Replace lines 48-59:

```ts
  if (remote.status === "queued" || remote.status === "rendering") {
    const withStep = await appendTimelineStep(ctx, current.id, "processando");
    return { record: withStep, outcome: "still-rendering" };
  }

  if (remote.status === "completed") {
    if (!remote.videoUrl) return { record: current, outcome: "inconclusive" };
    const done = await transitionStoredReel(
      ctx, current.id, "pending_approval", "system", "HeyGen concluiu a renderização.",
      { videoUrl: remote.videoUrl, error: undefined },
    );
    const withStep = await appendTimelineStep(ctx, done.id, "video_concluido");
    return { record: withStep, outcome: "completed" };
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test src/reels/reconciler.test.ts`
Expected: PASS (all tests in the file).

- [ ] **Step 5: Commit**

```bash
git add src/reels/reconciler.ts src/reels/reconciler.test.ts
git commit -m "feat(reels): record processing/completed timeline steps in the reconciler"
```

---

### Task 4: `publicado` step in `publisher.ts`

**Files:**
- Modify: `src/reels/publisher.ts:2` (import), `:31-35`
- Test: `src/reels/publisher.test.ts` (extend — check the file's existing fixture pattern first, it should mirror `reconciler.test.ts`)

**Interfaces:**
- Consumes: `appendTimelineStep` from Task 1.

- [ ] **Step 1: Write the failing test**

Read `src/reels/publisher.test.ts` first to match its existing fixture/`fakePublisher` pattern, then add:

```ts
test("publishApprovedInstagramReel: registra o step 'publicado' na timeline", async () => {
  const { temp, ctx } = await fixtureCtx();
  try {
    const approved = await approvedReel(ctx); // ou o helper equivalente já usado no arquivo para chegar a status "approved" com videoUrl
    const record = await publishApprovedInstagramReel(ctx, approved.id, {
      publish: async () => ({ mediaId: "media_1", permalink: "https://instagram.com/p/1" }),
    });
    assert.deepEqual(record.timelineSteps?.map((s) => s.step), ["publicado"]);
  } finally {
    await temp.cleanup();
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test src/reels/publisher.test.ts`
Expected: FAIL — `timelineSteps` is `undefined`.

- [ ] **Step 3: Write minimal implementation**

In `src/reels/publisher.ts`, extend the import (line 2):

```ts
import { getReelState, transitionStoredReel, appendTimelineStep, type ReelRecord } from "./state.js";
```

Replace lines 31-35:

```ts
    await transitionStoredReel(ctx, reelId, "published", "system", "Reel publicado.", {
      mediaId: result.mediaId,
      permalink: result.permalink,
      error: undefined,
    });
    return await appendTimelineStep(ctx, reelId, "publicado");
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test src/reels/publisher.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/reels/publisher.ts src/reels/publisher.test.ts
git commit -m "feat(reels): record the published timeline step"
```

---

### Task 5: `GET /api/reels/:id`

**Files:**
- Modify: `src/reels/routes.ts:1-4` (import), append route after line 47 (after the existing `router.get("/", ...)` handler)

**Interfaces:**
- Consumes: `findReel` from `./state.js` (already exists, Task 1 doesn't change its signature).
- Produces: `GET /api/reels/:id?workspace=<id>` → `200` with the full `ReelRecord` (including `scenes`/`timelineSteps`), or `404 { error }` if not found, or `400 { error }` if `?workspace=` is missing.

No automated test for this task — **by design**, matching the existing codebase boundary: no route in `src/server.ts` or `src/reels/routes.ts` has a direct HTTP-level unit test today (`supertest` isn't a dependency, and adding one is a separate infrastructure decision out of scope for this redesign). `findReel` itself is already covered by `state.test.ts`. Verify this route manually instead.

- [ ] **Step 1: Implement the route**

In `src/reels/routes.ts`, extend the import (line 4):

```ts
import { getReelState, findReel } from "./state.js";
```

Add after the closing `});` of the existing `router.get("/", ...)` handler (after line 47):

```ts
  router.get("/:id", async (req, res, next) => {
    try {
      const workspaceId = String(req.query.workspace ?? "").trim();
      if (!workspaceId) {
        res.status(400).json({ error: "Parâmetro ?workspace= é obrigatório." });
        return;
      }
      const record = await findReel(await options.contextFor(workspaceId), req.params.id);
      if (!record) {
        res.status(404).json({ error: "Reel não encontrado." });
        return;
      }
      res.json(record);
    } catch (err) {
      next(err);
    }
  });
```

- [ ] **Step 2: Build and start the server**

Run: `npm run build && node dist/server.js` (or `npm run office` for a dev run)
Expected: starts without error, logs `Marketing AI Office em http://localhost:...`.

- [ ] **Step 3: Verify manually with curl**

Find a real reel id first (from the running dashboard's Reels panel, or `workspaces/nextassist/reel-state.json`), then:

```bash
curl -s "http://localhost:4173/api/reels/nextassist%3A<slug>?workspace=nextassist" | head -c 500
curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:4173/api/reels/nextassist%3Adoes-not-exist?workspace=nextassist"
curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:4173/api/reels/anything"
```

Expected: first call returns the full JSON record (200); second returns `404`; third (no `?workspace=`) returns `400`. Note the `:` in the id must be URL-encoded as `%3A` in the curl command — the browser `fetch()` call the frontend will make in Task 12 handles this automatically via `encodeURIComponent`.

- [ ] **Step 4: Commit**

```bash
git add src/reels/routes.ts
git commit -m "feat(reels): add GET /api/reels/:id detail endpoint"
```

---

### Task 6: `GET /api/content-calendar`

**Files:**
- Modify: `src/server.ts:19` (import), add route near line 293 (after the existing `/api/history` route)

**Interfaces:**
- Consumes: `getAllTopics(ctx: WorkspaceContext): Promise<CalendarTopic[]>` from `./contentCalendar.js` (already exists and is already tested in `src/contentCalendar.test.ts`).
- Produces: `GET /api/content-calendar?workspace=<id>` → `200` with `CalendarTopic[]`.

- [ ] **Step 1: Implement the route**

In `src/server.ts`, add to the imports (after line 19):

```ts
import { getAllTopics } from "./contentCalendar.js";
```

Add after the `/api/history` route (after line 293):

```ts
app.get("/api/content-calendar", asyncHandler(async (req, res) => {
  const workspaceId = requireWorkspaceId(req, res); if (!workspaceId) return;
  res.json(await getAllTopics(await contextFor(workspaceId)));
}));
```

- [ ] **Step 2: Verify manually with curl**

```bash
npm run office &
sleep 2
curl -s "http://localhost:4173/api/content-calendar?workspace=nextassist" | head -c 300
curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:4173/api/content-calendar"
```

Expected: first call returns a JSON array of topics (200); second (no `?workspace=`) returns `400`.

- [ ] **Step 3: Commit**

```bash
git add src/server.ts
git commit -m "feat: add GET /api/content-calendar endpoint"
```

---

## Fase 2 — Casca do frontend

### Task 7: Tailwind CSS setup with dark theme tokens

**Files:**
- Modify: `web/package.json` (devDependencies)
- Create: `web/tailwind.config.ts`, `web/postcss.config.js`
- Modify: `web/src/styles.css` (add Tailwind directives at the top)

**Interfaces:**
- Produces: Tailwind utility classes available in every `.tsx` file under `web/src`; color tokens `bg-app`, `bg-surface`, `border-app`, `text-primary`, `text-secondary`, `bg-accent`, `text-status-ok`, `text-status-warn`, `text-status-error` (and their `bg-status-*` counterparts).

- [ ] **Step 1: Install dependencies**

```bash
npm --prefix web install -D tailwindcss@^3 postcss@^8 autoprefixer@^10
```

- [ ] **Step 2: Create the Tailwind config**

Create `web/tailwind.config.ts`:

```ts
import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        app: "#0d1220",
        surface: "#141b2e",
        border: "#1f2940",
        primary: "#e7ebf5",
        secondary: "#8992a5",
        accent: "#7b61ff",
        "status-ok": "#34b56b",
        "status-warn": "#ffb020",
        "status-error": "#e5484d",
      },
    },
  },
  plugins: [],
} satisfies Config;
```

- [ ] **Step 3: Create the PostCSS config**

Create `web/postcss.config.js`:

```js
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
```

- [ ] **Step 4: Add Tailwind directives to the global stylesheet**

At the very top of `web/src/styles.css` (before any existing rule), add:

```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

- [ ] **Step 5: Verify the build picks it up**

Run: `npm --prefix web run build`
Expected: builds without error. Then run `npm --prefix web run dev`, open the dev server URL, and add a throwaway `className="bg-app text-primary p-4"` to any existing element (e.g. `App.tsx`'s outer `div`) to visually confirm the dark background/text color render — then remove the throwaway class (Task 8 applies real classes).

- [ ] **Step 6: Commit**

```bash
git add web/package.json web/package-lock.json web/tailwind.config.ts web/postcss.config.js web/src/styles.css
git commit -m "chore(web): add Tailwind CSS with dark theme tokens"
```

---

### Task 8: Router + 9-item Sidebar + dark Topbar

**Files:**
- Modify: `web/package.json` (dependencies), `web/src/app/App.tsx`, `web/src/components/layout/Sidebar.tsx`, `web/src/components/layout/Topbar.tsx`
- Test: `web/src/app/App.test.tsx` (new)

**Interfaces:**
- Produces: routes `/`, `/agentes`, `/agentes/:agentId`, `/conteudo`, `/reels`, `/reels/:id`, `/blog`, `/leads`, `/clientes`, `/relatorios`, `/configuracoes`, all rendering placeholder `<div>` content in this task (Fase 3 tasks replace the placeholders one page at a time — this task's own tests only check that the *shell* (sidebar links + route switch) works, not final page content).
- Consumes: nothing new from earlier tasks — this task is shell-only.

- [ ] **Step 1: Install react-router-dom**

```bash
npm --prefix web install react-router-dom@^6
```

- [ ] **Step 2: Write the failing test**

Create `web/src/app/App.test.tsx`:

```tsx
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "./App";

class FakeEventSource {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(_url: string) {}
  close() {}
}

describe("App shell", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("renders all 9 sidebar items and navigates between routes", async () => {
    vi.stubGlobal("EventSource", FakeEventSource as unknown as typeof EventSource);
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/workspaces")) {
        return Promise.resolve({ ok: true, json: async () => [{ id: "nextassist", name: "NextAssist" }] });
      }
      if (url.includes("/api/status")) {
        return Promise.resolve({ ok: true, json: async () => ({ running: false, lastEvents: [], runMode: "local" }) });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    }));

    render(<App />);

    const items = ["Dashboard", "Agentes (IA)", "Conteúdo", "Reels", "Blog", "Leads", "Clientes", "Relatórios", "Configurações"];
    for (const label of items) {
      expect(await screen.findByRole("link", { name: label })).toBeInTheDocument();
    }

    await userEvent.click(screen.getByRole("link", { name: "Reels" }));
    expect(await screen.findByTestId("page-reels")).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm --prefix web run test -- App.test.tsx`
Expected: FAIL — current `Sidebar` only has "Painel"/"Configurações", no `<a>`/`role="link"` elements (it uses `<button>`).

- [ ] **Step 4: Write minimal implementation**

Replace `web/src/components/layout/Sidebar.tsx` entirely:

```tsx
import { NavLink } from "react-router-dom";

const ITEMS: { to: string; label: string; icon: string; end?: boolean }[] = [
  { to: "/", label: "Dashboard", icon: "🏠", end: true },
  { to: "/agentes", label: "Agentes (IA)", icon: "🤖" },
  { to: "/conteudo", label: "Conteúdo", icon: "🗂️" },
  { to: "/reels", label: "Reels", icon: "📸" },
  { to: "/blog", label: "Blog", icon: "📝" },
  { to: "/leads", label: "Leads", icon: "🧲" },
  { to: "/clientes", label: "Clientes", icon: "👥" },
  { to: "/relatorios", label: "Relatórios", icon: "📊" },
  { to: "/configuracoes", label: "Configurações", icon: "⚙️" },
];

export function Sidebar() {
  return (
    <nav className="sidebar flex w-56 shrink-0 flex-col gap-1 bg-surface p-3" aria-label="Menu principal">
      {ITEMS.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          className={({ isActive }) =>
            `flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${isActive ? "bg-accent text-white" : "text-secondary hover:bg-app hover:text-primary"}`
          }
        >
          <span aria-hidden="true">{item.icon}</span>
          {item.label}
        </NavLink>
      ))}
    </nav>
  );
}
```

Replace `web/src/app/App.tsx` entirely:

```tsx
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { WorkspaceProvider } from "../hooks/useWorkspace";
import { PipelineProvider } from "../hooks/usePipeline";
import { ToastProvider } from "../components/ui/Toast";
import { Sidebar } from "../components/layout/Sidebar";
import { Topbar } from "../components/layout/Topbar";
import { ConfigView } from "../views/settings/ConfigView";

function Placeholder({ testId, title }: { testId: string; title: string }) {
  return <div data-testid={testId} className="p-6 text-primary"><h1 className="text-xl font-semibold">{title}</h1></div>;
}

export default function App() {
  return (
    <WorkspaceProvider>
      <ToastProvider>
        <PipelineProvider>
          <BrowserRouter>
            <div className="app-shell flex min-h-screen bg-app">
              <Sidebar />
              <div className="app-main flex-1">
                <Topbar />
                <Routes>
                  <Route path="/" element={<Placeholder testId="page-dashboard" title="Dashboard" />} />
                  <Route path="/agentes" element={<Placeholder testId="page-agentes" title="Agentes (IA)" />} />
                  <Route path="/agentes/:agentId" element={<Placeholder testId="page-agente-detalhe" title="Agente" />} />
                  <Route path="/conteudo" element={<Placeholder testId="page-conteudo" title="Conteúdo" />} />
                  <Route path="/reels" element={<Placeholder testId="page-reels" title="Reels" />} />
                  <Route path="/reels/:id" element={<Placeholder testId="page-reel-detalhe" title="Reel" />} />
                  <Route path="/blog" element={<Placeholder testId="page-blog" title="Blog" />} />
                  <Route path="/leads" element={<Placeholder testId="page-leads" title="Leads" />} />
                  <Route path="/clientes" element={<Placeholder testId="page-clientes" title="Clientes" />} />
                  <Route path="/relatorios" element={<Placeholder testId="page-relatorios" title="Relatórios" />} />
                  <Route path="/configuracoes" element={<ConfigView />} />
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
              </div>
            </div>
          </BrowserRouter>
        </PipelineProvider>
      </ToastProvider>
    </WorkspaceProvider>
  );
}
```

Restyle `web/src/components/layout/Topbar.tsx` for the dark theme (replace the returned JSX; the hooks/logic above it are unchanged):

```tsx
  return (
    <header className="topbar flex items-center justify-between gap-4 border-b border-border bg-surface px-6 py-3">
      <div className="brand flex items-center gap-3">
        <span className="brand-logo text-2xl" aria-hidden="true">🏢</span>
        <div>
          <h1 className="text-base font-semibold text-primary">Escritório NextAssist</h1>
          <p id="topic-line" className="text-xs text-secondary">{topicLine}</p>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <span className="flex items-center gap-1 text-xs text-status-ok">
          <span className="h-2 w-2 rounded-full bg-status-ok" aria-hidden="true" />
          Sistema operacional
        </span>
        <select
          aria-label="Workspace"
          value={workspace}
          disabled={loading}
          onChange={(e) => setWorkspace(e.target.value)}
          className="rounded-md border border-border bg-app px-2 py-1 text-sm text-primary"
        >
          {workspaces.map((w) => (
            <option key={w.id} value={w.id}>{w.name}</option>
          ))}
        </select>
        <div className="pipeline-actions flex gap-2" aria-label="Frentes de conteúdo">
          {runMode !== "disabled" && (
            <button id="run-blog-btn" onClick={() => void runBlog()} disabled={running} className="rounded-md bg-accent px-3 py-1.5 text-sm text-white disabled:opacity-50">
              {running ? "⏳ Blog rodando..." : "▶ Rodar blog"}
            </button>
          )}
          <button className="secondary rounded-md border border-border px-3 py-1.5 text-sm text-primary" onClick={() => void runInstagram()}>📸 Rodar Instagram</button>
        </div>
      </div>
    </header>
  );
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm --prefix web run test -- App.test.tsx`
Expected: PASS

- [ ] **Step 6: Run the full frontend suite to check for regressions**

Run: `npm --prefix web run test`
Expected: PASS — `UsagePanel.test.tsx` and any other existing test must still pass (they render the panel in isolation, not through `App`, so they shouldn't be affected by the router change).

- [ ] **Step 7: Commit**

```bash
git add web/package.json web/package-lock.json web/src/app/App.tsx web/src/app/App.test.tsx web/src/components/layout/Sidebar.tsx web/src/components/layout/Topbar.tsx
git commit -m "feat(web): add react-router shell with 9-item dark sidebar"
```

---

## Fase 3 — Páginas

### Task 9: Reel types in `types/api.ts`

**Files:**
- Modify: `web/src/types/api.ts` (append), `web/src/views/dashboard/ReelApprovalPanel.tsx:1-34` (remove local types, import shared ones)

**Interfaces:**
- Produces: `ReelStatus`, `ReelAuditEvent`, `TimelineStepName`, `TimelineStep`, `SceneSummary`, `ReelListEntry`, `ReelDashboardResponse`, `ReelDetail` (= `ReelListEntry & { scenes?: SceneSummary[]; timelineSteps?: TimelineStep[] }`) exported from `web/src/types/api.ts`, for every later frontend task to import.

- [ ] **Step 1: Add the types**

Append to `web/src/types/api.ts`:

```ts
export type ReelStatus = "queued" | "rendering" | "pending_approval" | "approved" | "rejected" | "publishing" | "published" | "failed";

export interface ReelAuditEvent {
  from: ReelStatus | null;
  to: ReelStatus;
  at: string;
  actor: "pipeline" | "human" | "system";
  note?: string;
}

export type TimelineStepName =
  | "roteiro_gerado" | "cenas_montadas" | "enviado_heygen"
  | "processando" | "video_concluido" | "aguardando_aprovacao" | "publicado";

export interface TimelineStep {
  step: TimelineStepName;
  at: string;
}

export interface SceneSummary {
  type: "avatar_video" | "video";
  label: string;
  assetId?: string;
  thumbnailUrl?: string;
}

export interface ReelListEntry {
  id: string;
  slug: string;
  title: string;
  blogUrl: string;
  caption: string;
  status: ReelStatus;
  videoUrl?: string;
  permalink?: string | null;
  error?: string;
  updatedAt: string;
  audit: ReelAuditEvent[];
}

export interface ReelDetail extends ReelListEntry {
  scenes?: SceneSummary[];
  timelineSteps?: TimelineStep[];
}

export interface ReelDashboardResponse {
  updatedAt: string | null;
  summary: { total: number; pendingApproval: number; approved: number; published: number; failed: number };
  entries: ReelListEntry[];
}
```

- [ ] **Step 2: Remove the duplicated local types from `ReelApprovalPanel.tsx`**

In `web/src/views/dashboard/ReelApprovalPanel.tsx`, replace lines 1-34 (imports through the end of the local `ReelDashboardResponse` interface) with:

```tsx
import { useEffect, useMemo, useState } from "react";
import { useWorkspace } from "../../hooks/useWorkspace";
import { apiGet, apiPost } from "../../lib/api";
import { formatDateTime, nf } from "../../lib/formatters";
import type { ReelStatus, ReelDashboardResponse } from "../../types/api";
```

(Everything from `function statusLabel(...)` onward, line 36 in the original, is unchanged — it already only references `ReelStatus`/`ReelDashboardResponse` by name, now imported instead of locally declared.)

- [ ] **Step 3: Run the frontend suite (no behavior change, just types)**

Run: `npm --prefix web run build`
Expected: `tsc -b` passes — confirms no other file referenced the now-removed local types by accident.

- [ ] **Step 4: Commit**

```bash
git add web/src/types/api.ts web/src/views/dashboard/ReelApprovalPanel.tsx
git commit -m "refactor(web): move Reel types to types/api.ts, add scene/timeline types"
```

---

### Task 10: Wire Reels / Blog / Leads routes to existing panels

**Files:**
- Modify: `web/src/app/App.tsx` (3 routes)

**Interfaces:**
- Consumes: `ReelApprovalPanel` (existing), `HistoryPanel` (existing), `SalesPanel` (existing) — all self-contained, no props needed for this task (Task 11 adds an optional prop to `SalesPanel` for `/clientes`, which doesn't affect this task's `/leads` usage).

- [ ] **Step 1: Extend the shell test**

Add to `web/src/app/App.test.tsx`, inside the existing `it(...)` block, after the `/reels` navigation assertion:

```tsx
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/workspaces")) return Promise.resolve({ ok: true, json: async () => [{ id: "nextassist", name: "NextAssist" }] });
      if (url.includes("/api/status")) return Promise.resolve({ ok: true, json: async () => ({ running: false, lastEvents: [], runMode: "local" }) });
      if (url.includes("/api/history")) return Promise.resolve({ ok: true, json: async () => [] });
      if (url.includes("/api/sales")) return Promise.resolve({ ok: true, json: async () => ({ updatedAt: null, summary: { total: 0, hot: 0, medium: 0, customers: 0, draftsPendingApproval: 0 }, entries: [] }) });
      return Promise.resolve({ ok: true, json: async () => ({}) });
    }));

    await userEvent.click(screen.getByRole("link", { name: "Blog" }));
    expect(await screen.findByText("Nenhum post publicado ainda.")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("link", { name: "Leads" }));
    expect(await screen.findByText("Sales Agent")).toBeInTheDocument();
```

(Replaces the single `vi.stubGlobal("fetch", ...)` call from Task 8's test with this extended one — same call, more branches. `HistoryPanel`'s empty state renders exactly `"Nenhum post publicado ainda."` — confirmed in `web/src/views/dashboard/HistoryPanel.tsx:32`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix web run test -- App.test.tsx`
Expected: FAIL — `/blog` and `/leads` still render the Task 8 placeholder, not `HistoryPanel`/`SalesPanel` content.

- [ ] **Step 3: Wire the routes**

In `web/src/app/App.tsx`, add imports:

```tsx
import { ReelApprovalPanel } from "../views/dashboard/ReelApprovalPanel";
import { HistoryPanel } from "../views/dashboard/HistoryPanel";
import { SalesPanel } from "../views/dashboard/SalesPanel";
```

Replace the three placeholder routes:

```tsx
                  <Route path="/reels" element={<ReelApprovalPanel />} />
                  ...
                  <Route path="/blog" element={<HistoryPanel />} />
                  <Route path="/leads" element={<SalesPanel />} />
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --prefix web run test -- App.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add web/src/app/App.tsx web/src/app/App.test.tsx
git commit -m "feat(web): wire /reels, /blog, /leads routes to existing panels"
```

---

### Task 11: `/clientes` — filtered `SalesPanel`

**Files:**
- Modify: `web/src/views/dashboard/SalesPanel.tsx:136-170`, `web/src/app/App.tsx`
- Test: existing `SalesPanel` has no test file today — add one, `web/src/views/dashboard/SalesPanel.test.tsx`

**Interfaces:**
- Produces: `SalesPanel({ filterIntent }: { filterIntent?: "customer" } = {})` — when `filterIntent` is set, only entries with that `assessment.intent` are shown in the table (KPI row stays showing full totals, matching the existing `data.summary` semantics — only the table rows change).

- [ ] **Step 1: Write the failing test**

Create `web/src/views/dashboard/SalesPanel.test.tsx`:

```tsx
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { WorkspaceProvider } from "../../hooks/useWorkspace";
import { SalesPanel } from "./SalesPanel";

const RESPONSE = {
  updatedAt: "2026-09-15T00:00:00.000Z",
  summary: { total: 2, hot: 1, medium: 1, customers: 1, draftsPendingApproval: 0 },
  entries: [
    { lead: { leadId: "l1", userId: "Lead Quente", signals: [] }, assessment: { leadId: "l1", score: 90, intent: "high", nextAction: "invite_trial", reasons: [] } },
    { lead: { leadId: "l2", userId: "Cliente Atual", signals: [] }, assessment: { leadId: "l2", score: 100, intent: "customer", nextAction: "customer_success", reasons: [] } },
  ],
};

describe("SalesPanel", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("filterIntent='customer' mostra só o lead com intent customer", async () => {
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/workspaces")) return Promise.resolve({ ok: true, json: async () => [{ id: "nextassist", name: "NextAssist" }] });
      if (url.includes("/api/sales")) return Promise.resolve({ ok: true, json: async () => RESPONSE });
      return Promise.resolve({ ok: true, json: async () => ({}) });
    }));

    render(<WorkspaceProvider><SalesPanel filterIntent="customer" /></WorkspaceProvider>);

    expect(await screen.findByText("Cliente Atual")).toBeInTheDocument();
    expect(screen.queryByText("Lead Quente")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix web run test -- SalesPanel.test.tsx`
Expected: FAIL — `SalesPanel` doesn't accept a `filterIntent` prop yet (both rows render).

- [ ] **Step 3: Write minimal implementation**

In `web/src/views/dashboard/SalesPanel.tsx`, replace the `export function SalesPanel()` signature and the `priority` computation (lines 136-170):

```tsx
export function SalesPanel({ filterIntent }: { filterIntent?: "customer" } = {}) {
  const { workspace } = useWorkspace();
  const [data, setData] = useState<SalesDashboardResponse | null>(null);

  async function load(signal?: AbortSignal) {
    if (!workspace) return;
    try {
      setData(await apiGet<SalesDashboardResponse>("/api/sales", workspace, signal));
    } catch (err) {
      if ((err as Error).name !== "AbortError") setData(null);
    }
  }

  useEffect(() => {
    if (!workspace) return;
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [workspace]);

  if (!data || !workspace) {
    return (
      <section className="usage-panel sales-panel">
        <div className="usage-header">
          <div><h2>{filterIntent === "customer" ? "Clientes" : "Sales Agent"}</h2><p>Leads priorizados pelo Harness a partir do funil real.</p></div>
          <span>Aguardando dados</span>
        </div>
      </section>
    );
  }

  const priority = [...data.entries]
    .filter((entry) => filterIntent ? entry.assessment.intent === filterIntent : entry.assessment.intent !== "low")
    .sort((a, b) => b.assessment.score - a.assessment.score)
    .slice(0, 12);
```

(Header title inside the JSX below — `<h2>Sales Agent</h2>` at line ~175 — becomes `<h2>{filterIntent === "customer" ? "Clientes" : "Sales Agent"}</h2>`; everything else in the render, including the KPI row and table, is unchanged.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --prefix web run test -- SalesPanel.test.tsx`
Expected: PASS

- [ ] **Step 5: Wire the `/clientes` route**

In `web/src/app/App.tsx`, replace the `/clientes` placeholder:

```tsx
                  <Route path="/clientes" element={<SalesPanel filterIntent="customer" />} />
```

- [ ] **Step 6: Commit**

```bash
git add web/src/views/dashboard/SalesPanel.tsx web/src/views/dashboard/SalesPanel.test.tsx web/src/app/App.tsx
git commit -m "feat(web): add /clientes route as SalesPanel filtered to customer intent"
```

---

### Task 12: Reel detail page (`/reels/:id`)

**Files:**
- Create: `web/src/views/reels/ReelDetailPage.tsx`, `web/src/views/reels/ReelDetailPage.test.tsx`
- Modify: `web/src/app/App.tsx`

**Interfaces:**
- Consumes: `ReelDetail`, `TimelineStepName` from `types/api.ts` (Task 9); `apiGet` from `lib/api.ts`; `useParams`/`useWorkspace`.

- [ ] **Step 1: Write the failing test**

Create `web/src/views/reels/ReelDetailPage.test.tsx`:

```tsx
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { WorkspaceProvider } from "../../hooks/useWorkspace";
import { ReelDetailPage } from "./ReelDetailPage";

const DETAIL = {
  id: "nextassist:teste", slug: "teste", title: "NextAssist - Teste multi-cena Studio",
  blogUrl: "https://x.test/teste", caption: "Legenda", status: "rendering",
  updatedAt: "2026-09-15T00:00:00.000Z", audit: [],
  scenes: [
    { type: "avatar_video", label: "Abertura (avatar)" },
    { type: "video", label: "Fechamento de OS", assetId: "8d08e75c81d34ea3b066d2db18ed72c5" },
  ],
  timelineSteps: [
    { step: "roteiro_gerado", at: "2026-09-15T00:00:00.000Z" },
    { step: "cenas_montadas", at: "2026-09-15T00:00:01.000Z" },
    { step: "enviado_heygen", at: "2026-09-15T00:00:02.000Z" },
  ],
};

describe("ReelDetailPage", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("mostra a timeline e a galeria de B-roll do Reel", async () => {
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/workspaces")) return Promise.resolve({ ok: true, json: async () => [{ id: "nextassist", name: "NextAssist" }] });
      if (url.includes("/api/reels/")) return Promise.resolve({ ok: true, json: async () => DETAIL });
      return Promise.resolve({ ok: true, json: async () => ({}) });
    }));

    render(
      <WorkspaceProvider>
        <MemoryRouter initialEntries={["/reels/nextassist:teste"]}>
          <Routes><Route path="/reels/:id" element={<ReelDetailPage />} /></Routes>
        </MemoryRouter>
      </WorkspaceProvider>,
    );

    expect(await screen.findByText("NextAssist - Teste multi-cena Studio")).toBeInTheDocument();
    expect(screen.getByText("Roteiro gerado")).toBeInTheDocument();
    expect(screen.getByText("Cenas montadas")).toBeInTheDocument();
    expect(screen.getByText("Enviado para HeyGen")).toBeInTheDocument();
    expect(screen.getByText("Fechamento de OS")).toBeInTheDocument(); // B-roll usado
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix web run test -- ReelDetailPage.test.tsx`
Expected: FAIL — module `./ReelDetailPage` doesn't exist.

- [ ] **Step 3: Write minimal implementation**

Create `web/src/views/reels/ReelDetailPage.tsx`:

```tsx
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useWorkspace } from "../../hooks/useWorkspace";
import { apiGet } from "../../lib/api";
import { formatDateTime } from "../../lib/formatters";
import type { ReelDetail, TimelineStepName } from "../../types/api";

const STEP_LABELS: Record<TimelineStepName, string> = {
  roteiro_gerado: "Roteiro gerado",
  cenas_montadas: "Cenas montadas",
  enviado_heygen: "Enviado para HeyGen",
  processando: "Processando na HeyGen",
  video_concluido: "Vídeo concluído",
  aguardando_aprovacao: "Aguardando sua aprovação",
  publicado: "Publicado no Instagram",
};
const STEP_ORDER: TimelineStepName[] = [
  "roteiro_gerado", "cenas_montadas", "enviado_heygen", "processando",
  "video_concluido", "aguardando_aprovacao", "publicado",
];

export function ReelDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { workspace } = useWorkspace();
  const [detail, setDetail] = useState<ReelDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!workspace || !id) return;
    const controller = new AbortController();
    apiGet<ReelDetail>(`/api/reels/${encodeURIComponent(id)}`, workspace, controller.signal, "Não foi possível carregar o Reel.")
      .then(setDetail)
      .catch((err) => { if ((err as Error).name !== "AbortError") setError((err as Error).message); });
    return () => controller.abort();
  }, [workspace, id]);

  if (error) return <div className="p-6 text-status-error">{error}</div>;
  if (!detail) return <div className="p-6 text-secondary">Aguardando dados</div>;

  const completedSteps = new Set((detail.timelineSteps ?? []).map((s) => s.step));

  return (
    <div className="p-6 text-primary">
      <h1 className="text-xl font-semibold">{detail.title}</h1>
      <p className="text-sm text-secondary">{detail.slug} · atualizado {formatDateTime(detail.updatedAt)}</p>

      <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-2">
        <section className="rounded-lg border border-border bg-surface p-4">
          <h2 className="mb-3 font-semibold">Linha do tempo</h2>
          <ol className="space-y-2">
            {STEP_ORDER.map((step) => (
              <li key={step} className={`flex items-center gap-2 text-sm ${completedSteps.has(step) ? "text-primary" : "text-secondary"}`}>
                <span aria-hidden="true">{completedSteps.has(step) ? "✅" : "○"}</span>
                {STEP_LABELS[step]}
              </li>
            ))}
          </ol>
        </section>

        <section className="rounded-lg border border-border bg-surface p-4">
          <h2 className="mb-3 font-semibold">B-rolls utilizados</h2>
          {detail.scenes && detail.scenes.length > 0 ? (
            <ul className="space-y-2">
              {detail.scenes.filter((s) => s.type === "video").map((scene, i) => (
                <li key={`${scene.assetId}-${i}`} className="text-sm">{scene.label}</li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-secondary">Sem cenas registradas para este Reel.</p>
          )}
        </section>
      </div>

      {detail.videoUrl ? <a className="mt-4 inline-block text-accent" href={detail.videoUrl} target="_blank" rel="noreferrer">Abrir vídeo</a> : null}
      {detail.error ? <p className="mt-4 text-status-error">{detail.error}</p> : null}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --prefix web run test -- ReelDetailPage.test.tsx`
Expected: PASS

- [ ] **Step 5: Wire the route**

In `web/src/app/App.tsx`, add the import and replace the `/reels/:id` placeholder:

```tsx
import { ReelDetailPage } from "../views/reels/ReelDetailPage";
...
                  <Route path="/reels/:id" element={<ReelDetailPage />} />
```

- [ ] **Step 6: Commit**

```bash
git add web/src/views/reels/ReelDetailPage.tsx web/src/views/reels/ReelDetailPage.test.tsx web/src/app/App.tsx
git commit -m "feat(web): add Reel detail page with generation timeline and B-roll gallery"
```

---

### Task 13: Conteúdo page (`/conteudo`)

**Files:**
- Create: `web/src/views/pages/ConteudoPage.tsx`, `web/src/views/pages/ConteudoPage.test.tsx`
- Modify: `web/src/app/App.tsx`, `web/src/types/api.ts` (add `CalendarTopic`)

**Interfaces:**
- Produces: `CalendarTopic { tema, palavraChaveAlvo, publicado, publicadoEm?, generatedBy?, createdAt?, reason?, priority? }` in `types/api.ts`, mirroring `src/contentCalendar.ts`'s backend type field-for-field.

- [ ] **Step 1: Add the type**

Append to `web/src/types/api.ts`:

```ts
export interface CalendarTopic {
  tema: string;
  palavraChaveAlvo: string;
  publicado: boolean;
  publicadoEm?: string;
  generatedBy?: "marketing-director";
  createdAt?: string;
  reason?: string;
  priority?: "high" | "medium" | "low";
}
```

- [ ] **Step 2: Write the failing test**

Create `web/src/views/pages/ConteudoPage.test.tsx`:

```tsx
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { WorkspaceProvider } from "../../hooks/useWorkspace";
import { ConteudoPage } from "./ConteudoPage";

describe("ConteudoPage", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("lista tópicos pendentes e publicados", async () => {
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/workspaces")) return Promise.resolve({ ok: true, json: async () => [{ id: "nextassist", name: "NextAssist" }] });
      if (url.includes("/api/content-calendar")) {
        return Promise.resolve({ ok: true, json: async () => ([
          { tema: "Pauta pendente", palavraChaveAlvo: "kw1", publicado: false, priority: "high" },
          { tema: "Pauta publicada", palavraChaveAlvo: "kw2", publicado: true, publicadoEm: "2026-09-10T00:00:00.000Z" },
        ]) });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    }));

    render(<WorkspaceProvider><ConteudoPage /></WorkspaceProvider>);

    expect(await screen.findByText("Pauta pendente")).toBeInTheDocument();
    expect(screen.getByText("Pauta publicada")).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm --prefix web run test -- ConteudoPage.test.tsx`
Expected: FAIL — module doesn't exist.

- [ ] **Step 4: Write minimal implementation**

Create `web/src/views/pages/ConteudoPage.tsx`:

```tsx
import { useEffect, useState } from "react";
import { useWorkspace } from "../../hooks/useWorkspace";
import { apiGet } from "../../lib/api";
import type { CalendarTopic } from "../../types/api";

export function ConteudoPage() {
  const { workspace } = useWorkspace();
  const [topics, setTopics] = useState<CalendarTopic[] | null>(null);

  useEffect(() => {
    if (!workspace) return;
    const controller = new AbortController();
    apiGet<CalendarTopic[]>("/api/content-calendar", workspace, controller.signal, "Não foi possível carregar o calendário.")
      .then(setTopics)
      .catch((err) => { if ((err as Error).name !== "AbortError") setTopics([]); });
    return () => controller.abort();
  }, [workspace]);

  if (!topics) return <div className="p-6 text-secondary">Aguardando dados</div>;

  const pending = topics.filter((t) => !t.publicado);
  const published = topics.filter((t) => t.publicado);

  return (
    <div className="p-6 text-primary">
      <h1 className="text-xl font-semibold">Conteúdo</h1>
      <p className="text-sm text-secondary">Backlog de pautas — publicadas aparecem também em Blog.</p>

      <section className="mt-6">
        <h2 className="mb-2 font-semibold">Pendentes ({pending.length})</h2>
        <ul className="space-y-1">
          {pending.map((t) => (
            <li key={t.tema} className="rounded-md border border-border bg-surface p-3 text-sm">
              <strong>{t.tema}</strong> <span className="text-secondary">— {t.palavraChaveAlvo}</span>
              {t.priority ? <span className="ml-2 text-xs text-accent">{t.priority}</span> : null}
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-6">
        <h2 className="mb-2 font-semibold">Publicadas ({published.length})</h2>
        <ul className="space-y-1">
          {published.map((t) => (
            <li key={t.tema} className="rounded-md border border-border bg-surface p-3 text-sm text-secondary">
              {t.tema}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm --prefix web run test -- ConteudoPage.test.tsx`
Expected: PASS

- [ ] **Step 6: Wire the route**

In `web/src/app/App.tsx`, add the import and replace the `/conteudo` placeholder:

```tsx
import { ConteudoPage } from "../views/pages/ConteudoPage";
...
                  <Route path="/conteudo" element={<ConteudoPage />} />
```

- [ ] **Step 7: Commit**

```bash
git add web/src/views/pages/ConteudoPage.tsx web/src/views/pages/ConteudoPage.test.tsx web/src/app/App.tsx web/src/types/api.ts
git commit -m "feat(web): add Conteudo page listing the content backlog"
```

---

### Task 14: Relatórios page (`/relatorios`)

**Files:**
- Create: `web/src/views/pages/RelatoriosPage.tsx`
- Modify: `web/src/app/App.tsx`

**Interfaces:**
- Consumes: `PerformancePanel`, `UsagePanel`, `AttributionPanel` (existing, self-contained, no props).

No new test for this task — it's a pure composition of 3 already-tested-or-existing panels with no new logic; the shell test (Task 8/10 pattern) is extended instead.

- [ ] **Step 1: Extend the shell test**

In `web/src/app/App.test.tsx`, replace the `vi.stubGlobal("fetch", ...)` call (the one extended in Task 10) with this cumulative version (adds `/api/performance`, `/api/usage`, `/api/attribution`):

```tsx
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/workspaces")) return Promise.resolve({ ok: true, json: async () => [{ id: "nextassist", name: "NextAssist" }] });
      if (url.includes("/api/status")) return Promise.resolve({ ok: true, json: async () => ({ running: false, lastEvents: [], runMode: "local" }) });
      if (url.includes("/api/history")) return Promise.resolve({ ok: true, json: async () => [] });
      if (url.includes("/api/sales")) return Promise.resolve({ ok: true, json: async () => ({ updatedAt: null, summary: { total: 0, hot: 0, medium: 0, customers: 0, draftsPendingApproval: 0 }, entries: [] }) });
      if (url.includes("/api/performance")) return Promise.resolve({ ok: true, json: async () => ({ atualizadoEm: "2026-09-15T00:00:00.000Z", periodo: { inicio: "", fim: "" }, posts: [] }) });
      if (url.includes("/api/usage")) return Promise.resolve({ ok: true, json: async () => ({ trackedRuns: 0, month: { estimatedUsd: 0, inputTokens: 0, outputTokens: 0, webSearchRequests: 0 }, total: { estimatedUsd: 0, inputTokens: 0, outputTokens: 0, webSearchRequests: 0 }, averagePublishedUsd: 0 }) });
      if (url.includes("/api/attribution")) return Promise.resolve({ ok: true, json: async () => ({ rows: [], unattributedEvents: 0 }) });
      return Promise.resolve({ ok: true, json: async () => ({}) });
    }));
```

Add after the `/leads` assertion:

```tsx
    await userEvent.click(screen.getByRole("link", { name: "Relatórios" }));
    expect(await screen.findByText("Consumo de IA")).toBeInTheDocument();
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix web run test -- App.test.tsx`
Expected: FAIL — `/relatorios` still shows the Task 8 placeholder.

- [ ] **Step 3: Write the page**

Create `web/src/views/pages/RelatoriosPage.tsx`:

```tsx
import { PerformancePanel } from "../dashboard/PerformancePanel";
import { UsagePanel } from "../dashboard/UsagePanel";
import { AttributionPanel } from "../dashboard/AttributionPanel";

export function RelatoriosPage() {
  return (
    <div className="p-6 text-primary">
      <h1 className="mb-4 text-xl font-semibold">Relatórios</h1>
      <div className="space-y-6">
        <PerformancePanel />
        <UsagePanel />
        <AttributionPanel />
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Wire the route**

In `web/src/app/App.tsx`, add the import and replace the `/relatorios` placeholder:

```tsx
import { RelatoriosPage } from "../views/pages/RelatoriosPage";
...
                  <Route path="/relatorios" element={<RelatoriosPage />} />
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm --prefix web run test -- App.test.tsx`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add web/src/views/pages/RelatoriosPage.tsx web/src/app/App.tsx web/src/app/App.test.tsx
git commit -m "feat(web): add Relatorios page composing Performance/Usage/Attribution panels"
```

---

### Task 15: Dashboard page (`/`)

**Files:**
- Create: `web/src/views/pages/DashboardPage.tsx`
- Modify: `web/src/app/App.tsx`

**Interfaces:**
- Consumes: `RevenuePanel`, `LiveStatus`, `PlayerDock` (existing, self-contained, no props).

No new test — same reasoning as Task 14, extend the shell test instead.

- [ ] **Step 1: Extend the shell test**

In `web/src/app/App.test.tsx`, add a `/api/revenue` branch to the cumulative `vi.stubGlobal("fetch", ...)` call from Task 14 (insert before the final catch-all `return Promise.resolve({ ok: true, json: async () => ({}) });`). `RevenuePanel` (`web/src/views/dashboard/RevenuePanel.tsx:41`) destructures `const { snapshot, decision } = data;` unconditionally once `data` is non-null, so the mock must return a fully-shaped `RevenueDashboardResponse` — an empty `{}` would throw on render:

```tsx
      if (url.includes("/api/revenue")) return Promise.resolve({ ok: true, json: async () => ({ runId: "r1", monthlyCustomerTarget: 10, snapshot: { visits: 0, trials: 0, activated: 0, customers: 0, hotLeads: 0, pendingSalesApprovals: 0, visitToTrialRate: 0, trialToActivationRate: 0, activationToCustomerRate: 0 }, decision: { objective: "increase_paying_customers", bottleneck: "traffic", action: "create_content", priority: "medium", reason: "Pouco tráfego ainda.", evidence: [], requiresHumanApproval: true } }) });
```

Then add, after the App renders (the shell test already lands on `/` by default — no extra click needed):

```tsx
    expect(await screen.findByText("Frente Blog")).toBeInTheDocument();
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix web run test -- App.test.tsx`
Expected: FAIL — `/` still shows the Task 8 placeholder.

- [ ] **Step 3: Write the page**

Create `web/src/views/pages/DashboardPage.tsx` (the 3 "frente" cards are ported verbatim from the old `PainelView.tsx` lines 17-21):

```tsx
import { RevenuePanel } from "../dashboard/RevenuePanel";
import { LiveStatus } from "../dashboard/LiveStatus";
import { PlayerDock } from "../dashboard/PlayerDock";

export function DashboardPage() {
  return (
    <div className="p-6 text-primary">
      <section className="channel-overview grid grid-cols-1 gap-4 md:grid-cols-3" aria-label="Frentes editoriais">
        <article className="channel-card rounded-lg border border-border bg-surface p-4"><span className="channel-icon text-2xl">📝</span><div><strong>Frente Blog</strong><p className="text-sm text-secondary">SEO, artigo, capa, publicação e indexação.</p></div></article>
        <article className="channel-card rounded-lg border border-border bg-surface p-4"><span className="channel-icon text-2xl">📸</span><div><strong>Frente Instagram</strong><p className="text-sm text-secondary">Reels, bastidores, dicas rápidas e conteúdo interativo.</p></div></article>
        <article className="channel-card rounded-lg border border-border bg-surface p-4"><span className="channel-icon text-2xl">💼</span><div><strong>Frente Vendas</strong><p className="text-sm text-secondary">Leads, intenção comercial, abordagem e aprovação humana.</p></div></article>
      </section>

      <div className="mt-6"><RevenuePanel /></div>
      <div className="mt-6"><PlayerDock /></div>
      <div className="mt-6"><LiveStatus /></div>
    </div>
  );
}
```

- [ ] **Step 4: Wire the route**

In `web/src/app/App.tsx`, add the import and replace the `/` placeholder:

```tsx
import { DashboardPage } from "../views/pages/DashboardPage";
...
                  <Route path="/" element={<DashboardPage />} />
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm --prefix web run test -- App.test.tsx`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add web/src/views/pages/DashboardPage.tsx web/src/app/App.tsx web/src/app/App.test.tsx
git commit -m "feat(web): add Dashboard page with revenue banner and frentes overview"
```

---

### Task 16: Agentes (IA) overview page (`/agentes`)

**Files:**
- Create: `web/src/views/pages/AgentesPage.tsx`, `web/src/views/pages/AgentesPage.test.tsx`
- Modify: `web/src/app/App.tsx`

**Interfaces:**
- Produces: `type OfficeAgentId = "social" | "analytics" | "sales" | "finance" | "revenue"` (exported from `AgentesPage.tsx` — Task 17's drill-down page imports it).
- Consumes: `/api/reels`, `/api/performance`, `/api/sales`, `/api/usage`, `/api/revenue` (all existing endpoints, read directly rather than through the panel components, since these need condensed card-sized summaries, not full tables).

- [ ] **Step 1: Write the failing test**

Create `web/src/views/pages/AgentesPage.test.tsx`:

```tsx
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { WorkspaceProvider } from "../../hooks/useWorkspace";
import { AgentesPage } from "./AgentesPage";

describe("AgentesPage", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("renderiza os 5 cards de agente com dados reais", async () => {
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/workspaces")) return Promise.resolve({ ok: true, json: async () => [{ id: "nextassist", name: "NextAssist" }] });
      if (url.includes("/api/reels")) return Promise.resolve({ ok: true, json: async () => ({ updatedAt: null, summary: { total: 2, pendingApproval: 1, approved: 0, published: 1, failed: 0 }, entries: [] }) });
      if (url.includes("/api/performance")) return Promise.resolve({ ok: true, json: async () => ({ atualizadoEm: "2026-09-15T00:00:00.000Z", periodo: { inicio: "", fim: "" }, posts: [{ slug: "a", titulo: "A", url: "", indexado: true, coverageState: "", clicks: 10, impressions: 500, ctr: 0.02, position: 5 }] }) });
      if (url.includes("/api/sales")) return Promise.resolve({ ok: true, json: async () => ({ updatedAt: null, summary: { total: 4, hot: 2, medium: 1, customers: 1, draftsPendingApproval: 0 }, entries: [] }) });
      if (url.includes("/api/usage")) return Promise.resolve({ ok: true, json: async () => ({ trackedRuns: 3, month: { estimatedUsd: 12.5, inputTokens: 0, outputTokens: 0, webSearchRequests: 0 }, total: { estimatedUsd: 40, inputTokens: 0, outputTokens: 0, webSearchRequests: 0 }, averagePublishedUsd: 4 }) });
      if (url.includes("/api/revenue")) return Promise.resolve({ ok: true, json: async () => ({ runId: "r1", monthlyCustomerTarget: 10, snapshot: { visits: 0, trials: 0, activated: 0, customers: 2, hotLeads: 0, pendingSalesApprovals: 0, visitToTrialRate: 0, trialToActivationRate: 0, activationToCustomerRate: 0 }, decision: { objective: "increase_paying_customers", bottleneck: "traffic", action: "create_content", priority: "medium", reason: "Pouco tráfego ainda.", evidence: [], requiresHumanApproval: true } }) });
      return Promise.resolve({ ok: true, json: async () => ({}) });
    }));

    render(<WorkspaceProvider><MemoryRouter><AgentesPage /></MemoryRouter></WorkspaceProvider>);

    expect(await screen.findByText("Social Agent")).toBeInTheDocument();
    expect(screen.getByText("Analytics Agent")).toBeInTheDocument();
    expect(screen.getByText("Sales Agent")).toBeInTheDocument();
    expect(screen.getByText("Finance Agent")).toBeInTheDocument();
    expect(screen.getByText("Revenue Director")).toBeInTheDocument();
    expect(await screen.findByText(/1 aguardando aprovação/)).toBeInTheDocument();
    expect(screen.getByText(/Pouco tráfego ainda\./)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix web run test -- AgentesPage.test.tsx`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Write minimal implementation**

Create `web/src/views/pages/AgentesPage.tsx`:

```tsx
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useWorkspace } from "../../hooks/useWorkspace";
import { apiGet } from "../../lib/api";
import { usd } from "../../lib/formatters";
import type { ReelDashboardResponse, PerformanceReport, SalesDashboardResponse, UsageReport, RevenueDashboardResponse } from "../../types/api";

export type OfficeAgentId = "social" | "analytics" | "sales" | "finance" | "revenue";

function AgentCard({ agentId, icon, title, status, headline, kpis }: {
  agentId: OfficeAgentId; icon: string; title: string; status: string; headline: string;
  kpis: { label: string; value: string }[];
}) {
  return (
    <Link to={`/agentes/${agentId}`} className="block rounded-lg border border-border bg-surface p-4 hover:border-accent">
      <div className="flex items-center justify-between">
        <span className="text-2xl" aria-hidden="true">{icon}</span>
        <span className="text-xs text-status-ok">{status}</span>
      </div>
      <h2 className="mt-2 font-semibold text-primary">{title}</h2>
      <p className="mt-1 text-sm text-secondary">{headline}</p>
      <div className="mt-3 flex gap-4">
        {kpis.map((kpi) => (
          <div key={kpi.label}>
            <div className="text-xs text-secondary">{kpi.label}</div>
            <div className="text-sm font-semibold text-primary">{kpi.value}</div>
          </div>
        ))}
      </div>
    </Link>
  );
}

function useAgentData<T>(path: string): T | null {
  const { workspace } = useWorkspace();
  const [data, setData] = useState<T | null>(null);
  useEffect(() => {
    if (!workspace) return;
    const controller = new AbortController();
    apiGet<T>(path, workspace, controller.signal).then(setData).catch((err) => {
      if ((err as Error).name !== "AbortError") setData(null);
    });
    return () => controller.abort();
  }, [workspace, path]);
  return data;
}

export function AgentesPage() {
  const reels = useAgentData<ReelDashboardResponse>("/api/reels");
  const performance = useAgentData<PerformanceReport>("/api/performance");
  const sales = useAgentData<SalesDashboardResponse>("/api/sales");
  const usage = useAgentData<UsageReport>("/api/usage");
  const revenue = useAgentData<RevenueDashboardResponse>("/api/revenue");

  const totalImpressions = performance?.posts.reduce((sum, p) => sum + p.impressions, 0) ?? 0;
  const totalClicks = performance?.posts.reduce((sum, p) => sum + p.clicks, 0) ?? 0;

  return (
    <div className="p-6 text-primary">
      <h1 className="mb-4 text-xl font-semibold">Agentes (IA)</h1>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <AgentCard
          agentId="social" icon="📸" title="Social Agent"
          status={reels ? "Em dia" : "Carregando"}
          headline={reels ? `${reels.summary.pendingApproval} aguardando aprovação` : "Carregando..."}
          kpis={[{ label: "Total", value: String(reels?.summary.total ?? 0) }, { label: "Publicados", value: String(reels?.summary.published ?? 0) }]}
        />
        <AgentCard
          agentId="analytics" icon="📈" title="Analytics Agent"
          status="Em dia"
          headline={`${totalImpressions} impressões, ${totalClicks} cliques monitorados`}
          kpis={[{ label: "Impressões", value: String(totalImpressions) }, { label: "Cliques", value: String(totalClicks) }]}
        />
        <AgentCard
          agentId="sales" icon="👥" title="Sales Agent"
          status={sales ? "Em dia" : "Carregando"}
          headline={sales ? `${sales.summary.total} leads, ${sales.summary.hot} quentes` : "Carregando..."}
          kpis={[{ label: "Leads", value: String(sales?.summary.total ?? 0) }, { label: "Quentes", value: String(sales?.summary.hot ?? 0) }]}
        />
        <AgentCard
          agentId="finance" icon="💰" title="Finance Agent"
          status={usage ? "Em dia" : "Carregando"}
          headline={usage ? `Custo do mês: ${usd.format(usage.month.estimatedUsd)} — créditos HeyGen em breve` : "Carregando..."}
          kpis={[{ label: "Custo mês", value: usage ? usd.format(usage.month.estimatedUsd) : "—" }]}
        />
        <AgentCard
          agentId="revenue" icon="👑" title="Revenue Director"
          status="Planejando"
          headline={revenue?.decision.reason ?? "Carregando..."}
          kpis={[{ label: "Clientes", value: revenue ? `${revenue.snapshot.customers}/${revenue.monthlyCustomerTarget ?? "—"}` : "—" }]}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --prefix web run test -- AgentesPage.test.tsx`
Expected: PASS

- [ ] **Step 5: Wire the route**

In `web/src/app/App.tsx`, add the import and replace the `/agentes` placeholder:

```tsx
import { AgentesPage } from "../views/pages/AgentesPage";
...
                  <Route path="/agentes" element={<AgentesPage />} />
```

- [ ] **Step 6: Commit**

```bash
git add web/src/views/pages/AgentesPage.tsx web/src/views/pages/AgentesPage.test.tsx web/src/app/App.tsx
git commit -m "feat(web): add Agentes (IA) overview page with 5 summary cards"
```

---

### Task 17: Agente drill-down page (`/agentes/:agentId`)

**Files:**
- Create: `web/src/views/pages/AgenteDetailPage.tsx`, `web/src/views/pages/AgenteDetailPage.test.tsx`
- Modify: `web/src/app/App.tsx`

**Interfaces:**
- Consumes: `OfficeAgentId` from `AgentesPage.tsx` (Task 16); `RunsPanel` (existing, unfiltered — see note below); `SalesPanel`, `RevenuePanel`, `ReelApprovalPanel` (existing, reused for the "Visão geral" tab depending on `agentId`).

**Known simplification** (carry over honestly, don't hide it): the backend's `AgentId` (pipeline stage, `src/pipeline.ts`) and this page's `OfficeAgentId` (business function) are different concepts — a `RunRecord.eventos[]` mixes all pipeline stages per run, there's no per-`OfficeAgentId` filter available server-side. "Histórico" reuses `<RunsPanel />` unfiltered rather than fabricating a filter the data can't support.

- [ ] **Step 1: Write the failing test**

Create `web/src/views/pages/AgenteDetailPage.test.tsx`:

```tsx
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { WorkspaceProvider } from "../../hooks/useWorkspace";
import { PipelineProvider } from "../../hooks/usePipeline";
import { ToastProvider } from "../../components/ui/Toast";
import { AgenteDetailPage } from "./AgenteDetailPage";

class FakeEventSource {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(_url: string) {}
  close() {}
}

describe("AgenteDetailPage", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("mostra as 4 abas e troca de conteúdo ao clicar", async () => {
    vi.stubGlobal("EventSource", FakeEventSource as unknown as typeof EventSource);
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/workspaces")) return Promise.resolve({ ok: true, json: async () => [{ id: "nextassist", name: "NextAssist" }] });
      if (url.includes("/api/status")) return Promise.resolve({ ok: true, json: async () => ({ running: false, lastEvents: [], runMode: "local" }) });
      if (url.includes("/api/sales")) return Promise.resolve({ ok: true, json: async () => ({ updatedAt: null, summary: { total: 0, hot: 0, medium: 0, customers: 0, draftsPendingApproval: 0 }, entries: [] }) });
      if (url.includes("/api/runs")) return Promise.resolve({ ok: true, json: async () => [] });
      return Promise.resolve({ ok: true, json: async () => ({}) });
    }));

    // RunsPanel (montado na aba "Histórico") usa usePipeline()/useToast() internamente
    // (web/src/views/dashboard/RunsPanel.tsx:3-4) — precisa dos 3 providers, não só WorkspaceProvider.
    render(
      <WorkspaceProvider>
        <ToastProvider>
          <PipelineProvider>
            <MemoryRouter initialEntries={["/agentes/sales"]}>
              <Routes><Route path="/agentes/:agentId" element={<AgenteDetailPage />} /></Routes>
            </MemoryRouter>
          </PipelineProvider>
        </ToastProvider>
      </WorkspaceProvider>,
    );

    expect(await screen.findByRole("tab", { name: "Visão geral" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Detalhes técnicos" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Histórico" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Ações" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("tab", { name: "Histórico" }));
    expect(await screen.findByText("Execuções recentes")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("tab", { name: "Ações" }));
    expect(await screen.findByText(/Sem ações automatizadas/)).toBeInTheDocument();
  });
});
```

`RunsPanel`'s heading is exactly `"Execuções recentes"` — confirmed in `web/src/views/dashboard/RunsPanel.tsx:96`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix web run test -- AgenteDetailPage.test.tsx`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Write minimal implementation**

Create `web/src/views/pages/AgenteDetailPage.tsx`:

```tsx
import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { RunsPanel } from "../dashboard/RunsPanel";
import { SalesPanel } from "../dashboard/SalesPanel";
import { RevenuePanel } from "../dashboard/RevenuePanel";
import { ReelApprovalPanel } from "../dashboard/ReelApprovalPanel";
import type { OfficeAgentId } from "./AgentesPage";

const TITLES: Record<OfficeAgentId, string> = {
  social: "Social Agent", analytics: "Analytics Agent", sales: "Sales Agent",
  finance: "Finance Agent", revenue: "Revenue Director",
};

type Tab = "visao-geral" | "detalhes" | "historico" | "acoes";
const TABS: { id: Tab; label: string }[] = [
  { id: "visao-geral", label: "Visão geral" },
  { id: "detalhes", label: "Detalhes técnicos" },
  { id: "historico", label: "Histórico" },
  { id: "acoes", label: "Ações" },
];

function VisaoGeral({ agentId }: { agentId: OfficeAgentId }) {
  if (agentId === "sales") return <SalesPanel />;
  if (agentId === "revenue") return <RevenuePanel />;
  if (agentId === "social") return <ReelApprovalPanel />;
  return <p className="text-secondary">Sem painel detalhado para este agente ainda — veja o card em <Link className="text-accent" to="/agentes">Agentes (IA)</Link>.</p>;
}

export function AgenteDetailPage() {
  const { agentId } = useParams<{ agentId: OfficeAgentId }>();
  const [tab, setTab] = useState<Tab>("visao-geral");
  const id = (agentId ?? "sales") as OfficeAgentId;

  return (
    <div className="p-6 text-primary">
      <h1 className="mb-4 text-xl font-semibold">{TITLES[id] ?? id}</h1>

      <div role="tablist" className="mb-4 flex gap-2 border-b border-border">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            className={`px-3 py-2 text-sm ${tab === t.id ? "border-b-2 border-accent text-primary" : "text-secondary"}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "visao-geral" && <VisaoGeral agentId={id} />}
      {tab === "detalhes" && <p className="text-sm text-secondary">Detalhes técnicos completos ficam disponíveis na aba Visão geral por enquanto — um payload bruto dedicado fica para uma iteração futura.</p>}
      {tab === "historico" && <RunsPanel />}
      {tab === "acoes" && (
        <p className="text-sm text-secondary">
          Sem ações automatizadas para este agente nesta versão.
          {id === "social" ? <> Para aprovar/rejeitar/publicar Reels, use <Link className="text-accent" to="/reels">Reels</Link>.</> : null}
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --prefix web run test -- AgenteDetailPage.test.tsx`
Expected: PASS

- [ ] **Step 5: Wire the route**

In `web/src/app/App.tsx`, add the import and replace the `/agentes/:agentId` placeholder:

```tsx
import { AgenteDetailPage } from "../views/pages/AgenteDetailPage";
...
                  <Route path="/agentes/:agentId" element={<AgenteDetailPage />} />
```

- [ ] **Step 6: Commit**

```bash
git add web/src/views/pages/AgenteDetailPage.tsx web/src/views/pages/AgenteDetailPage.test.tsx web/src/app/App.tsx
git commit -m "feat(web): add agent drill-down page with tabbed detail view"
```

---

### Task 18: Cutover — remove the Placeholder helper and verify full parity

**Files:**
- Modify: `web/src/app/App.tsx` (remove now-unused `Placeholder` function), `web/src/views/dashboard/PainelView.tsx` (delete — no longer referenced by any route)

**Interfaces:** none new — this task only removes dead code and does final verification.

- [ ] **Step 1: Confirm `PainelView` has no remaining references**

Run: `grep -rn "PainelView" web/src --include=*.tsx --include=*.ts`
Expected: no output — Task 8's full rewrite of `App.tsx` already dropped the `<PainelView />` usage (replaced by the router), so the file has been dead code since then; this task just deletes it.

- [ ] **Step 2: Delete the dead file and the `Placeholder` helper**

```bash
rm web/src/views/dashboard/PainelView.tsx
```

In `web/src/app/App.tsx`, delete the `Placeholder` function (it was only used by routes that are all now wired to real pages by Tasks 10-17) — confirm no `<Placeholder` JSX usage remains in the file before deleting the function itself.

- [ ] **Step 3: Run the full frontend suite**

Run: `npm --prefix web run build && npm --prefix web run test`
Expected: `tsc -b` passes (no dangling import of the deleted file or function), all tests PASS.

- [ ] **Step 4: Manual verification against the reference mockup**

Run: `npm run office` (backend) and `npm --prefix web run dev` (frontend, proxying `/api` to the backend per `web/vite.config.ts`). Navigate all 9 sidebar items in the browser:
- Confirm each renders real data from the running backend (not "Aguardando dados" everywhere — if AI/HeyGen credits are still exhausted per the earlier session, "Aguardando dados"/error states are expected and fine, just confirm they render *gracefully*, not blank/crashed).
- Confirm workspace switch (top-right `<select>`) refetches every page's data (the inherited `AbortController` requirement from the Global Constraints).
- Compare visually against the original "Agent Office" reference image: sidebar item count/labels, dark theme, 5 agent cards on `/agentes`, timeline+B-roll gallery on a real Reel's `/reels/:id`.

- [ ] **Step 5: Run the backend suite one more time (no backend files changed in Fase 3, but confirms nothing else in the repo broke)**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore(web): remove old PainelView and shell placeholder after Agent Office cutover"
```

---

## Self-Review Notes

- **Spec coverage**: Fase 1 (§"Fase 1 — Backend" of the spec) → Tasks 1-6. Fase 2 (§"Fase 2 — Casca do frontend") → Tasks 7-8. Fase 3 page table → Tasks 9-17 (one row per page, `Configurações` needed no task since `ConfigView` is unchanged and wired directly in Task 8). Testing/error-state requirements → covered per-task; the spec's "erros e estados vazios" reuse of `ToastProvider`/"Aguardando dados" is followed by every new page (no new UI pattern introduced). Cutover → Task 18.
- **Type consistency checked**: `SceneSummary`/`TimelineStep`/`TimelineStepName` defined once in `src/reels/state.ts` (Task 1) and mirrored once in `web/src/types/api.ts` (Task 9) — field names match exactly (`step`, `at`, `type`, `label`, `assetId`, `thumbnailUrl`). `OfficeAgentId` defined once in `AgentesPage.tsx` (Task 16), imported by `AgenteDetailPage.tsx` (Task 17) — not redefined. `appendTimelineStep`'s signature (Task 1) is used identically in Tasks 2, 3, 4.
- **No placeholders**: every step above has real, complete code — the one intentionally-deferred item (HeyGen credit balance on the Finance card) is called out explicitly as out-of-scope in both the spec and Task 16, not silently stubbed.
