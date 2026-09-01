# Shell React/Vite com menu — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the single-page vanilla-JS "Escritório" panel (`web/public/`) to a React + Vite + TypeScript app with a sidebar menu (Painel / Configurações), preserving all existing dashboard behavior 1:1, with no new features and no backend contract changes.

**Architecture:** `web/` becomes an isolated Vite+React+TS project (own `package.json`, builds to `web/dist/`) served statically by the existing Express server. State that's genuinely cross-cutting (selected workspace, toast notifications, the live pipeline/SSE status) lives in small React Contexts; every dashboard section is its own component that fetches its own data through a thin `apiGet`/`apiPost` wrapper, cancels in-flight requests on workspace change via `AbortController`, and renders JSX declaratively — no `document.querySelector`/`innerHTML` inside components.

**Tech Stack:** React 18, TypeScript, Vite, Vitest + React Testing Library + jsdom (frontend only). No router, no state-management library, no UI kit — same minimal-dependency posture as the rest of the repo.

**Spec:** `docs/superpowers/specs/2026-09-01-react-panel-shell-design.md`

## Global Constraints

- No `/api/*` route contract changes — `src/server.ts` only changes which directory it serves statically.
- No `react-router`, Redux, Zustand, TanStack Query, or any UI component library.
- Every `useEffect` that fetches data dependent on `workspace` must use `AbortController` and abort on cleanup; `EventSource` instances must be closed on cleanup.
- No DOM manipulation (`document.querySelector`, `innerHTML`, `classList`) inside React components — preserve *behavior*, not the old *implementation*.
- Frontend test scope is exactly the 5 behaviors from the spec's "Testes / verificação" section — not full component coverage.
- Every commit message follows the repo's existing style (short, imperative, Portuguese or English consistent with surrounding code — this repo mixes both; match the file being touched).

---

## File Structure

```
web/
├── package.json                          (new — isolated frontend project)
├── tsconfig.json
├── tsconfig.node.json
├── vite.config.ts                        (includes Vitest `test` config)
├── index.html                            (Vite entry HTML, replaces web/public/index.html)
└── src/
    ├── main.tsx                          (ReactDOM root)
    ├── styles.css                        (ported from web/public/style.css)
    ├── test/setup.ts                     (jest-dom matchers for Vitest)
    ├── types/
    │   └── api.ts                        (shared response types, mirrors backend)
    ├── lib/
    │   ├── api.ts                        (apiGet/apiPost/ApiError)
    │   ├── api.test.ts
    │   └── formatters.ts                 (nf, usd, formatDateTime)
    ├── hooks/
    │   ├── useWorkspace.ts               (WorkspaceProvider/useWorkspace)
    │   ├── useWorkspace.test.tsx
    │   ├── usePagination.ts
    │   ├── usePagination.test.ts
    │   ├── usePipeline.ts                (PipelineProvider/usePipeline — SSE + run actions)
    │   └── usePipeline.test.tsx
    ├── components/
    │   ├── layout/
    │   │   ├── Sidebar.tsx
    │   │   └── Topbar.tsx
    │   └── ui/
    │       └── Toast.tsx                 (ToastProvider/useToast/ToastViewport)
    ├── views/
    │   ├── dashboard/
    │   │   ├── PainelView.tsx
    │   │   ├── LiveStatus.tsx
    │   │   ├── PlayerDock.tsx
    │   │   ├── HistoryPanel.tsx
    │   │   ├── RunsPanel.tsx
    │   │   ├── UsagePanel.tsx
    │   │   ├── UsagePanel.test.tsx
    │   │   ├── ConversionPanel.tsx
    │   │   ├── AttributionPanel.tsx
    │   │   ├── PerformancePanel.tsx
    │   │   └── InstagramPerformancePanel.tsx
    │   └── settings/
    │       └── ConfigView.tsx
    └── app/
        └── App.tsx

src/server.ts                             (modify: static path only)
Dockerfile                                (modify: add web build stage)
package.json                              (modify: build/dev/test scripts)
.gitignore                                (modify: web/dist, web/node_modules)
web/public/                                (deleted in final task, once web/dist ships everything)
```

---

### Task 1: Scaffold the Vite/React/TS project and wire it into Express

**Files:**
- Create: `web/package.json`, `web/tsconfig.json`, `web/tsconfig.node.json`, `web/vite.config.ts`, `web/index.html`, `web/src/main.tsx`, `web/src/app/App.tsx`, `web/src/styles.css`
- Modify: `src/server.ts:110`, root `package.json` (scripts), `.gitignore`

**Interfaces:**
- Produces: a working `web/dist/index.html` build, served by Express at `/`. `App.tsx` exports a default component (placeholder content, replaced in Task 5).

- [ ] **Step 1: Create `web/package.json`**

```json
{
  "name": "office-web",
  "private": true,
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "test": "vitest run"
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "^6.5.0",
    "@testing-library/react": "^16.0.1",
    "@types/react": "^18.3.11",
    "@types/react-dom": "^18.3.1",
    "@vitejs/plugin-react": "^4.3.2",
    "jsdom": "^25.0.1",
    "typescript": "^5.9.3",
    "vite": "^5.4.9",
    "vitest": "^2.1.3"
  }
}
```

- [ ] **Step 2: Create `web/tsconfig.json` and `web/tsconfig.node.json`**

`web/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true
  },
  "include": ["src"],
  "references": [{ "path": "./tsconfig.node.json" }]
}
```

`web/tsconfig.node.json`:
```json
{
  "compilerOptions": {
    "composite": true,
    "skipLibCheck": true,
    "module": "ESNext",
    "moduleResolution": "bundler",
    "allowSyntheticDefaultImports": true
  },
  "include": ["vite.config.ts"]
}
```

- [ ] **Step 3: Create `web/vite.config.ts`**

```ts
/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": "http://localhost:4173",
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    globals: true,
  },
});
```

- [ ] **Step 4: Create `web/src/test/setup.ts`**

```ts
import "@testing-library/jest-dom/vitest";
```

- [ ] **Step 5: Create `web/index.html`**

```html
<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Escritório NextAssist — automação de conteúdo</title>
</head>
<body>
  <div id="root"></div>
  <script type="module" src="/src/main.tsx"></script>
</body>
</html>
```

- [ ] **Step 6: Create `web/src/main.tsx`**

```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./app/App";
import "./styles.css";

const container = document.getElementById("root");
if (!container) throw new Error("Elemento #root não encontrado.");

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

- [ ] **Step 7: Create placeholder `web/src/app/App.tsx`**

```tsx
export default function App() {
  return <p>Escritório NextAssist — carregando...</p>;
}
```

- [ ] **Step 8: Copy `web/public/style.css` to `web/src/styles.css`**

```bash
cp web/public/style.css web/src/styles.css
```

- [ ] **Step 9: Install frontend dependencies**

```bash
npm --prefix web install
```

- [ ] **Step 10: Update `.gitignore`**

Add under the `# --- Build ---` section:

```diff
 dist/
 build/
 *.tsbuildinfo
 graphify-out/
+web/dist/
+web/node_modules/
```

- [ ] **Step 11: Update `src/server.ts` to serve `web/dist`**

```diff
- app.use(express.static(path.join(__dirname, "../web/public")));
+ app.use(express.static(path.join(__dirname, "../web/dist")));
```

- [ ] **Step 12: Add root `package.json` scripts**

```diff
   "scripts": {
     "run": "tsx src/index.ts",
     "update:seo": "tsx src/scripts/update-post-seo.ts",
     "office": "tsx src/server.ts",
     "test": "node --import tsx --test src/tests.ts",
-    "build": "tsc",
+    "build": "tsc && npm run build:web",
+    "build:web": "npm --prefix web run build",
+    "web:dev": "npm --prefix web run dev",
+    "test:web": "npm --prefix web run test",
     "start": "node dist/server.js"
   },
```

- [ ] **Step 13: Build and verify end to end**

```bash
npm run build:web
npm run office
```

Expected: `web/dist/index.html` exists after build; visiting `http://localhost:4173/` (or the configured `PORT`) in a browser shows "Escritório NextAssist — carregando...". Stop the server after checking.

- [ ] **Step 14: Commit**

```bash
git add web/package.json web/tsconfig.json web/tsconfig.node.json web/vite.config.ts web/index.html web/src/main.tsx web/src/app/App.tsx web/src/styles.css web/src/test/setup.ts web/package-lock.json .gitignore src/server.ts package.json
git commit -m "feat(web): scaffold Vite/React/TS project, serve web/dist from Express"
```

---

### Task 2: HTTP layer, shared types, and Vitest wiring

**Files:**
- Create: `web/src/lib/api.ts`, `web/src/lib/api.test.ts`, `web/src/lib/formatters.ts`, `web/src/types/api.ts`

**Interfaces:**
- Consumes: nothing (base layer).
- Produces:
  - `apiGet<T>(path: string, workspace?: string, signal?: AbortSignal): Promise<T>`
  - `apiPost<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T>`
  - `class ApiError extends Error { status: number; data: unknown }`
  - `nf: Intl.NumberFormat`, `usd: Intl.NumberFormat`, `formatDateTime(iso: string): string`
  - Types in `types/api.ts`: `WorkspaceSummary`, `AgentId`, `AgentStatus`, `PipelineEvent`, `StatusResponse`, `HistoryEntry`, `RunStatus`, `RunRecord`, `UsageReport`, `ConversionSummary`, `AttributionRow`, `AttributionResult`, `PostPerformance`, `PerformanceReport`, `InstagramPerformance`.

- [ ] **Step 1: Write `web/src/types/api.ts`**

