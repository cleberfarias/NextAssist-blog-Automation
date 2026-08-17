# Fase 1 — Fundação Multi-workspace

**Data:** 2026-08-17
**Origem:** `MARKETING_AI_OFFICE_ARCHITECTURE.md`, item 1 ("Multi-workspace") — primeira fase da
ordem de implementação recomendada (Multi-workspace → Marketing Director → Memória → ...).

## Objetivo

Remover o hardcode do NextAssist do núcleo da aplicação e introduzir a entidade `Workspace`,
de forma genérica para N clientes (não apenas NextAssist + 1 piloto). Ao final desta fase, o
pipeline, a persistência e o painel operam sobre um `workspaceId` explícito, e nenhum agente ou
lib depende de configuração global específica de um cliente. Fases futuras (Marketing Director,
memória, backlog automático, LinkedIn, etc.) constroem em cima desta base.

**Fora de escopo desta fase:** Marketing Director agent, memória (brand/operational/learning),
geração automática de backlog, LinkedIn, Secret Manager real (só a abstração), múltiplos
providers de CMS além do NextAssist, onboarding self-service, billing.

## Arquitetura

### Modelo de execução

Duas formas de execução coexistem no projeto hoje, e cada uma resolve o workspace de um jeito
diferente:

- **Pipeline (processo curto)** — `tsx src/index.ts`, disparado pela GitHub Action (cron ou
  `workflow_dispatch`). Resolve **um** workspace no início do processo e passa esse contexto
  adiante explicitamente. Sem singletons globais mutáveis.
- **Painel (processo longo)** — `src/server.ts`. Serve múltiplos workspaces ao mesmo tempo;
  resolve o workspace **por request** (query param), sem instanciar nada pesado até precisar.

Isso não muda o modelo operacional atual: o botão "Rodar pipeline agora" do painel hospedado já
dispara a Action via `workflow_dispatch` em vez de rodar a pipeline in-process — esse fluxo
continua igual, só ganha um `workspace_id` como input.

### Regra de fronteira

> Nenhum agente ou lib (`src/agents/*.ts`, `src/lib/*.ts`) importa `config.ts` diretamente
> depois desta fase.

Fluxo obrigatório:

```
entrypoint (index.ts / server.ts route)
        ↓
loadWorkspace(workspaceId)
        ↓
resolveSecrets(workspace, secretProvider)
        ↓
buildWorkspaceContext(...)
        ↓
runPipeline(ctx)  /  route handler(ctx)
        ↓
agents(ctx, ...)
```

`config.ts` deixa de ser "dono das configurações de cliente" e vira só configuração de
aplicação: `PORT`, `DATA_SOURCE`, `GITHUB_REPO`, `GITHUB_BRANCH`, `NODE_ENV` e afins — nada que
varie por cliente.

## Componentes

### 1. `Workspace` e onde mora

```
workspaces/
  nextassist/
    workspace.json
    content-calendar.json
    post-history.json
    runs-history.json
    post-performance.json
```

`workspace.json`:

```ts
interface MarketingWorkspace {
  id: string;
  name: string;
  active: boolean; // usado pela Action para montar a matrix

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
    cms: {
      provider: "nextassist"; // futuro: "wordpress" | "webflow" | "hubspot" | ...
      apiUrl: string;
    };
    searchConsole?: { siteUrl: string; sitemapUrl: string };
    instagram?: { userId: string; apiVersion: string }; // sem token — vem do SecretProvider
  };

  autonomy: {
    mode: "copilot" | "semi-autonomous" | "autonomous";
  };

  secrets: {
    required: string[]; // ex: ["OPENAI_API_KEY", "FIREBASE_SERVICE_ACCOUNT_JSON"]
    optional?: string[]; // ex: ["ANTHROPIC_API_KEY", "IG_ACCESS_TOKEN", "GEMINI_API_KEY"]
  };
}
```

`secrets` declara **nomes** de segredos necessários, nunca valores — usado para validar um
workspace mal configurado antes de rodar (erro claro em vez de falha tardia no meio do
pipeline).

Novo módulo `src/workspace.ts`:

- `loadWorkspace(id: string): Promise<MarketingWorkspace>`
- `listWorkspaces(): Promise<MarketingWorkspace[]>` — varre `workspaces/*/workspace.json`.

