# Shell React/Vite com menu — Design (sub-projeto 1 de 3)

## Contexto

O painel ("Escritório") hoje é uma página única em JavaScript puro
(`web/public/index.html` + `app.js`, 636 linhas + `style.css`, 453 linhas),
servida estaticamente pelo Express (`src/server.ts`). Não há menu nem
navegação — todas as seções (status ao vivo, histórico, execuções, consumo
de IA, conversões, atribuição, performance Google/Instagram) ficam
empilhadas em uma única rolagem, com um seletor de workspace no topo.

O objetivo do produto (definido em brainstorming) é transformar o painel
num "sistema profissional" com menu, permitindo que operador configure o
ambiente de cada empresa (LLM, site/API, redes sociais). Esse objetivo
maior foi dividido em 3 sub-projetos independentes:

1. **Este documento** — shell React/Vite com menu, portando o painel atual
   1:1, sem funcionalidade nova.
2. Backend de configurações + segredos criptografados por workspace
   (fora de escopo aqui).
3. Tela de Configurações consumindo a API do item 2 (fora de escopo aqui).

Este sub-projeto entrega só a base estrutural: a troca do stack de
frontend e o item de menu que os sub-projetos 2/3 vão preencher depois.

## Fora de escopo

- Qualquer funcionalidade nova de configuração (isso é o sub-projeto 3).
  A view "Configurações" nesta etapa é um placeholder ("em breve").
- Mudança de contrato de qualquer rota `/api/*` existente — `server.ts`
  muda apenas o diretório estático servido.
- Autenticação por empresa, criação de workspace pela UI, `react-router`
  ou qualquer gerenciador de estado global (Redux/Zustand) — YAGNI para
  duas views sem necessidade de URL própria.
- Suíte de teste de frontend abrangente (cobertura ampla, snapshot
  testing, testes de todo componente visual). O escopo de teste desta
  etapa é os comportamentos críticos listados em "Testes / verificação"
  — não cada seção do painel.

## Arquitetura

`web/public/` (estático, servido direto) é substituído por um projeto
Vite + React + TypeScript em `web/` (`web/src/`, `web/index.html`,
`web/vite.config.ts`, `web/package.json` própria — build isolado do
backend). O build (`vite build`) gera `web/dist/`, e `src/server.ts` passa
a servir esse diretório:

```diff
- app.use(express.static(path.join(__dirname, "../web/public")));
+ app.use(express.static(path.join(__dirname, "../web/dist")));
```

Nenhuma outra linha de `server.ts` muda — todas as rotas `/api/*`
continuam exatamente como estão.

## Estrutura de pastas

Organização por camada, já preparada para o `react-router` que os
sub-projetos 2/3 provavelmente vão justificar (menu crescendo além de
Painel/Configurações) — sem adicionar a dependência agora:

```
web/src/
├── app/App.tsx
├── components/
│   ├── layout/ (Sidebar.tsx, Topbar.tsx)
│   └── ui/ (Toast.tsx)
├── views/
│   ├── dashboard/ (PainelView.tsx, LiveStatus.tsx, HistoryPanel.tsx, ...)
│   └── settings/ (ConfigView.tsx)
├── hooks/ (useWorkspace.ts, usePagination.ts)
├── lib/ (api.ts, formatters.ts)
├── types/ (api.ts)
├── main.tsx
└── styles.css
```

## Componentes

- `App.tsx` — view ativa (`"painel" | "config"`, `useState`, sem router).
  Workspace selecionado vive no `WorkspaceProvider` (ver abaixo), não em
  `App.tsx`.
- `Topbar` — logo + título + `<select>` de workspace (porta o
  `#workspace-select` atual, lendo/gravando via `useWorkspace()`) + os
  dois botões "Rodar blog"/"Rodar Instagram".
- `Sidebar` — dois itens de menu: "Painel" (ativo por padrão) e
  "Configurações". Clique troca a view ativa em `App.tsx`.
- `PainelView` — agrega os componentes portados 1:1 (comportamento, não
  implementação — ver seção "Princípio de migração" abaixo) do `app.js`
  atual, cada seção como seu próprio componente em `views/dashboard/`:
  - `LiveStatus` (SSE via `/api/events`, cards de agentes)
  - `PlayerDock` (avatar + relatórios rápidos)
  - `HistoryPanel` (`/api/history`, `usePagination`)
  - `RunsPanel` (`/api/runs`, `usePagination`)
  - `UsagePanel` (`/api/usage`, KPIs)
  - `ConversionPanel` (`/api/conversions`, KPIs + atribuição)
  - `AttributionPanel` (`/api/attribution`)
  - `PerformancePanel` (`/api/performance`, `/api/performance/refresh`,
    gráfico + tabela + `usePagination`)
  - `InstagramPerformancePanel` (`/api/instagram-performance`,
    `/api/instagram-performance/refresh`)
  - `Toast` (notificações, porta `#toast`)