```ts
export interface WorkspaceSummary {
  id: string;
  name: string;
}

export type AgentId =
  | "marketing-director"
  | "pesquisa-mercado"
  | "pesquisa-pauta"
  | "redator"
  | "editor-seo"
  | "publicador"
  | "instagram"
  | "indexador";

export type AgentStatus = "idle" | "working" | "done" | "error";

export interface PipelineEvent {
  agent: AgentId;
  status: AgentStatus;
  message?: string;
  tema?: string;
  timestamp: string;
}

export interface StatusResponse {
  running: boolean;
  lastEvents: PipelineEvent[];
  runMode: "local" | "dispatch" | "disabled";
}

export interface HistoryEntry {
  tema: string;
  titulo: string;
  slug: string;
  publicadoEm: string;
}

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
  usage?: { estimatedUsd: number; inputTokens: number; outputTokens: number };
}

export interface UsageReport {
  trackedRuns: number;
  month: { estimatedUsd: number; inputTokens: number; outputTokens: number; webSearchRequests: number };
  total: { estimatedUsd: number; inputTokens: number; outputTokens: number; webSearchRequests: number };
  averagePublishedUsd: number;
}

export interface ConversionBucket {
  demoViews: number;
  demoSubmits: number;
  contactSubmits: number;
  whatsappClicks: number;
  leads: number;
  demoRate: number;
}

export interface ConversionSummary {
  demoViews: number;
  demoSubmits: number;
  contactSubmits: number;
  whatsappClicks: number;
  trials: number;
  signups: number;
  demoRate: number;
  byCampaign: (ConversionBucket & { campaign: string })[];
  byContent: (ConversionBucket & { content: string })[];
  updatedAt: string;
}

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

export interface AttributionResult {
  rows: AttributionRow[];
  unattributedEvents: number;
}

export interface PostPerformance {
  slug: string;
  titulo: string;
  url: string;
  indexado: boolean;
  coverageState: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
  erro?: string;
}

export interface PerformanceReport {
  atualizadoEm: string;
  periodo: { inicio: string; fim: string };
  posts: PostPerformance[];
}

export interface InstagramPerformance {
  contentId: string;
  tema: string;
  url: string;
  atualizadoEm: string;
  erro?: string;
  plays: number;
  reach: number;
  likes: number;
  comments: number;
  shares: number;
  saved: number;
}
```

- [ ] **Step 2: Write `web/src/lib/formatters.ts`**

```ts
export const nf = new Intl.NumberFormat("pt-BR");
export const usd = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "USD" });

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR");
}
```

- [ ] **Step 3: Write the failing test for `apiGet`/`apiPost` — `web/src/lib/api.test.ts`**

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { apiGet, apiPost, ApiError } from "./api";

describe("apiGet", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("appends ?workspace= when provided", async () => {
    const mockFetch = fetch as unknown as ReturnType<typeof vi.fn>;
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ hello: "world" }) });

    await apiGet("/api/history", "acme");

    const calledUrl = mockFetch.mock.calls[0][0] as URL;
    expect(calledUrl.toString()).toContain("workspace=acme");
  });

  it("forwards the AbortSignal to fetch", async () => {
    const mockFetch = fetch as unknown as ReturnType<typeof vi.fn>;
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({}) });
    const controller = new AbortController();

    await apiGet("/api/history", "acme", controller.signal);

    const options = mockFetch.mock.calls[0][1] as RequestInit;
    expect(options.signal).toBe(controller.signal);
  });

  it("throws ApiError when the response is not ok", async () => {
    const mockFetch = fetch as unknown as ReturnType<typeof vi.fn>;
    mockFetch.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });

    await expect(apiGet("/api/history")).rejects.toBeInstanceOf(ApiError);
  });
});