Sem criar `src/core/`, `src/skills/`, `src/memory/` etc. ainda — esses diretórios do documento
de arquitetura pertencem a fases futuras (YAGNI para esta fase).

### 2. `SecretProvider`

```ts
interface SecretProvider {
  get(workspaceId: string, key: string): Promise<string | undefined>;
}
```

Implementação inicial, `src/lib/secrets.ts`: `EnvSecretProvider` — resolve
`${WORKSPACE_ID_UPPERCASE}_${KEY}` (ex: `NEXTASSIST_ANTHROPIC_API_KEY`), com fallback para `KEY`
sem prefixo (compat de transição em ambientes com um único workspace configurado, como o `.env`
local hoje). Trocar por Secret Manager (GCP) no futuro é só uma nova implementação da mesma
interface — nada além do provider muda.

### 3. `WorkspaceContext` — contrato central passado aos agentes

```ts
interface WorkspaceContext {
  workspace: MarketingWorkspace;
  secrets: SecretProvider;

  ai: {
    openai?: OpenAI;
    anthropic?: Anthropic;
  };

  usage: UsageTracker; // substitui o `currentUsage` module-level de anthropic.ts

  paths: {
    root: string; // workspaces/<id>
    calendar: string;
    history: string;
    runs: string;
    performance: string;
  };

  cms: CmsProvider;
}
```

Montado uma vez por execução (`buildWorkspaceContext(workspace, secretProvider)`), passado
explicitamente por todo o pipeline:

```ts
researchMarket(ctx, tema)
planTopic(ctx, ...)
writeArticle(ctx, ...)
editAndFinalize(ctx, ...)
publishPost(ctx, ...)
publishToInstagram(ctx, ...)
indexPublishedPost(ctx, ...)
```

`runPipeline(workspaceId: string)` passa a ser:

```ts
export async function runPipeline(workspaceId: string, onEvent?: OnEvent): Promise<PipelineResult | null> {
  const workspace = await loadWorkspace(workspaceId);
  const ctx = await buildWorkspaceContext(workspace, secretProvider);
  // ...resto igual, usando ctx em vez de config/imports globais
}
```

`anthropic.ts`'s `runAgent()` deixa de instanciar clientes no import do módulo — recebe
`ctx.ai` e escreve em `ctx.usage` em vez de um singleton global. Isso elimina o risco de vazar
uso/custo de IA entre workspaces caso duas execuções um dia rodem no mesmo processo.

### 4. `dataSource.ts` — persistência por workspace

`readCalendar(ctx)`, `appendHistory(ctx, entry)`, `appendRun(ctx, run)`, etc. resolvem o caminho
via `ctx.paths.*` em vez de constantes globais (`CALENDAR_PATH`, `HISTORY_PATH`, `RUNS_PATH`).
Modo `"github"` do `dataSource` (painel hospedado, lê raw files do repo) monta o mesmo caminho
`workspaces/<id>/<arquivo>.json` ao buscar no GitHub.

### 5. CMS — abstração mínima

```ts
interface CmsProvider {
  createPost(input: CreatePostInput): Promise<PostResult>;
}
```

Uma implementação nesta fase: `NextAssistCmsProvider` (o fetch que hoje está em
`publisher.ts`), parametrizada por `workspace.integrations.cms.apiUrl`. `siteUrl` e
`cms.apiUrl` são conceitos distintos (site público vs. API de publicação) e ficam em campos
separados no `workspace.json`. Sem implementar WordPress/Webflow/Ghost/HubSpot agora — só a
interface e o provider atual, prontos para novas implementações no futuro.

### 6. GitHub Action

`daily-post.yml` vira 2 jobs:

- `list-workspaces`: lê `workspaces/*/workspace.json`, filtra `active: true`, expõe a lista
  como JSON (`outputs.workspaces`) para a matrix do job seguinte.
- `publish`: `strategy.matrix.workspace: ${{ fromJson(needs.list-workspaces.outputs.workspaces) }}`.
  - `concurrency.group: daily-post-${{ matrix.workspace }}` — **cada workspace tem seu próprio
    lock**. O lock único atual (`group: daily-post`) serializaria/pularia execuções entre
    workspaces diferentes, o que seria um bug introduzido por esta fase se não corrigido.
  - `environment: ${{ matrix.workspace }}` — usa GitHub Environments (um por workspace) para
    os segredos (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, etc., mesmo nome em cada Environment).
    É um recurso nativo do GitHub Actions — evita reinventar convenção de nome prefixado dentro
    do YAML. (Fora da Action, `EnvSecretProvider` com prefixo por workspace continua valendo
    para dev local / Cloud Run.)
  - Passo de commit: `git add workspaces/${{ matrix.workspace }}/*.json` em vez dos 4 arquivos
    da raiz.