- `ConfigView` — placeholder: título "Configurações" + texto "em breve".

### `WorkspaceProvider` (Context)

Todos os componentes acima dependem de "qual workspace está selecionado".
Em vez de passar `workspace` como prop por toda a árvore, um
`WorkspaceProvider` pequeno em `hooks/useWorkspace.ts` expõe:

```ts
type WorkspaceContextValue = {
  workspace: string | null;
  setWorkspace: (id: string) => void;
  workspaces: { id: string; name: string }[]; // de /api/workspaces
};
```

Consumido via `const { workspace } = useWorkspace()`. Não é Redux/Zustand
— só `createContext`/`useContext`, mesmo padrão de baixo custo do resto
do design.

### `lib/api.ts` (camada HTTP mínima)

Em vez de cada componente montar sua própria URL/tratar erro HTTP, um
wrapper fino sem dependência nova:

```ts
export async function apiGet<T>(path: string, workspace?: string, signal?: AbortSignal): Promise<T> {
  const url = new URL(path, window.location.origin);
  if (workspace) url.searchParams.set("workspace", workspace);
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`API ${response.status}: ${path}`);
  return response.json();
}
```

Cada componente chama `apiGet<HistoryResponse>("/api/history", workspace, signal)` —
mantém `fetch` puro, mas centraliza querystring/erro HTTP num só lugar.

### `usePagination` (hook)

`HistoryPanel`, `RunsPanel`, `PerformancePanel` e
`InstagramPerformancePanel` repetem a mesma paginação client-side sobre
dados já carregados. Isolada em `hooks/usePagination.ts`:
`const { page, next, previous, pageItems, totalPages } = usePagination(items, pageSize)`.

## Dados e comportamento

Contratos de API inalterados. Comportamentos a preservar exatamente como
hoje:
- Troca de workspace no `<select>` refaz todos os fetches dependentes de
  `?workspace=`.
- `EventSource` para `/api/events?workspace=` atualiza `LiveStatus` em
  tempo real; reconecta ao trocar de workspace.
- Botões "Rodar blog"/"Rodar Instagram" chamam `POST /api/run` e mostram
  toast de erro/sucesso.
- Paginação de histórico/execuções/performance mantém o mesmo
  comportamento (client-side, sobre os dados já carregados).

### Requisito: cancelamento em toda requisição dependente de workspace

O painel troca de workspace via `<select>` — se a empresa B responder
antes da empresa A (ordem de rede não garantida), um componente que não
cancela a requisição anterior pode acabar mostrando dados da empresa
errada depois de trocar de volta. Todo `useEffect` que busca dados
dependentes de `workspace` **deve**:

```ts
useEffect(() => {
  const controller = new AbortController();
  apiGet<T>(path, workspace, controller.signal)
    .then(setData)
    .catch((err) => { if (err.name !== "AbortError") setError(err); });
  return () => controller.abort();
}, [workspace]);
```

E o `EventSource` de `LiveStatus` fecha a conexão anterior no cleanup:

```ts
useEffect(() => {
  const events = new EventSource(`/api/events?workspace=${workspace}`);
  // ...
  return () => events.close();
}, [workspace]);
```

Isso vale para todo componente listado acima que depende de `workspace`
— não é detalhe de implementação, é requisito de correção.

CSS: `style.css` atual é portado quase integralmente (import global em
`main.tsx`), ajustando apenas seletores para acomodar a nova estrutura de
shell (sidebar + topbar + área de conteúdo). Sem redesign visual — mesma
identidade visual de "escritório".

## Build e deploy

- `web/package.json` novo: `react`, `react-dom`, `vite`,
  `@vitejs/plugin-react`, `typescript`, `@types/react`,
  `@types/react-dom`, e como `devDependencies` de teste: `vitest`,
  `@testing-library/react`, `@testing-library/jest-dom`, `jsdom`.