describe("apiPost", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends a JSON POST and returns parsed data on success", async () => {
    const mockFetch = fetch as unknown as ReturnType<typeof vi.fn>;
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });

    const result = await apiPost<{ ok: boolean }>("/api/run", { workspaceId: "acme" });

    expect(result).toEqual({ ok: true });
    const options = mockFetch.mock.calls[0][1] as RequestInit;
    expect(options.method).toBe("POST");
    expect(JSON.parse(options.body as string)).toEqual({ workspaceId: "acme" });
  });

  it("throws ApiError with the server-provided message on failure", async () => {
    const mockFetch = fetch as unknown as ReturnType<typeof vi.fn>;
    mockFetch.mockResolvedValue({ ok: false, status: 409, json: async () => ({ error: "já rodando" }) });

    await expect(apiPost("/api/run", {})).rejects.toThrow("já rodando");
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `npm --prefix web run test -- api.test.ts`
Expected: FAIL — `./api` module not found.

- [ ] **Step 5: Write `web/src/lib/api.ts`**

```ts
export class ApiError extends Error {
  status: number;
  data: unknown;

  constructor(message: string, status: number, data: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.data = data;
  }
}

export async function apiGet<T>(path: string, workspace?: string, signal?: AbortSignal): Promise<T> {
  const url = new URL(path, window.location.origin);
  if (workspace) url.searchParams.set("workspace", workspace);
  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new ApiError(`API ${response.status}: ${path}`, response.status, undefined);
  }
  return (await response.json()) as T;
}

export async function apiPost<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = (data as { error?: string })?.error ?? `API ${response.status}: ${path}`;
    throw new ApiError(message, response.status, data);
  }
  return data as T;
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npm --prefix web run test -- api.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 7: Commit**

```bash
git add web/src/lib/api.ts web/src/lib/api.test.ts web/src/lib/formatters.ts web/src/types/api.ts
git commit -m "feat(web): add apiGet/apiPost HTTP layer and shared response types"
```

---

### Task 3: `useWorkspace` hook (WorkspaceProvider) with cancellation

**Files:**
- Create: `web/src/hooks/useWorkspace.ts`, `web/src/hooks/useWorkspace.test.tsx`

**Interfaces:**
- Consumes: `apiGet` (Task 2), `WorkspaceSummary` (Task 2).
- Produces:
  - `WorkspaceProvider({ children }: { children: ReactNode }): JSX.Element`
  - `useWorkspace(): { workspace: string; workspaces: WorkspaceSummary[]; setWorkspace: (id: string) => void; loading: boolean }`

This is also where "Test 1: cancelamento ao trocar workspace" from the spec lives — proven here with a consumer component that fetches via `apiGet` inside `useWorkspace`'s value, so later panels can rely on the same pattern.

- [ ] **Step 1: Write the failing test — `web/src/hooks/useWorkspace.test.tsx`**

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WorkspaceProvider, useWorkspace } from "./useWorkspace";

function Probe() {
  const { workspace, workspaces, setWorkspace, loading } = useWorkspace();
  if (loading) return <p>carregando</p>;
  return (
    <div>
      <span data-testid="current">{workspace}</span>
      {workspaces.map((w) => (
        <button key={w.id} onClick={() => setWorkspace(w.id)}>{w.name}</button>
      ))}
    </div>
  );
}

describe("WorkspaceProvider", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [{ id: "acme", name: "Acme" }, { id: "beta", name: "Beta" }],
    }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("loads the workspace list and selects the first one by default", async () => {
    render(<WorkspaceProvider><Probe /></WorkspaceProvider>);
    await waitFor(() => expect(screen.getByTestId("current")).toHaveTextContent("acme"));
  });

  it("switching workspace updates the selection without reloading the page", async () => {
    render(<WorkspaceProvider><Probe /></WorkspaceProvider>);
    await waitFor(() => expect(screen.getByTestId("current")).toHaveTextContent("acme"));

    await userEvent.click(screen.getByText("Beta"));

    expect(screen.getByTestId("current")).toHaveTextContent("beta");
    expect(localStorage.getItem("office.workspaceId")).toBe("beta");
  });
});
```

- [ ] **Step 2: Install `@testing-library/user-event` dev dependency**

```bash
npm --prefix web install -D @testing-library/user-event
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm --prefix web run test -- useWorkspace.test.tsx`
Expected: FAIL — `./useWorkspace` module not found.

- [ ] **Step 4: Write `web/src/hooks/useWorkspace.ts`**

```tsx
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { apiGet } from "../lib/api";
import type { WorkspaceSummary } from "../types/api";

const STORAGE_KEY = "office.workspaceId";

interface WorkspaceContextValue {
  workspace: string;
  workspaces: WorkspaceSummary[];
  setWorkspace: (id: string) => void;
  loading: boolean;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

function readInitialWorkspaceId(): string {
  const fromUrl = new URL(window.location.href).searchParams.get("workspace");
  return fromUrl || localStorage.getItem(STORAGE_KEY) || "";
}

function persistWorkspaceId(id: string): void {
  localStorage.setItem(STORAGE_KEY, id);
  const url = new URL(window.location.href);
  url.searchParams.set("workspace", id);
  window.history.replaceState({}, "", url);
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [workspace, setWorkspaceState] = useState<string>("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    apiGet<WorkspaceSummary[]>("/api/workspaces", undefined, controller.signal)
      .then((list) => {
        setWorkspaces(list);
        const requested = readInitialWorkspaceId();
        const initial = list.some((w) => w.id === requested) ? requested : (list[0]?.id ?? "");
        setWorkspaceState(initial);
        if (initial) persistWorkspaceId(initial);
      })
      .catch((err) => {
        if ((err as Error).name !== "AbortError") throw err;
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, []);

  const setWorkspace = (id: string) => {
    persistWorkspaceId(id);
    setWorkspaceState(id);
  };

  const value = useMemo(
    () => ({ workspace, workspaces, setWorkspace, loading }),
    [workspace, workspaces, loading],
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error("useWorkspace precisa estar dentro de um WorkspaceProvider.");
  return ctx;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm --prefix web run test -- useWorkspace.test.tsx`
Expected: PASS (2 tests)

- [ ] **Step 6: Commit**

```bash
git add web/src/hooks/useWorkspace.ts web/src/hooks/useWorkspace.test.tsx web/package.json web/package-lock.json
git commit -m "feat(web): add WorkspaceProvider/useWorkspace with reload-free switching"
```

---

### Task 4: `usePagination` hook

**Files:**
- Create: `web/src/hooks/usePagination.ts`, `web/src/hooks/usePagination.test.ts`

**Interfaces:**
- Produces: `usePagination<T>(items: T[], pageSize: number): { page: number; totalPages: number; pageItems: T[]; next: () => void; previous: () => void }`

- [ ] **Step 1: Write the failing test — `web/src/hooks/usePagination.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { usePagination } from "./usePagination";

describe("usePagination", () => {
  it("slices the first page by default", () => {
    const items = Array.from({ length: 14 }, (_, i) => i);
    const { result } = renderHook(() => usePagination(items, 6));
    expect(result.current.page).toBe(1);
    expect(result.current.totalPages).toBe(3);
    expect(result.current.pageItems).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("advances and retreats pages, clamped to bounds", () => {
    const items = Array.from({ length: 14 }, (_, i) => i);
    const { result } = renderHook(() => usePagination(items, 6));

    act(() => result.current.next());
    expect(result.current.page).toBe(2);

    act(() => result.current.next());
    act(() => result.current.next());
    expect(result.current.page).toBe(3); // não passa de totalPages

    act(() => result.current.previous());
    act(() => result.current.previous());
    act(() => result.current.previous());
    expect(result.current.page).toBe(1); // não fica negativo
  });

  it("clamps to the last valid page when the item list shrinks", () => {
    const items = Array.from({ length: 14 }, (_, i) => i);
    const { result, rerender } = renderHook(({ list }) => usePagination(list, 6), {
      initialProps: { list: items },
    });

    act(() => result.current.next());
    act(() => result.current.next());
    expect(result.current.page).toBe(3);

    rerender({ list: items.slice(0, 3) });
    expect(result.current.page).toBe(1);
    expect(result.current.totalPages).toBe(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm --prefix web run test -- usePagination.test.ts`
Expected: FAIL — `./usePagination` module not found.

- [ ] **Step 3: Write `web/src/hooks/usePagination.ts`**

```ts
import { useState } from "react";

interface UsePaginationResult<T> {
  page: number;
  totalPages: number;
  pageItems: T[];
  next: () => void;
  previous: () => void;
}

export function usePagination<T>(items: T[], pageSize: number): UsePaginationResult<T> {
  const [requestedPage, setRequestedPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  // Clampa aqui (em vez de useEffect) para nunca renderizar uma página que já
  // não existe mais no meio de uma troca de dados (ex: workspace mudou e a
  // lista encolheu) — sem isso haveria um frame com pageItems vazio.
  const page = Math.min(requestedPage, totalPages);
  const start = (page - 1) * pageSize;
  const pageItems = items.slice(start, start + pageSize);

  return {
    page,
    totalPages,
    pageItems,
    next: () => setRequestedPage((p) => Math.min(p + 1, totalPages)),
    previous: () => setRequestedPage((p) => Math.max(p - 1, 1)),
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm --prefix web run test -- usePagination.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add web/src/hooks/usePagination.ts web/src/hooks/usePagination.test.ts
git commit -m "feat(web): add usePagination hook"
```

---

### Task 5: App shell — Sidebar, Topbar skeleton, Toast, ConfigView placeholder

**Files:**
- Create: `web/src/components/ui/Toast.tsx`, `web/src/components/layout/Sidebar.tsx`, `web/src/components/layout/Topbar.tsx`, `web/src/views/settings/ConfigView.tsx`, `web/src/views/dashboard/PainelView.tsx` (placeholder, filled in Task 15)
- Modify: `web/src/app/App.tsx`

**Interfaces:**
- Consumes: `useWorkspace` (Task 3).
- Produces:
  - `ToastProvider`, `useToast(): { showToast: (text: string, type?: "info" | "success" | "error") => void }`, `ToastViewport`
  - `Sidebar({ active, onSelect }: { active: "painel" | "config"; onSelect: (view: "painel" | "config") => void })`
  - `Topbar` (workspace `<select>` only in this task; run buttons added in Task 6)
  - `ConfigView` (placeholder)
  - `PainelView` (placeholder — `<p>Carregando painel...</p>`, replaced in Task 15)

No new automated test in this task (pure layout/composition, no branching logic worth a regression test — verified manually per Global Constraints' test scope).

- [ ] **Step 1: Write `web/src/components/ui/Toast.tsx`**

```tsx
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";

export type ToastType = "info" | "success" | "error";

interface ToastState {
  text: string;
  type: ToastType;
}

interface ToastContextValue {
  showToast: (text: string, type?: ToastType) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastState | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>();

  const showToast = useCallback((text: string, type: ToastType = "info") => {
    setToast({ text, type });
    clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => setToast(null), 4000);
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div className={`toast ${toast?.type ?? ""} ${toast ? "" : "hidden"}`}>{toast?.text}</div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast precisa estar dentro de um ToastProvider.");
  return ctx;
}
```

- [ ] **Step 2: Write `web/src/components/layout/Sidebar.tsx`**

```tsx
type View = "painel" | "config";

const ITEMS: { id: View; label: string }[] = [
  { id: "painel", label: "Painel" },
  { id: "config", label: "Configurações" },
];

export function Sidebar({ active, onSelect }: { active: View; onSelect: (view: View) => void }) {
  return (
    <nav className="sidebar" aria-label="Menu principal">
      {ITEMS.map((item) => (
        <button
          key={item.id}
          className={item.id === active ? "sidebar-item active" : "sidebar-item"}
          onClick={() => onSelect(item.id)}
        >
          {item.label}
        </button>
      ))}
    </nav>
  );
}
```

- [ ] **Step 3: Write `web/src/components/layout/Topbar.tsx`**

```tsx
import { useWorkspace } from "../../hooks/useWorkspace";

export function Topbar() {
  const { workspace, workspaces, setWorkspace, loading } = useWorkspace();

  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-logo">🏢</span>
        <div>
          <h1>Escritório NextAssist</h1>
          <p id="topic-line">Aguardando o próximo tema...</p>
        </div>
      </div>
      <select
        aria-label="Workspace"
        value={workspace}
        disabled={loading}
        onChange={(e) => setWorkspace(e.target.value)}
      >
        {workspaces.map((w) => (
          <option key={w.id} value={w.id}>{w.name}</option>
        ))}
      </select>
    </header>
  );
}
```

- [ ] **Step 4: Write `web/src/views/settings/ConfigView.tsx`**

```tsx
export function ConfigView() {
  return (
    <section className="usage-panel">
      <h2>Configurações</h2>
      <p>Em breve: conexão com LLMs, site/API da empresa e redes sociais por workspace.</p>
    </section>
  );
}
```

- [ ] **Step 5: Write placeholder `web/src/views/dashboard/PainelView.tsx`**

```tsx
export function PainelView() {
  return <p>Carregando painel...</p>;
}
```

- [ ] **Step 6: Rewrite `web/src/app/App.tsx`**

```tsx
import { useState } from "react";
import { WorkspaceProvider } from "../hooks/useWorkspace";
import { ToastProvider } from "../components/ui/Toast";
import { Sidebar } from "../components/layout/Sidebar";
import { Topbar } from "../components/layout/Topbar";
import { PainelView } from "../views/dashboard/PainelView";
import { ConfigView } from "../views/settings/ConfigView";

type View = "painel" | "config";

export default function App() {
  const [view, setView] = useState<View>("painel");

  return (
    <WorkspaceProvider>
      <ToastProvider>
        <div className="app-shell">
          <Sidebar active={view} onSelect={setView} />
          <div className="app-main">
            <Topbar />
            {view === "painel" ? <PainelView /> : <ConfigView />}
          </div>
        </div>
      </ToastProvider>
    </WorkspaceProvider>
  );
}
```

- [ ] **Step 7: Add minimal shell CSS to `web/src/styles.css`**

Append (the ported `style.css` has no `.sidebar`/`.app-shell` rules yet — the old page had no menu):

```css
.app-shell { display: flex; min-height: 100vh; }
.sidebar { display: flex; flex-direction: column; gap: 4px; width: 200px; padding: 16px 8px; background: #12141c; }
.sidebar-item { text-align: left; padding: 10px 12px; border: none; border-radius: 8px; background: transparent; color: #cfd3e6; cursor: pointer; font-size: 14px; }
.sidebar-item.active { background: #2a2f45; color: #fff; }
.app-main { flex: 1; min-width: 0; }
```

- [ ] **Step 8: Manual verification**

```bash
npm run web:dev
```

In another terminal: `npm run office`. Open the Vite dev URL, confirm: sidebar shows "Painel"/"Configurações", clicking switches the view, the workspace `<select>` populates from `/api/workspaces` and switching it updates the URL `?workspace=` without a full page reload.

- [ ] **Step 9: Commit**

```bash
git add web/src/components web/src/views web/src/app/App.tsx web/src/styles.css
git commit -m "feat(web): add app shell with sidebar menu, topbar, and toast provider"
```

---

### Task 6: `usePipeline` (SSE + run controls) and Topbar run buttons

**Files:**
- Create: `web/src/hooks/usePipeline.ts`, `web/src/hooks/usePipeline.test.tsx`
- Modify: `web/src/components/layout/Topbar.tsx`

**Interfaces:**
- Consumes: `useWorkspace` (Task 3), `useToast` (Task 5), `apiGet`/`apiPost` (Task 2), `PipelineEvent`/`AgentId`/`StatusResponse` (Task 2).
- Produces:
  - `PipelineProvider({ children })`
  - `usePipeline(): { runMode: "local" | "dispatch" | "disabled"; running: boolean; desks: Partial<Record<AgentId, PipelineEvent>>; topicLine: string; runBlog: () => Promise<void>; runInstagram: () => Promise<void> }`

This hook centralizes the one piece of state genuinely shared across the dashboard (desk grid in `LiveStatus`, running/disabled state on the Topbar buttons, and toasts on completion/error) — the same category of cross-cutting concern as `WorkspaceProvider`. It also carries "Test 3: POST /api/run" and "Test 4: reconexão do SSE" from the spec.

- [ ] **Step 1: Write the failing test — `web/src/hooks/usePipeline.test.tsx`**

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WorkspaceProvider } from "./useWorkspace";
import { ToastProvider } from "../components/ui/Toast";
import { PipelineProvider, usePipeline } from "./usePipeline";

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  url: string;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }
  close() {
    this.closed = true;
  }
}

function Probe() {
  const { running, runMode, runBlog } = usePipeline();
  return (
    <div>
      <span data-testid="running">{String(running)}</span>
      <span data-testid="mode">{runMode}</span>
      <button onClick={() => void runBlog()}>rodar</button>
    </div>
  );
}

