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
- Testes automatizados de frontend (não existem hoje; introduzir um
  framework de teste de UI fica para quando houver lógica de frontend não
  trivial o suficiente para justificar).

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

## Componentes

- `App.tsx` — estado de topo: workspace selecionado (`useState`, carregado
  de `/api/workspaces` como hoje) e view ativa (`"painel" | "config"`,
  `useState`, sem router).
- `Topbar` — logo + título + `<select>` de workspace (porta o
  `#workspace-select` atual) + os dois botões "Rodar blog"/"Rodar
  Instagram".
- `Sidebar` — dois itens de menu: "Painel" (ativo por padrão) e
  "Configurações". Clique troca a view ativa em `App.tsx`.
- `PainelView` — agrega os componentes portados 1:1 do `app.js` atual,
  cada seção como seu próprio componente para manter os arquivos
  pequenos e testáveis isoladamente:
  - `LiveStatus` (SSE via `/api/events`, cards de agentes)
  - `PlayerDock` (avatar + relatórios rápidos)
  - `HistoryPanel` (`/api/history`, paginação)
  - `RunsPanel` (`/api/runs`, paginação)
  - `UsagePanel` (`/api/usage`, KPIs)
  - `ConversionPanel` (`/api/conversions`, KPIs + atribuição)
  - `AttributionPanel` (`/api/attribution`)
  - `PerformancePanel` (`/api/performance`, `/api/performance/refresh`,
    gráfico + tabela + paginação)
  - `InstagramPerformancePanel` (`/api/instagram-performance`,
    `/api/instagram-performance/refresh`)
  - `Toast` (notificações, porta `#toast`)
- `ConfigView` — placeholder: título "Configurações" + texto "em breve".

Cada componente busca seus próprios dados via `useEffect`/`fetch` contra
os mesmos endpoints já existentes — sem client HTTP novo, sem
cache/state-management library.

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

CSS: `style.css` atual é portado quase integralmente (import global em
`main.tsx`), ajustando apenas seletores para acomodar a nova estrutura de
shell (sidebar + topbar + área de conteúdo). Sem redesign visual — mesma
identidade visual de "escritório".

## Build e deploy

- `web/package.json` novo: `react`, `react-dom`, `vite`,
  `@vitejs/plugin-react`, `typescript`, `@types/react`,
  `@types/react-dom`.
- Raiz `package.json`: novo script `build:web` (`npm --prefix web run
  build`); `build` passa a rodar `tsc && npm run build:web`. Novo script
  `web:dev` (`npm --prefix web run dev`) para desenvolvimento com hot
  reload — proxy do Vite dev server encaminha `/api/*` para
  `http://localhost:4173` (onde `npm run office` já roda o Express).
- `Dockerfile`: novo estágio (ou passo adicional no estágio `build`) que
  roda `npm --prefix web ci && npm --prefix web run build`; o estágio
  `runtime` copia `web/dist` em vez de `web/public`.
- `.gitignore`: adicionar `web/dist/` e `web/node_modules/` (build
  artifacts, não commitados — mesmo padrão de `dist/` na raiz).

## Testes / verificação

Sem suíte de teste de frontend nova (nenhuma existe hoje para
`web/public`; a migração não introduz lógica complexa o bastante para
justificar montar um framework agora — YAGNI). `tests.ts` (backend)
continua intacto, já que nenhuma rota muda de contrato.

Verificação manual via `npm run web:dev` + `npm run office`, navegando
pelo painel migrado e comparando com o comportamento atual: trocar
workspace, rodar blog/Instagram (ou observar SSE), paginar histórico e
execuções, atualizar métricas de performance/Instagram, conferir toasts
de erro. Build de produção (`npm run build` + `node dist/server.js`)
verificado servindo `web/dist` corretamente.

## Riscos

- Port 1:1 de 636 linhas de lógica DOM-manual para componentes React é
  trabalho mecânico mas com superfície de erro (comportamento sutil de
  paginação, formatação de números/datas, debounce de refresh). Mitigado
  por verificação manual seção por seção contra o comportamento atual
  antes de considerar a migração completa.
- Two build systems (raiz `tsc` + `web` `vite`) passam a coexistir no
  Dockerfile — precisa garantir que o cache de camadas do Docker não
  quebre (copiar `web/package*.json` antes do `COPY web/src` para cache
  de `npm ci`, mesmo padrão já usado para o backend).