- Raiz `package.json`: novo script `build:web` (`npm --prefix web run
  build`); `build` passa a rodar `tsc && npm run build:web`. Novo script
  `web:dev` (`npm --prefix web run dev`) para desenvolvimento com hot
  reload — proxy do Vite dev server encaminha `/api/*` para
  `http://localhost:4173` (onde `npm run office` já roda o Express).
  Novo script `test:web` (`npm --prefix web run test`, que roda
  `vitest run`) — não substitui `npm test` (backend), é aditivo.
- `Dockerfile`: novo estágio (ou passo adicional no estágio `build`) que
  roda `npm --prefix web ci && npm --prefix web run build`; o estágio
  `runtime` copia `web/dist` em vez de `web/public`.
- `.gitignore`: adicionar `web/dist/` e `web/node_modules/` (build
  artifacts, não commitados — mesmo padrão de `dist/` na raiz).

## Testes / verificação

Nenhuma suíte de frontend existe hoje para `web/public` — mas é
justamente numa migração DOM-imperativo → React que um teste de
regressão vale mais (pega exatamente a classe de bug que o "Riscos"
abaixo descreve: comportamento sutil quebrado durante o port). Vitest +
React Testing Library (`jsdom`), cobrindo só os comportamentos críticos
listados abaixo — não cada seção do painel:

1. **Cancelamento ao trocar workspace** — troca `workspace` no
   `WorkspaceProvider` duas vezes em sequência rápida; a requisição da
   primeira troca é abortada (mock de `fetch`/`AbortController`), só o
   resultado da segunda é aplicado ao estado.
2. **`usePagination`** — navegação `next`/`previous`, `totalPages`
   correto, não ultrapassa os limites.
3. **`POST /api/run`** — clique em "Rodar blog"/"Rodar Instagram" chama
   o endpoint certo com o `workspaceId` certo e exibe toast de
   sucesso/erro conforme a resposta mockada.
4. **Reconexão do SSE** — trocar `workspace` fecha o `EventSource`
   anterior (`close()` chamado) e abre um novo apontando para a
   `?workspace=` correta.
5. **Um painel de métricas** (`UsagePanel`) — dado um payload mockado de
   `/api/usage`, os KPIs renderizados batem com os valores/formatação
   esperados.

Além disso, verificação manual via `npm run web:dev` + `npm run office`,
navegando pelo painel migrado e comparando com o comportamento atual:
trocar workspace, rodar blog/Instagram, paginar histórico e execuções,
atualizar métricas de performance/Instagram, conferir toasts de erro.
Build de produção (`npm run build` + `node dist/server.js`) verificado
servindo `web/dist` corretamente. `tests.ts` (backend) continua intacto,
já que nenhuma rota muda de contrato.

## Princípio de migração: comportamento 1:1, não implementação 1:1

"Portar 1:1" significa preservar o que o usuário vê e como o painel se
comporta — não copiar a manipulação de DOM do `app.js` para dentro de
`useEffect`. Código como `document.querySelector(...)`,
`element.innerHTML = ...` ou `classList.add(...)` dentro de um componente
React é um cheiro de que a migração não aconteceu de verdade — deve virar
JSX declarativo (`<UsagePanel totalTokens={usage.tokens} cost={usage.cost} />`),
não DOM imperativo escondido atrás de um componente. Exceção: `PerformancePanel`
pode legitimamente precisar de manipulação direta de canvas/SVG para o
gráfico de barras — nesse caso específico, documentar no próprio arquivo
por que é necessário.

## Riscos

- Port 1:1 de 636 linhas de lógica DOM-manual para componentes React é
  trabalho mecânico mas com superfície de erro (comportamento sutil de
  paginação, formatação de números/datas, debounce de refresh). Mitigado
  por verificação manual seção por seção contra o comportamento atual
  antes de considerar a migração completa, e pelo princípio acima (evita
  que a migração vire só "React por fora, `app.js` por dentro").
- Two build systems (raiz `tsc` + `web` `vite`) passam a coexistir no
  Dockerfile — precisa garantir que o cache de camadas do Docker não
  quebre (copiar `web/package*.json` antes do `COPY web/src` para cache
  de `npm ci`, mesmo padrão já usado para o backend).
- Sem cancelamento de requisição, troca rápida de workspace pode deixar
  a UI mostrando dados da empresa errada — risco mais sério aqui do que
  num painel single-tenant, dado o objetivo de produto multiempresa.
  Mitigado pelo requisito de `AbortController` acima e coberto por teste
  (item 1 de "Testes / verificação").