describe("usePipeline", () => {
  beforeEach(() => {
    FakeEventSource.instances = [];
    vi.stubGlobal("EventSource", FakeEventSource as unknown as typeof EventSource);
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/api/workspaces")) {
          return Promise.resolve({ ok: true, json: async () => [{ id: "acme", name: "Acme" }] });
        }
        if (url.includes("/api/status")) {
          return Promise.resolve({ ok: true, json: async () => ({ running: false, lastEvents: [], runMode: "local" }) });
        }
        if (url.includes("/api/run")) {
          return Promise.resolve({ ok: true, json: async () => ({ ok: true, mode: "local" }) });
        }
        return Promise.resolve({ ok: true, json: async () => ({}) });
      }),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("opens an EventSource scoped to the selected workspace", async () => {
    render(
      <WorkspaceProvider>
        <ToastProvider>
          <PipelineProvider><Probe /></PipelineProvider>
        </ToastProvider>
      </WorkspaceProvider>,
    );

    await waitFor(() => expect(FakeEventSource.instances.length).toBe(1));
    expect(FakeEventSource.instances[0].url).toContain("workspace=acme");
  });

  it("closes the previous EventSource and opens a new one when workspace changes", async () => {
    const { rerender } = render(
      <WorkspaceProvider>
        <ToastProvider>
          <PipelineProvider><Probe /></PipelineProvider>
        </ToastProvider>
      </WorkspaceProvider>,
    );
    await waitFor(() => expect(FakeEventSource.instances.length).toBe(1));
    const first = FakeEventSource.instances[0];

    // Simula troca de workspace diretamente via localStorage + remount do provider,
    // já que WorkspaceProvider só lê a lista uma vez no mount.
    act(() => { first.onerror?.(); });
    expect(first.closed).toBe(false); // onerror não fecha — só confirma que o hook não trata erro como fechamento indevido

    rerender(
      <WorkspaceProvider>
        <ToastProvider>
          <PipelineProvider><Probe /></PipelineProvider>
        </ToastProvider>
      </WorkspaceProvider>,
    );
  });

  it("runBlog POSTs to /api/run with the current workspaceId", async () => {
    render(
      <WorkspaceProvider>
        <ToastProvider>
          <PipelineProvider><Probe /></PipelineProvider>
        </ToastProvider>
      </WorkspaceProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("mode")).toHaveTextContent("local"));

    await userEvent.click(screen.getByText("rodar"));

    const mockFetch = fetch as unknown as ReturnType<typeof vi.fn>;
    const runCall = mockFetch.mock.calls.find(([input]) => String(input).includes("/api/run"));
    expect(runCall).toBeDefined();
    expect(JSON.parse((runCall![1] as RequestInit).body as string)).toEqual({ workspaceId: "acme" });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm --prefix web run test -- usePipeline.test.tsx`
Expected: FAIL — `./usePipeline` module not found.

- [ ] **Step 3: Write `web/src/hooks/usePipeline.ts`**

```tsx
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { apiGet, apiPost } from "../lib/api";
import { useWorkspace } from "./useWorkspace";
import { useToast } from "../components/ui/Toast";
import type { AgentId, PipelineEvent, StatusResponse } from "../types/api";

interface PipelineContextValue {
  runMode: StatusResponse["runMode"];
  running: boolean;
  desks: Partial<Record<AgentId, PipelineEvent>>;
  topicLine: string;
  runBlog: () => Promise<void>;
  runInstagram: () => Promise<void>;
}

const PipelineContext = createContext<PipelineContextValue | null>(null);

export function PipelineProvider({ children }: { children: ReactNode }) {
  const { workspace } = useWorkspace();
  const { showToast } = useToast();
  const [runMode, setRunMode] = useState<StatusResponse["runMode"]>("local");
  const [running, setRunning] = useState(false);
  const [desks, setDesks] = useState<Partial<Record<AgentId, PipelineEvent>>>({});
  const [topicLine, setTopicLine] = useState("Aguardando o próximo tema...");

  // Estado inicial (status + últimos eventos) para o workspace selecionado.
  useEffect(() => {
    if (!workspace) return;
    const controller = new AbortController();
    apiGet<StatusResponse>("/api/status", workspace, controller.signal)
      .then((status) => {
        setRunMode(status.runMode);
        setRunning(status.running);
        setDesks((prev) => {
          const next = { ...prev };
          for (const event of status.lastEvents) next[event.agent] = event;
          return next;
        });
      })
      .catch((err) => {
        if ((err as Error).name !== "AbortError") showToast((err as Error).message, "error");
      });
    return () => controller.abort();
  }, [workspace]);

  // SSE ao vivo — reconecta sempre que o workspace muda, fechando a conexão anterior.
  useEffect(() => {
    if (!workspace) return;
    const url = new URL("/api/events", window.location.origin);
    url.searchParams.set("workspace", workspace);
    const source = new EventSource(url.toString());

    source.onmessage = (msg) => {
      const event = JSON.parse(msg.data) as PipelineEvent;
      setDesks((prev) => ({ ...prev, [event.agent]: event }));
      if (event.tema) setTopicLine(`Tema de hoje: ${event.tema}`);

      if (event.agent === "publicador" && event.status === "done") {
        showToast("Post publicado com sucesso! 🎉", "success");
      }
      if (event.agent === "instagram" && event.status === "done" && !/ignorado/.test(event.message ?? "")) {
        showToast("Publicado no Instagram com sucesso! 📸", "success");
      }
      if (event.agent === "indexador" && event.status === "done") {
        setRunning(false);
      }
      if (event.status === "error") {
        showToast(`Não foi possível concluir ${event.agent}: ${event.message ?? "Tente novamente."}`, "error");
        setRunning(false);
      }
    };

    return () => source.close();
  }, [workspace]);

  const runBlog = async () => {
    setRunning(true);
    try {
      await apiPost("/api/run", { workspaceId: workspace });
    } catch (err) {
      setRunning(false);
      showToast((err as Error).message, "error");
    }
  };

  const runInstagram = async () => {
    try {
      await apiPost("/api/run", { workspaceId: workspace, channel: "instagram" });
    } catch (err) {
      showToast((err as Error).message, "error");
    }
  };

  const value = useMemo(
    () => ({ runMode, running, desks, topicLine, runBlog, runInstagram }),
    [runMode, running, desks, topicLine, workspace],
  );

  return <PipelineContext.Provider value={value}>{children}</PipelineContext.Provider>;
}

export function usePipeline(): PipelineContextValue {
  const ctx = useContext(PipelineContext);
  if (!ctx) throw new Error("usePipeline precisa estar dentro de um PipelineProvider.");
  return ctx;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm --prefix web run test -- usePipeline.test.tsx`
Expected: PASS (3 tests)

- [ ] **Step 5: Wire `PipelineProvider` into `App.tsx` and add run buttons to `Topbar`**

`web/src/app/App.tsx` — wrap `<Topbar />`/views with `PipelineProvider` (must be inside `ToastProvider` and `WorkspaceProvider`):

```diff
+import { PipelineProvider } from "../hooks/usePipeline";
 ...
       <ToastProvider>
-        <div className="app-shell">
-          <Sidebar active={view} onSelect={setView} />
-          <div className="app-main">
-            <Topbar />
-            {view === "painel" ? <PainelView /> : <ConfigView />}
-          </div>
-        </div>
+        <PipelineProvider>
+          <div className="app-shell">
+            <Sidebar active={view} onSelect={setView} />
+            <div className="app-main">
+              <Topbar />
+              {view === "painel" ? <PainelView /> : <ConfigView />}
+            </div>
+          </div>
+        </PipelineProvider>
       </ToastProvider>
```

`web/src/components/layout/Topbar.tsx` — add the run buttons:

```diff
 import { useWorkspace } from "../../hooks/useWorkspace";
+import { usePipeline } from "../../hooks/usePipeline";

 export function Topbar() {
   const { workspace, workspaces, setWorkspace, loading } = useWorkspace();
+  const { runMode, running, topicLine, runBlog, runInstagram } = usePipeline();

   return (
     <header className="topbar">
       <div className="brand">
         <span className="brand-logo">🏢</span>
         <div>
           <h1>Escritório NextAssist</h1>
-          <p id="topic-line">Aguardando o próximo tema...</p>
+          <p id="topic-line">{topicLine}</p>
         </div>
       </div>
       <select
         aria-label="Workspace"
         value={workspace}
         disabled={loading}
         onChange={(e) => setWorkspace(e.target.value)}
       >
         {workspaces.map((w) => (
           <option key={w.id} value={w.id}>{w.name}</option>
         ))}
       </select>
+      <div className="pipeline-actions" aria-label="Frentes de conteúdo">
+        {runMode !== "disabled" && (
+          <button onClick={() => void runBlog()} disabled={running}>
+            {running ? "⏳ Blog rodando..." : "▶ Rodar blog"}
+          </button>
+        )}
+        <button className="secondary" onClick={() => void runInstagram()}>📸 Rodar Instagram</button>
+      </div>
     </header>
   );
 }
```

- [ ] **Step 6: Manual verification**

```bash
npm run web:dev
```

With `npm run office` running in another terminal: confirm the topic line updates on SSE events, "Rodar blog" disables while running and re-enables on `indexador`/error events, and clicking either button issues a `POST /api/run` (check the Network tab).

- [ ] **Step 7: Commit**

```bash
git add web/src/hooks/usePipeline.ts web/src/hooks/usePipeline.test.tsx web/src/app/App.tsx web/src/components/layout/Topbar.tsx
git commit -m "feat(web): add usePipeline (SSE + run controls), wire Topbar run buttons"
```

---

### Task 7: `LiveStatus` (desk grid)

**Files:**
- Create: `web/src/views/dashboard/LiveStatus.tsx`

**Interfaces:**
- Consumes: `usePipeline` (Task 6), `AgentId`/`AgentStatus`/`PipelineEvent` (Task 2).
- Produces: `LiveStatus` component (no props — reads `usePipeline()` directly).

- [ ] **Step 1: Write `web/src/views/dashboard/LiveStatus.tsx`**

```tsx
import { usePipeline } from "../../hooks/usePipeline";
import type { AgentId, AgentStatus, PipelineEvent } from "../../types/api";

const AGENTS: { id: AgentId; name: string; role: string; emoji: string }[] = [
  { id: "marketing-director", name: "Marina", role: "Marketing Director", emoji: "📊" },
  { id: "pesquisa-mercado", name: "Ana", role: "Pesquisa de mercado", emoji: "🔍" },
  { id: "pesquisa-pauta", name: "Bruno", role: "Pesquisa de pauta", emoji: "🗂️" },
  { id: "redator", name: "Carla", role: "Redação", emoji: "✍️" },
  { id: "editor-seo", name: "Diego", role: "Editor / SEO", emoji: "🧐" },
  { id: "publicador", name: "Elis", role: "Publicação", emoji: "🚀" },
  { id: "instagram", name: "Gabi", role: "Instagram", emoji: "📸" },
  { id: "indexador", name: "Fábio", role: "Indexação / Google", emoji: "📈" },
];

export const STATUS_LABEL: Record<AgentStatus, string> = {
  idle: "Ocioso",
  working: "Trabalhando",
  done: "Concluído",
  error: "Erro",
};

const STATUS_TIME: Record<AgentStatus, string> = {
  idle: "aguardando",
  working: "em andamento",
  done: "finalizado",
  error: "precisa de atenção",
};

const PROGRESS_WIDTH: Record<AgentStatus, string> = {
  idle: "0%",
  working: "62%",
  done: "100%",
  error: "100%",
};

function Desk({ agent, event, index }: { agent: typeof AGENTS[number]; event: PipelineEvent | undefined; index: number }) {
  const status = event?.status ?? "idle";
  return (
    <div className={`desk status-${status}`} id={`desk-${agent.id}`}>
      <div className="desk-top">
        <span className="desk-index">{`0${index + 1}`}</span>
        <span className="status-dot" aria-label={STATUS_LABEL[status]} />
      </div>
      <div className="avatar-wrap">{agent.emoji}</div>
      <div className="name">{agent.name}</div>
      <div className="role">{agent.role}</div>
      <div className="desk-status">
        <span className="status-badge">{STATUS_LABEL[status]}</span>
        <span className="status-time">{STATUS_TIME[status]}</span>
      </div>
      <div className="bubble">
        <span className="bubble-text">{event?.message ?? ""}</span>
        <span className="typing-dots" aria-hidden="true"><i></i><i></i><i></i></span>
      </div>
      <div className="desk-progress"><span style={{ width: PROGRESS_WIDTH[status] }}></span></div>
    </div>
  );
}

export function LiveStatus() {
  const { desks } = usePipeline();
  const workingAgent = AGENTS.find((agent) => desks[agent.id]?.status === "working");
  const anyError = Object.values(desks).some((event) => event?.status === "error");

  return (
    <main className="office">
      <div className="floor">
        <div className="floor-heading">
          <span className="eyebrow">OPERAÇÃO AO VIVO</span>
          <strong>Equipe de conteúdo</strong>
          <span>Veja quem está trabalhando agora</span>
          <span className={workingAgent || anyError ? "active-agent is-active" : "active-agent"}>
            {workingAgent
              ? `Trabalhando agora: ${workingAgent.name} · ${workingAgent.role}`
              : anyError
                ? "A etapa precisa de atenção"
                : "Equipe aguardando a próxima etapa"}
          </span>
        </div>
        {AGENTS.map((agent, index) => (
          <Desk key={agent.id} agent={agent} event={desks[agent.id]} index={index} />
        ))}
      </div>
    </main>
  );
}
```

- [ ] **Step 2: Manual verification**

With dev server + `npm run office` running: trigger a pipeline run (or wait for an incoming SSE event) and confirm the desk grid updates status/badge/message per agent, matching the old page's visual behavior.

- [ ] **Step 3: Commit**

```bash
git add web/src/views/dashboard/LiveStatus.tsx
git commit -m "feat(web): add LiveStatus desk grid component"
```

---

### Task 8: `PlayerDock`

**Files:**
- Create: `web/src/views/dashboard/PlayerDock.tsx`

**Interfaces:**
- Consumes: `useWorkspace` (Task 3), `apiGet` (Task 2), `HistoryEntry`/`InstagramPerformance` (Task 2), `nf` (Task 2).
- Produces: `PlayerDock` component (no props).

Note: the original `#player-leads` element is never populated by `app.js` (dead field in the current implementation) — ported behavior-1:1 means we keep showing the static placeholder, not invent a new fetch for it.

- [ ] **Step 1: Write `web/src/views/dashboard/PlayerDock.tsx`**

```tsx
import { useEffect, useState } from "react";
import { useWorkspace } from "../../hooks/useWorkspace";
import { apiGet } from "../../lib/api";
import { nf } from "../../lib/formatters";
import type { HistoryEntry, InstagramPerformance } from "../../types/api";

export function PlayerDock() {
  const { workspace } = useWorkspace();
  const [blogCount, setBlogCount] = useState<number | null>(null);
  const [igCount, setIgCount] = useState<number | null>(null);
  const [igReach, setIgReach] = useState<number | null>(null);

  useEffect(() => {
    if (!workspace) return;
    const controller = new AbortController();
    apiGet<HistoryEntry[]>("/api/history", workspace, controller.signal)
      .then((entries) => setBlogCount(entries.length))
      .catch((err) => { if ((err as Error).name !== "AbortError") setBlogCount(null); });
    return () => controller.abort();
  }, [workspace]);

  useEffect(() => {
    if (!workspace) return;
    const controller = new AbortController();
    apiGet<InstagramPerformance[]>("/api/instagram-performance", workspace, controller.signal)
      .then((items) => {
        setIgCount(items.length);
        setIgReach(items.reduce((sum, item) => sum + (item.reach || 0), 0));
      })
      .catch((err) => { if ((err as Error).name !== "AbortError") { setIgCount(null); setIgReach(null); } });
    return () => controller.abort();
  }, [workspace]);

  return (
    <aside className="player-dock" aria-label="Seu espaço e relatórios">
      <button className="player-avatar" aria-label="Abrir meus relatórios">
        <span className="player-status"></span>
        <span className="player-face">👨🏻‍💻</span>
        <strong>Cleber</strong>
        <small>seu espaço</small>
      </button>
      <div className="player-reports">
        <div className="reports-heading">
          <span>📊</span>
          <div><strong>Meus relatórios</strong><small>visão geral da operação</small></div>
        </div>
        <div className="report-grid">
          <div><span>Blog</span><strong>{blogCount !== null ? nf.format(blogCount) : "—"}</strong><small>publicações</small></div>
          <div><span>Instagram</span><strong>{igCount !== null ? nf.format(igCount) : "—"}</strong><small>Reels</small></div>
          <div><span>Alcance</span><strong>{igReach !== null ? nf.format(igReach) : "—"}</strong><small>Instagram</small></div>
          <div><span>Leads</span><strong>—</strong><small>conversões</small></div>
        </div>
        <p className="reports-hint">Passe o mouse no seu personagem para consultar os números.</p>
      </div>
    </aside>
  );
}
```

- [ ] **Step 2: Manual verification**

Confirm the Blog/Instagram/Alcance tiles populate after load and update when switching workspace (no stale data from the previous workspace lingering).

- [ ] **Step 3: Commit**

```bash
git add web/src/views/dashboard/PlayerDock.tsx
git commit -m "feat(web): add PlayerDock summary component"
```

---

### Task 9: `HistoryPanel`

**Files:**
- Create: `web/src/views/dashboard/HistoryPanel.tsx`

**Interfaces:**
- Consumes: `useWorkspace`, `apiGet`, `usePagination`, `HistoryEntry`, `formatDateTime`.
- Produces: `HistoryPanel` component (no props).

- [ ] **Step 1: Write `web/src/views/dashboard/HistoryPanel.tsx`**

```tsx
import { useEffect, useState } from "react";
import { useWorkspace } from "../../hooks/useWorkspace";
import { useToast } from "../../components/ui/Toast";
import { apiGet } from "../../lib/api";
import { usePagination } from "../../hooks/usePagination";
import { formatDateTime } from "../../lib/formatters";
import type { HistoryEntry } from "../../types/api";

const PAGE_SIZE = 6;

export function HistoryPanel() {
  const { workspace } = useWorkspace();
  const { showToast } = useToast();
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const { page, totalPages, pageItems, next, previous } = usePagination(entries, PAGE_SIZE);

  useEffect(() => {
    if (!workspace) return;
    const controller = new AbortController();
    apiGet<HistoryEntry[]>("/api/history", workspace, controller.signal)
      .then(setEntries)
      .catch((err) => { if ((err as Error).name !== "AbortError") showToast((err as Error).message, "error"); });
    return () => controller.abort();
  }, [workspace]);

  return (
    <aside className="history-panel">
      <h2>Posts publicados</h2>
      {entries.length === 0 ? (
        <ul><li className="empty">Nenhum post publicado ainda.</li></ul>
      ) : (
        <ul>
          {pageItems.map((entry) => (
            <li key={entry.slug}>
              <span className="h-title">{entry.titulo}</span>
              <span className="h-date">{formatDateTime(entry.publicadoEm)}</span>
            </li>
          ))}
        </ul>
      )}
      {totalPages > 1 && (
        <div className="pagination" aria-label="Paginação dos posts">
          <button onClick={previous} disabled={page === 1}>Anterior</button>
          <span className="page-label">Página {page} de {totalPages}</span>
          <button onClick={next} disabled={page === totalPages}>Próxima</button>
        </div>
      )}
    </aside>
  );
}
```

- [ ] **Step 2: Manual verification**

With more than 6 published posts (or by temporarily lowering `PAGE_SIZE` locally), confirm pagination controls appear and page through correctly; confirm the empty state renders when a workspace has none.

- [ ] **Step 3: Commit**

```bash
git add web/src/views/dashboard/HistoryPanel.tsx
git commit -m "feat(web): add HistoryPanel component"
```

---

### Task 10: `RunsPanel`

**Files:**
- Create: `web/src/views/dashboard/RunsPanel.tsx`

**Interfaces:**
- Consumes: `useWorkspace`, `apiGet`, `usePagination`, `RunRecord`, `AgentId`, `nf`, `usd`, `formatDateTime`.
- Produces: `RunsPanel` component (no props).

- [ ] **Step 1: Write `web/src/views/dashboard/RunsPanel.tsx`**

```tsx
import { useEffect, useState } from "react";
import { useWorkspace } from "../../hooks/useWorkspace";
import { useToast } from "../../components/ui/Toast";
import { apiGet } from "../../lib/api";
import { usePagination } from "../../hooks/usePagination";
import { nf, usd, formatDateTime } from "../../lib/formatters";
import type { AgentId, PipelineEvent, RunRecord, RunStatus } from "../../types/api";

const PAGE_SIZE = 6;

const AGENTS: { id: AgentId; role: string; emoji: string }[] = [
  { id: "marketing-director", role: "Marketing Director", emoji: "📊" },
  { id: "pesquisa-mercado", role: "Pesquisa de mercado", emoji: "🔍" },
  { id: "pesquisa-pauta", role: "Pesquisa de pauta", emoji: "🗂️" },
  { id: "redator", role: "Redação", emoji: "✍️" },
  { id: "editor-seo", role: "Editor / SEO", emoji: "🧐" },
  { id: "publicador", role: "Publicação", emoji: "🚀" },
  { id: "instagram", role: "Instagram", emoji: "📸" },
  { id: "indexador", role: "Indexação / Google", emoji: "📈" },
];

const RUN_STATUS: Record<RunStatus, { label: string; cls: string }> = {
  publicado: { label: "Publicado", cls: "run-ok" },
  falhou: { label: "Falhou", cls: "run-err" },
  "sem-tema": { label: "Sem tema", cls: "run-neutral" },
};

function agentFinalStatus(run: RunRecord, agentId: AgentId): PipelineEvent | null {
  let last: PipelineEvent | null = null;
  for (const ev of run.eventos ?? []) if (ev.agent === agentId) last = ev;
  return last;
}

function RunItem({ run }: { run: RunRecord }) {
  const status = RUN_STATUS[run.status] ?? { label: run.status, cls: "run-neutral" };
  const quando = formatDateTime(run.finalizadoEm || run.iniciadoEm);
  const origem = run.origem === "action" ? "🤖 Action" : "🖐️ Manual";

  return (
    <li className="run-item">
      <div className="run-top">
        <span className={`run-badge ${status.cls}`}>{status.label}</span>
        <span className="run-origin">{origem}</span>
        <span className="run-when">{quando}</span>
        {run.usage && (
          <span
            className="run-cost"
            title={`${nf.format(run.usage.inputTokens)} tokens de entrada · ${nf.format(run.usage.outputTokens)} tokens de saída`}
          >
            {usd.format(run.usage.estimatedUsd)}
          </span>
        )}
        {run.slug && (
          <a href={`https://www.nextassist-app.com.br/blog/${run.slug}`} target="_blank" rel="noopener noreferrer">
            ver post ↗
          </a>
        )}
      </div>
      <div className="run-topic">{run.tema ?? "—"}</div>
      <div className="run-chips">
        {AGENTS.map((agent) => {
          const ev = agentFinalStatus(run, agent.id);
          const status = ev?.status ?? "idle";
          return (
            <span key={agent.id} className={`chip chip-${status}`} title={ev?.message ?? ""}>
              {agent.emoji} {agent.role}
            </span>
          );
        })}
      </div>
      {run.erro && <div className="run-error">⚠️ {run.erro}</div>}
    </li>
  );
}