- `workflow_dispatch` ganha `inputs.workspace_id` (opcional — sem ele, roda a matrix inteira;
  com ele, roda só aquele workspace). Usado pelo botão manual do painel.

### 7. Painel (`server.ts` + `app.js`)

Todo o estado hoje é module-level global (`running`, `lastEvents`, `clients`, `dispatching`,
`refreshingPerf`) — vira `Map<workspaceId, WorkspaceRuntimeState>`, uma entrada por workspace
ativo, criada sob demanda.

- Novo `GET /api/workspaces` — lista `{id, name}` de todos os workspaces (via
  `listWorkspaces()`), alimenta um seletor no `app.js`.
- `/api/events` (SSE), `/api/status`, `/api/history`, `/api/runs`, `/api/usage`,
  `/api/performance` passam a exigir `?workspace=<id>`.
- `/api/events/ingest` (usado pela Action para empurrar eventos ao painel hospedado em tempo
  real) ganha um campo `workspaceId` no payload; `broadcast()` só distribui para o
  `Set<clients>` daquele workspace.
- `/api/run` recebe `{workspaceId}` no corpo. No modo `dispatch`, isso vira o input
  `workspace_id` do `workflow_dispatch` (`triggerDailyPostWorkflow(workspaceId)`).
- `app.js`: seletor de workspace (dropdown), guarda a seleção na URL (`?workspace=`) e inclui
  o parâmetro em todos os fetches; troca de workspace reabre a conexão SSE.

## Migração do NextAssist

- `git mv content-calendar.json post-history.json runs-history.json post-performance.json` para
  `workspaces/nextassist/` — preserva histórico do arquivo.
- Novo `workspaces/nextassist/workspace.json`, escrito a partir do que hoje está hardcoded em
  `config.ts` e nos system prompts dos agentes (marca, tom de voz, concorrentes citados em
  `marketResearch.ts`, `blogApiUrl` → `integrations.cms.apiUrl`, `siteBaseUrl` →
  `integrations.siteUrl`, `searchConsoleSiteUrl`/`sitemapUrl` → `integrations.searchConsole`,
  `instagram.userId`/`apiVersion` → `integrations.instagram`).
- `.env` local: variáveis de segredo continuam com o mesmo nome (sem prefixo) — o fallback do
  `EnvSecretProvider` cobre isso enquanto só existe um workspace configurado localmente.
- GitHub: criar o Environment `nextassist` e migrar os secrets do repo (hoje soltos em
  `secrets.*`) para dentro desse Environment.

## Testes

- `npm test` continua verde — os testes existentes (`contentQuality.test.ts`,
  `editorSeo.test.ts`, `providerFallback.test.ts`, `conversions.test.ts`) são adaptados para
  construir um `WorkspaceContext` de teste em vez de depender do `config` global.
- Novo teste para `EnvSecretProvider` (resolução com e sem prefixo).
- Novo teste para `loadWorkspace`/`listWorkspaces` (parse de `workspace.json`, erro claro se
  `secrets.required` não estiver satisfeito).
- Smoke test manual: `npm run run` com `WORKSPACE_ID=nextassist` publica exatamente como hoje;
  `npm run office`, selecionar "nextassist" no painel, disparar execução manual, confirmar SSE
  e histórico aparecem filtrados por workspace.

## Erros e casos de borda

- Workspace inexistente (`loadWorkspace` de um id sem pasta) → erro claro antes de qualquer
  chamada de IA ou publicação.
- Segredo obrigatório ausente (`secrets.required`) → erro claro na montagem do
  `WorkspaceContext`, antes do pipeline começar (falha rápida, não no meio da redação).
- Segredo opcional ausente (ex: Instagram) → comportamento atual é preservado: passo
  correspondente é pulado com `status: "done"` e mensagem explicativa, pipeline continua.
- Dois workspaces publicando ao mesmo tempo → isolados por `concurrency.group` por workspace na
  Action, e por entrada própria no `Map<workspaceId, WorkspaceRuntimeState>` no painel.