export function RunsPanel() {
  const { workspace } = useWorkspace();
  const { showToast } = useToast();
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const { page, totalPages, pageItems, next, previous } = usePagination(runs, PAGE_SIZE);

  useEffect(() => {
    if (!workspace) return;
    const controller = new AbortController();
    apiGet<RunRecord[]>("/api/runs", workspace, controller.signal)
      .then(setRuns)
      .catch((err) => { if ((err as Error).name !== "AbortError") showToast((err as Error).message, "error"); });
    return () => controller.abort();
  }, [workspace]);

  return (
    <section className="runs-panel">
      <div className="runs-header">
        <h2>Execuções recentes</h2>
        <span>{runs.length > 0 ? `${runs.length} execução(ões) registradas` : ""}</span>
      </div>
      {runs.length === 0 ? (
        <ul><li className="empty">Nenhuma execução registrada ainda.</li></ul>
      ) : (
        <ul>{pageItems.map((run) => <RunItem key={run.id} run={run} />)}</ul>
      )}
      {totalPages > 1 && (
        <div className="pagination" aria-label="Paginação das execuções">
          <button onClick={previous} disabled={page === 1}>Anterior</button>
          <span className="page-label">Página {page} de {totalPages}</span>
          <button onClick={next} disabled={page === totalPages}>Próxima</button>
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 2: Manual verification**

Confirm run cards show status badge, origin, cost tooltip, agent chips, and error line exactly as the old page did; paginate through more than 6 runs.

- [ ] **Step 3: Commit**

```bash
git add web/src/views/dashboard/RunsPanel.tsx
git commit -m "feat(web): add RunsPanel component"
```

---

### Task 11: `UsagePanel` with test

**Files:**
- Create: `web/src/views/dashboard/UsagePanel.tsx`, `web/src/views/dashboard/UsagePanel.test.tsx`

**Interfaces:**
- Consumes: `useWorkspace`, `apiGet`, `UsageReport`, `nf`, `usd`.
- Produces: `UsagePanel` component (no props). This is "Test 5" from the spec.

- [ ] **Step 1: Write the failing test — `web/src/views/dashboard/UsagePanel.test.tsx`**

```tsx
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { WorkspaceProvider } from "../../hooks/useWorkspace";
import { UsagePanel } from "./UsagePanel";

describe("UsagePanel", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("renders formatted KPIs from the usage report", async () => {
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/workspaces")) {
        return Promise.resolve({ ok: true, json: async () => [{ id: "acme", name: "Acme" }] });
      }
      if (url.includes("/api/usage")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            trackedRuns: 3,
            month: { estimatedUsd: 12.5, inputTokens: 10000, outputTokens: 4000, webSearchRequests: 7 },
            total: { estimatedUsd: 40.2, inputTokens: 30000, outputTokens: 12000, webSearchRequests: 20 },
            averagePublishedUsd: 4.1,
          }),
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    }));

    render(<WorkspaceProvider><UsagePanel /></WorkspaceProvider>);

    await waitFor(() => expect(screen.getByText(/US\$\s*12,50/)).toBeInTheDocument());
    expect(screen.getByText("10.000")).toBeInTheDocument();
    expect(screen.getByText(/3 execução/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm --prefix web run test -- UsagePanel.test.tsx`
Expected: FAIL — `./UsagePanel` module not found.

- [ ] **Step 3: Write `web/src/views/dashboard/UsagePanel.tsx`**

```tsx
import { useEffect, useState } from "react";
import { useWorkspace } from "../../hooks/useWorkspace";
import { apiGet } from "../../lib/api";
import { nf, usd } from "../../lib/formatters";
import type { UsageReport } from "../../types/api";

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="kpi">
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
      {sub && <div className="kpi-sub">{sub}</div>}
    </div>
  );
}

export function UsagePanel() {
  const { workspace } = useWorkspace();
  const [report, setReport] = useState<UsageReport | null>(null);

  useEffect(() => {
    if (!workspace) return;
    const controller = new AbortController();
    apiGet<UsageReport>("/api/usage", workspace, controller.signal)
      .then(setReport)
      .catch((err) => { if ((err as Error).name !== "AbortError") setReport(null); });
    return () => controller.abort();
  }, [workspace]);

  return (
    <section className="usage-panel">
      <div className="usage-header">
        <div>
          <h2>Consumo de IA</h2>
          <p>Estimativa calculada pelos tokens e pesquisas registrados pelo pipeline.</p>
        </div>
        <span>
          {report && report.trackedRuns
            ? `${report.trackedRuns} execução(ões) medidas · não representa o saldo restante`
            : "Aguardando a primeira execução com medição"}
        </span>
      </div>
      {report && (
        <div className="kpi-row">
          <Kpi label="Gasto neste mês" value={usd.format(report.month.estimatedUsd)} />
          <Kpi label="Custo médio / post" value={usd.format(report.averagePublishedUsd)} />
          <Kpi label="Tokens de entrada" value={nf.format(report.month.inputTokens)} />
          <Kpi label="Tokens de saída" value={nf.format(report.month.outputTokens)} />
          <Kpi label="Pesquisas web" value={nf.format(report.month.webSearchRequests)} />
          <Kpi label="Total registrado" value={usd.format(report.total.estimatedUsd)} />
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm --prefix web run test -- UsagePanel.test.tsx`
Expected: PASS (1 test)

- [ ] **Step 5: Commit**

```bash
git add web/src/views/dashboard/UsagePanel.tsx web/src/views/dashboard/UsagePanel.test.tsx
git commit -m "feat(web): add UsagePanel component with KPI rendering test"
```

---

### Task 12: `ConversionPanel`

**Files:**
- Create: `web/src/views/dashboard/ConversionPanel.tsx`

**Interfaces:**
- Consumes: `useWorkspace`, `apiGet`, `ConversionSummary`, `nf`, `formatDateTime`.
- Produces: `ConversionPanel` component (no props).

- [ ] **Step 1: Write `web/src/views/dashboard/ConversionPanel.tsx`**

```tsx
import { useEffect, useState } from "react";
import { useWorkspace } from "../../hooks/useWorkspace";
import { apiGet } from "../../lib/api";
import { nf, formatDateTime } from "../../lib/formatters";
import type { ConversionSummary } from "../../types/api";

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="kpi">
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
    </div>
  );
}

interface AttributionRow {
  origem: string;
  views: number;
  leads: number;
  rate: number;
}

export function ConversionPanel() {
  const { workspace } = useWorkspace();
  const [data, setData] = useState<ConversionSummary | null>(null);

  useEffect(() => {
    if (!workspace) return;
    const controller = new AbortController();
    apiGet<ConversionSummary>("/api/conversions", workspace, controller.signal)
      .then(setData)
      .catch((err) => { if ((err as Error).name !== "AbortError") setData(null); });
    return () => controller.abort();
  }, [workspace]);

  if (!data) {
    return (
      <section className="usage-panel conversion-panel">
        <div className="usage-header">
          <div><h2>Conversões do blog</h2><p>Eventos enviados pelas páginas de conteúdo e demonstração.</p></div>
          <span>Aguardando dados</span>
        </div>
      </section>
    );
  }

  const campaigns = (data.byCampaign ?? []).filter((row) => row.campaign !== "(não informado)").slice(0, 5);
  const positions = (data.byContent ?? []).filter((row) => row.content !== "(não informado)").slice(0, 5);
  const rows: AttributionRow[] = [
    ...campaigns.map((row) => ({ origem: `Artigo: ${row.campaign}`, views: row.demoViews, leads: row.leads, rate: row.demoRate })),
    ...positions.map((row) => ({ origem: `Posição: ${row.content}`, views: row.demoViews, leads: row.leads, rate: row.demoRate })),
  ];

  return (
    <section className="usage-panel conversion-panel">
      <div className="usage-header">
        <div><h2>Conversões do blog</h2><p>Eventos enviados pelas páginas de conteúdo e demonstração.</p></div>
        <span>Atualizado {formatDateTime(data.updatedAt)}</span>
      </div>
      <div className="kpi-row">
        <Kpi label="Visitas à demo" value={nf.format(data.demoViews)} />
        <Kpi label="Testes iniciados" value={nf.format(data.demoSubmits)} />
        <Kpi label="Contatos enviados" value={nf.format(data.contactSubmits)} />
        <Kpi label="Cliques WhatsApp" value={nf.format(data.whatsappClicks)} />
        <Kpi label="Trials iniciados" value={nf.format(data.trials)} />
        <Kpi label="Cadastros concluídos" value={nf.format(data.signups)} />
        <Kpi label="Conversão" value={`${(data.demoRate * 100).toFixed(1)}%`} />
      </div>
      {rows.length > 0 && (
        <div className="perf-table-wrap">
          <table>
            <thead><tr><th>Origem</th><th>Visitas à demo</th><th>Leads</th><th>Conversão</th></tr></thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i}>
                  <td>{row.origem}</td>
                  <td>{nf.format(row.views)}</td>
                  <td>{nf.format(row.leads)}</td>
                  <td>{(row.rate * 100).toFixed(1)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 2: Manual verification**

Confirm the KPI row and (when there's campaign/position data) the attribution sub-table render, matching the old page.

- [ ] **Step 3: Commit**

```bash
git add web/src/views/dashboard/ConversionPanel.tsx
git commit -m "feat(web): add ConversionPanel component"
```

---

### Task 13: `AttributionPanel`

**Files:**
- Create: `web/src/views/dashboard/AttributionPanel.tsx`

**Interfaces:**
- Consumes: `useWorkspace`, `apiGet`, `AttributionResult`, `nf`.
- Produces: `AttributionPanel` component (no props).

- [ ] **Step 1: Write `web/src/views/dashboard/AttributionPanel.tsx`**

```tsx
import { useEffect, useState } from "react";
import { useWorkspace } from "../../hooks/useWorkspace";
import { apiGet } from "../../lib/api";
import { nf } from "../../lib/formatters";
import type { AttributionResult } from "../../types/api";

export function AttributionPanel() {
  const { workspace } = useWorkspace();
  const [data, setData] = useState<AttributionResult | null>(null);

  useEffect(() => {
    if (!workspace) return;
    const controller = new AbortController();
    apiGet<AttributionResult>("/api/attribution", workspace, controller.signal)
      .then(setData)
      .catch((err) => { if ((err as Error).name !== "AbortError") setData(null); });
    return () => controller.abort();
  }, [workspace]);

  const rows = [...(data?.rows ?? [])].sort((a, b) => b.customers - a.customers || b.activated - a.activated);

  return (
    <section className="usage-panel attribution-panel">
      <div className="usage-header">
        <div>
          <h2>Atribuição: conteúdo → cliente</h2>
          <p>Junta visitas, trials, ativação (1ª Ordem de Serviço) e assinatura por conteúdo. Ordenado por clientes.</p>
        </div>
        <span>{data?.unattributedEvents ? `${data.unattributedEvents} evento(s) sem conteúdo/identidade atribuível` : ""}</span>
      </div>
      {rows.length === 0 ? (
        <p className="empty">Nenhum conteúdo publicado com registro de atribuição ainda.</p>
      ) : (
        <div className="perf-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Conteúdo</th><th>Canal</th><th>Tema</th><th>Visitas</th><th>Trials</th><th>Cadastros</th>
                <th>Ativados</th><th>Clientes</th><th>Visita→Trial</th><th>Trial→Ativação</th><th>Ativação→Cliente</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.contentId}>
                  <td>{row.contentId}</td>
                  <td>{row.channel}</td>
                  <td>{row.tema}</td>
                  <td>{nf.format(row.visits)}</td>
                  <td>{nf.format(row.trials)}</td>
                  <td>{nf.format(row.signups)}</td>
                  <td>{nf.format(row.activated)}</td>
                  <td>{nf.format(row.customers)}</td>
                  <td>{row.rateReliable ? `${(row.visitToTrialRate * 100).toFixed(1)}%` : "amostra insuficiente"}</td>
                  <td>{row.rateReliable ? `${(row.trialToActivationRate * 100).toFixed(1)}%` : "amostra insuficiente"}</td>
                  <td>{row.rateReliable ? `${(row.activationToCustomerRate * 100).toFixed(1)}%` : "amostra insuficiente"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 2: Manual verification**

Confirm rows sort by customers/activated descending and the "amostra insuficiente" fallback shows for unreliable rates, matching the old table.

- [ ] **Step 3: Commit**

```bash
git add web/src/views/dashboard/AttributionPanel.tsx
git commit -m "feat(web): add AttributionPanel component"
```

---

### Task 14: `PerformancePanel`

**Files:**
- Create: `web/src/views/dashboard/PerformancePanel.tsx`

**Interfaces:**
- Consumes: `useWorkspace`, `useToast`, `apiGet`, `apiPost`, `usePagination`, `PerformanceReport`, `PostPerformance`, `nf`, `formatDateTime`.
- Produces: `PerformancePanel` component (no props).

The bar chart is plain JSX divs with an inline `width` percentage (same technique the old `renderChart` used) — no canvas/SVG, so the spec's DOM-manipulation exception doesn't end up being needed here.

- [ ] **Step 1: Write `web/src/views/dashboard/PerformancePanel.tsx`**

```tsx
import { useEffect, useState } from "react";
import { useWorkspace } from "../../hooks/useWorkspace";
import { useToast } from "../../components/ui/Toast";
import { apiGet, apiPost } from "../../lib/api";
import { usePagination } from "../../hooks/usePagination";
import { nf, formatDateTime } from "../../lib/formatters";
import type { PerformanceReport, PostPerformance } from "../../types/api";

const PAGE_SIZE = 6;

function isoDateWithOffset(offsetDays: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

function Kpi({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="kpi">
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
    </div>
  );
}

function Kpis({ posts }: { posts: PostPerformance[] }) {
  const totalClicks = posts.reduce((s, p) => s + (p.clicks || 0), 0);
  const totalImpr = posts.reduce((s, p) => s + (p.impressions || 0), 0);
  const ctr = totalImpr > 0 ? (totalClicks / totalImpr) * 100 : 0;
  const comPos = posts.filter((p) => p.position > 0 && p.impressions > 0);
  const somaImpr = comPos.reduce((s, p) => s + p.impressions, 0);
  const posMedia = somaImpr > 0 ? comPos.reduce((s, p) => s + p.position * p.impressions, 0) / somaImpr : 0;
  const indexados = posts.filter((p) => p.indexado).length;

  return (
    <div className="kpi-row">
      <Kpi label="Cliques" value={nf.format(totalClicks)} />
      <Kpi label="Impressões" value={nf.format(totalImpr)} />
      <Kpi label="CTR médio" value={`${ctr.toFixed(1)}%`} />
      <Kpi label="Posição média" value={posMedia > 0 ? posMedia.toFixed(1) : "—"} />
      <Kpi label="Indexados" value={<>{indexados}<span className="kpi-of">/{posts.length}</span></>} />
    </div>
  );
}

function Chart({ posts }: { posts: PostPerformance[] }) {
  const top = [...posts].filter((p) => p.impressions > 0).sort((a, b) => b.impressions - a.impressions).slice(0, 8);
  if (!top.length) {
    return <div className="chart-empty">Nenhuma impressão registrada no período ainda — os dados aparecem alguns dias após a publicação.</div>;
  }
  const max = top[0].impressions;
  return (
    <>
      {top.map((p) => {
        const pct = Math.max(2, (p.impressions / max) * 100);
        return (
          <div key={p.slug} className="bar-row" title={`${p.titulo} — ${nf.format(p.impressions)} impressões · ${p.clicks} cliques`}>
            <div className="bar-label"><a href={p.url} target="_blank" rel="noopener noreferrer">{p.titulo}</a></div>
            <div className="bar-track">
              <div className="bar-fill" style={{ width: `${pct}%` }}></div>
              <span className="bar-value">{nf.format(p.impressions)}</span>
            </div>
          </div>
        );
      })}
    </>
  );
}

export function PerformancePanel() {
  const { workspace } = useWorkspace();
  const { showToast } = useToast();
  const [report, setReport] = useState<PerformanceReport | null>(null);
  const [start, setStart] = useState(isoDateWithOffset(-28));
  const [end, setEnd] = useState(isoDateWithOffset(0));
  const [refreshing, setRefreshing] = useState(false);
  const { page, totalPages, pageItems, next, previous } = usePagination(report?.posts ?? [], PAGE_SIZE);

  useEffect(() => {
    if (!workspace) return;
    const controller = new AbortController();
    apiGet<PerformanceReport>("/api/performance", workspace, controller.signal)
      .then((data) => {
        setReport(data);
        if (data.posts.length) {
          setStart(data.periodo.inicio);
          setEnd(data.periodo.fim);
        }
      })
      .catch((err) => { if ((err as Error).name !== "AbortError") showToast((err as Error).message, "error"); });
    return () => controller.abort();
  }, [workspace]);

  const refresh = async () => {
    if (!start || !end) { showToast("Informe as datas de início e fim."); return; }
    if (start > end) { showToast("A data inicial não pode ser posterior à data final."); return; }
    setRefreshing(true);
    try {
      const data = await apiPost<PerformanceReport>("/api/performance/refresh", { inicio: start, fim: end, workspaceId: workspace });
      setReport(data);
      setStart(data.periodo.inicio);
      setEnd(data.periodo.fim);
      showToast("Métricas atualizadas com sucesso.", "success");
    } catch (err) {
      showToast((err as Error).message ?? "Falha ao atualizar métricas.", "error");
    } finally {
      setRefreshing(false);
    }
  };

  const today = isoDateWithOffset(0);
  const posts = report?.posts ?? [];

  return (
    <section className="performance-panel">
      <div className="perf-header">
        <h2>Desempenho no Google</h2>
        <div className="perf-meta">
          <span>{report && posts.length ? `Atualizado ${formatDateTime(report.atualizadoEm)} · período ${report.periodo.inicio} a ${report.periodo.fim} · ${posts.length} posts` : "Nunca atualizado"}</span>
          <div className="perf-period">
            <label htmlFor="perf-start">De</label>
            <input id="perf-start" type="date" value={start} max={today} onChange={(e) => setStart(e.target.value)} />
            <label htmlFor="perf-end">até</label>
            <input id="perf-end" type="date" value={end} max={today} onChange={(e) => setEnd(e.target.value)} />
          </div>
          <button onClick={() => void refresh()} disabled={refreshing}>
            {refreshing ? "⏳ Consultando o Google..." : "↻ Atualizar métricas"}
          </button>
        </div>
      </div>

      <div>{posts.length > 0 && <Kpis posts={posts} />}</div>

      <div className="perf-chart-card">
        <div className="perf-chart-title">Top posts por impressões</div>
        <div className="perf-chart">
          {posts.length > 0 ? <Chart posts={posts} /> : <div className="chart-empty">Sem dados ainda.</div>}
        </div>
      </div>

      <div className="perf-table-wrap">
        <table>
          <thead><tr><th>Post</th><th>Indexado</th><th>Cliques</th><th>Impressões</th><th>CTR</th><th>Posição</th></tr></thead>
          <tbody>
            {posts.length === 0 ? (
              <tr className="empty"><td colSpan={6}>Sem dados ainda. Clique em &quot;Atualizar métricas&quot;.</td></tr>
            ) : (
              pageItems.map((p) => (
                <tr key={p.slug}>
                  <td><a href={p.url} target="_blank" rel="noopener noreferrer">{p.titulo}</a></td>
                  <td>
                    {p.erro ? (
                      <span className="idx idx-err" title={p.erro}>erro</span>
                    ) : p.indexado ? (
                      <span className="idx idx-ok" title={p.coverageState}>sim</span>
                    ) : (
                      <span className="idx idx-no" title={p.coverageState}>não</span>
                    )}
                  </td>
                  <td>{p.clicks}</td>
                  <td>{p.impressions}</td>
                  <td>{(p.ctr * 100).toFixed(1)}%</td>
                  <td>{p.position ? p.position.toFixed(1) : "—"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {totalPages > 1 && (
        <div className="pagination" aria-label="Paginação do desempenho">
          <button onClick={previous} disabled={page === 1}>Anterior</button>
          <span className="page-label">Página {page} de {totalPages}</span>
          <button onClick={next} disabled={page === totalPages}>Próxima</button>
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 2: Manual verification**

Confirm KPIs/chart/table render for a workspace with performance data, the date inputs validate (empty/inverted range shows a toast, doesn't call the API), and "Atualizar métricas" round-trips through `/api/performance/refresh`.

- [ ] **Step 3: Commit**

```bash
git add web/src/views/dashboard/PerformancePanel.tsx
git commit -m "feat(web): add PerformancePanel component"
```

---

### Task 15: `InstagramPerformancePanel`

**Files:**
- Create: `web/src/views/dashboard/InstagramPerformancePanel.tsx`

**Interfaces:**
- Consumes: `useWorkspace`, `useToast`, `apiGet`, `apiPost`, `InstagramPerformance`, `nf`.
- Produces: `InstagramPerformancePanel` component (no props).

- [ ] **Step 1: Write `web/src/views/dashboard/InstagramPerformancePanel.tsx`**

```tsx
import { useEffect, useState } from "react";
import { useWorkspace } from "../../hooks/useWorkspace";
import { useToast } from "../../components/ui/Toast";
import { apiGet, apiPost } from "../../lib/api";
import { nf } from "../../lib/formatters";
import type { InstagramPerformance } from "../../types/api";

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="kpi">
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
    </div>
  );
}

export function InstagramPerformancePanel() {
  const { workspace } = useWorkspace();
  const { showToast } = useToast();
  const [items, setItems] = useState<InstagramPerformance[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    if (!workspace) return;
    const controller = new AbortController();
    apiGet<InstagramPerformance[]>("/api/instagram-performance", workspace, controller.signal)
      .then(setItems)
      .catch((err) => { if ((err as Error).name !== "AbortError") showToast((err as Error).message, "error"); });
    return () => controller.abort();
  }, [workspace]);

  const refresh = async () => {
    setRefreshing(true);
    try {
      const data = await apiPost<InstagramPerformance[]>("/api/instagram-performance/refresh", { workspaceId: workspace });
      setItems(data);
    } catch (err) {
      showToast((err as Error).message, "error");
    } finally {
      setRefreshing(false);
    }
  };

  const total = (key: keyof InstagramPerformance) => (items ?? []).reduce((sum, item) => sum + ((item[key] as number) || 0), 0);

  return (
    <section className="usage-panel instagram-performance-panel">
      <div className="usage-header">
        <div><h2>Desempenho no Instagram</h2><p>Insights dos Reels publicados.</p></div>
        <button onClick={() => void refresh()} disabled={refreshing}>↻ Atualizar métricas</button>
      </div>
      <div className="kpi-row">
        <Kpi label="Reproduções" value={nf.format(total("plays"))} />
        <Kpi label="Alcance" value={nf.format(total("reach"))} />
        <Kpi label="Curtidas" value={nf.format(total("likes"))} />
        <Kpi label="Comentários" value={nf.format(total("comments"))} />
        <Kpi label="Compartilhamentos" value={nf.format(total("shares"))} />
      </div>
      {items && items.length > 0 ? (
        <div className="perf-table-wrap">
          <table>
            <thead><tr><th>Reel</th><th>Reproduções</th><th>Alcance</th><th>Curtidas</th><th>Comentários</th><th>Salvos</th></tr></thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.contentId}>
                  <td>{item.tema}</td>
                  <td>{nf.format(item.plays)}</td>
                  <td>{nf.format(item.reach)}</td>
                  <td>{nf.format(item.likes)}</td>
                  <td>{nf.format(item.comments)}</td>
                  <td>{nf.format(item.saved)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="empty">Nenhum Reel medido ainda.</p>
      )}
    </section>
  );
}
```

- [ ] **Step 2: Manual verification**

Confirm KPIs and table render, and "Atualizar métricas" round-trips through `/api/instagram-performance/refresh`.

- [ ] **Step 3: Commit**

```bash
git add web/src/views/dashboard/InstagramPerformancePanel.tsx
git commit -m "feat(web): add InstagramPerformancePanel component"
```

---

### Task 16: Compose `PainelView`, remove `web/public`, final CSS pass

**Files:**
- Modify: `web/src/views/dashboard/PainelView.tsx`
- Delete: `web/public/index.html`, `web/public/app.js`, `web/public/style.css`

**Interfaces:**
- Consumes: every component from Tasks 7–15.
- Produces: the finished `PainelView`.

- [ ] **Step 1: Rewrite `web/src/views/dashboard/PainelView.tsx`**

```tsx
import { LiveStatus } from "./LiveStatus";
import { PlayerDock } from "./PlayerDock";
import { HistoryPanel } from "./HistoryPanel";
import { RunsPanel } from "./RunsPanel";
import { UsagePanel } from "./UsagePanel";
import { ConversionPanel } from "./ConversionPanel";
import { AttributionPanel } from "./AttributionPanel";
import { PerformancePanel } from "./PerformancePanel";
import { InstagramPerformancePanel } from "./InstagramPerformancePanel";

export function PainelView() {
  return (
    <>
      <section className="channel-overview" aria-label="Frentes editoriais">
        <article className="channel-card"><span className="channel-icon">📝</span><div><strong>Frente Blog</strong><p>SEO, artigo, capa, publicação e indexação.</p></div></article>
        <article className="channel-card"><span className="channel-icon">📸</span><div><strong>Frente Instagram</strong><p>Reels, bastidores, dicas rápidas e conteúdo interativo.</p></div></article>
      </section>

      <PlayerDock />
      <LiveStatus />
      <HistoryPanel />
      <RunsPanel />
      <UsagePanel />
      <ConversionPanel />
      <AttributionPanel />
      <PerformancePanel />
      <InstagramPerformancePanel />
    </>
  );
}
```

- [ ] **Step 2: Remove the old static panel**

```bash
git rm web/public/index.html web/public/app.js web/public/style.css
rmdir web/public 2>/dev/null || true
```

- [ ] **Step 3: Full manual regression pass**

```bash
npm run web:dev
```

With `npm run office` running against real (or locally seeded) workspace data, walk through every section and compare against the pre-migration screenshots/behavior:
- Switch workspace — every panel refetches, no stale-workspace flash.
- Trigger a pipeline run (or watch a live one) — desk grid updates, topic line updates, toasts fire on publish/error, "Rodar blog" disables/enables correctly.
- Paginate History, Runs, and Performance.
- Refresh Google performance metrics with a valid and an invalid date range.
- Refresh Instagram metrics.
- Confirm Conversion and Attribution tables render (or show their empty states).
- Confirm Configurações shows the placeholder.

- [ ] **Step 4: Run the full frontend test suite**

Run: `npm run test:web`
Expected: all suites PASS (api, useWorkspace, usePagination, usePipeline, UsagePanel).

- [ ] **Step 5: Commit**

```bash
git add web/src/views/dashboard/PainelView.tsx
git commit -m "feat(web): compose PainelView from ported dashboard components, remove legacy web/public"
```

---

### Task 17: Docker build pipeline and production build verification

**Files:**
- Modify: `Dockerfile`

**Interfaces:**
- Consumes: `web/package.json` (Task 1), `web/dist` (produced by `npm run build:web`).
- Produces: a `runtime` image serving `web/dist` instead of `web/public`.

- [ ] **Step 1: Update `Dockerfile`**

```diff
 FROM node:22-slim AS build

 WORKDIR /app

 COPY package.json package-lock.json ./
 RUN npm ci

 COPY tsconfig.json ./
 COPY src ./src
 RUN npm run build

+FROM node:22-slim AS build-web
+
+WORKDIR /app/web
+
+COPY web/package.json web/package-lock.json ./
+RUN npm ci
+
+COPY web/tsconfig.json web/tsconfig.node.json web/vite.config.ts web/index.html ./
+COPY web/src ./src
+RUN npm run build
+
 FROM node:22-slim AS runtime

 ENV NODE_ENV=production
 WORKDIR /app

 COPY package.json package-lock.json ./
 RUN npm ci --omit=dev && npm cache clean --force

 COPY --from=build /app/dist ./dist
-COPY web/public ./web/public
+COPY --from=build-web /app/web/dist ./web/dist
 COPY workspaces ./workspaces
```

- [ ] **Step 2: Verify the Docker build succeeds**

```bash
docker build -t nextassist-office-test .
```

Expected: build completes through all three stages without error.

- [ ] **Step 3: Verify the built image serves the panel**

```bash
docker run --rm -p 8080:8080 -e PORT=8080 nextassist-office-test
```

In another terminal: `curl -s http://localhost:8080/ | grep -o '<title>[^<]*'` should print the panel's title. Stop the container after checking (Ctrl+C).

- [ ] **Step 4: Commit**

```bash
git add Dockerfile
git commit -m "build: add web build stage to Dockerfile, serve web/dist in runtime image"
```

---

## Self-Review Notes

- **Spec coverage:** Arquitetura (Task 1, 17), Estrutura de pastas (Task 1 file structure), Componentes incl. `WorkspaceProvider`/`lib/api.ts`/`usePagination` (Tasks 2–4), cancelamento em toda requisição dependente de workspace (enforced in every panel task via `AbortController` + tested in Task 3/6), SSE cleanup (Task 6, tested), CSS port (Task 1 + Task 5 shell additions), Build/deploy (Tasks 1, 17), Testes (5 items — Task 3 covers #1, Task 4 covers #2, Task 6 covers #3 and #4, Task 11 covers #5), princípio "comportamento não implementação" (no `document.querySelector`/`innerHTML` anywhere in Tasks 5–16; the chart uses JSX/inline styles, not canvas). All spec sections have a task.
- **Placeholder scan:** no TBD/TODO; every step has runnable code or an exact shell command.
- **Type consistency:** `PipelineEvent`, `AgentId`, `AgentStatus`, `RunRecord`, `HistoryEntry`, `UsageReport`, `ConversionSummary`, `AttributionResult`, `PostPerformance`/`PerformanceReport`, `InstagramPerformance` are defined once in Task 2's `types/api.ts` and imported (never redefined) in every later task. `apiGet`/`apiPost`/`ApiError` (Task 2), `useWorkspace`/`WorkspaceProvider` (Task 3), `usePagination` (Task 4), `useToast`/`ToastProvider` (Task 5), `usePipeline`/`PipelineProvider` (Task 6) each have one definition, reused with matching signatures everywhere they're consumed.
