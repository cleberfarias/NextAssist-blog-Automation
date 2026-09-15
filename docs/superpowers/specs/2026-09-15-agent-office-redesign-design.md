# Agent Office — Redesign do painel — Design

## Contexto

O painel hoje (pós [2026-09-01-react-panel-shell-design.md](2026-09-01-react-panel-shell-design.md))
é um shell React/Vite com duas views (`Sidebar` com "Painel"/"Configurações",
`useState` sem router) e uma única página (`PainelView`) que empilha todos os
painéis em rolagem vertical: `LiveStatus`, `PlayerDock`, `RevenuePanel`,
`ReelApprovalPanel`, `SalesPanel`, `HistoryPanel`, `RunsPanel`, `UsagePanel`,
`ConversionPanel`, `AttributionPanel`, `PerformancePanel`,
`InstagramPerformancePanel`. Tema claro, CSS hardcoded sem tokens
(`web/src/styles.css`, 468 linhas).

O objetivo é evoluir para uma navegação em 9 seções ("Agent Office": Dashboard,
Agentes (IA), Conteúdo, Reels, Blog, Leads, Clientes, Relatórios,
Configurações), tema escuro, com uma página de Agentes que resume o status de
cada agente (Social, Analytics, Sales, Finance, Revenue) e permite drill-down
— em particular um detalhe de Reel com timeline de geração e galeria de
B-roll, alinhado ao trabalho recente de HeyGen Studio multi-cena
(`src/reels/studioScenes.ts`, `src/reels/generator.ts`).

Esse documento cobre o redesign completo, dividido em 3 fases sequenciais
dentro do mesmo plano (não sub-projetos separados, por decisão do usuário):

1. **Fase 1 — Backend**: persistir `scenes`/`timelineSteps` no `ReelRecord` e
   criar `GET /api/reels/:id`.
2. **Fase 2 — Casca do frontend**: Tailwind, tema escuro, `react-router`,
   estrutura de rotas.
3. **Fase 3 — Páginas**: construir as 9 páginas, migrando os painéis
   existentes (comportamento 1:1) e as duas telas novas (Agentes, Reel
   detail).

## Fora de escopo

- Autenticação/RBAC por página — o painel já tem autenticação própria
  (fora deste redesign).
- Configurações (`/configuracoes`) — continua o placeholder do sub-projeto 1;
  os sub-projetos 2/3 daquele spec (segredos criptografados por workspace)
  seguem não implementados e não fazem parte deste documento.
- Endpoint de saldo/quota da HeyGen para o card "Finance Agent" — **gap
  identificado, não resolvido aqui**. `src/harness/heygenApi.ts` não chama
  hoje nenhum endpoint de quota; antes de implementar o card com número real
  de créditos, é preciso verificar a documentação oficial da HeyGen (não
  supor o formato do endpoint). Até essa verificação acontecer, o card
  Finance Agent mostra só custo de IA (`UsagePanel`), sem a parte de créditos
  HeyGen.
- Ações de escrita novas para Sales/Revenue na aba "Ações" do drill-down de
  agente — hoje só o Reel tem ações reais (aprovar/rejeitar/publicar). A aba
  "Ações" para os demais agentes fica somente leitura nesta rodada.
- Multi-tenant visual (branding por workspace na sidebar) — a marca
  "NextAssist" na topbar continua vindo do `WorkspaceProvider` já existente,
  sem trabalho novo de customização por cliente.

## Fase 1 — Backend

### `ReelRecord`: campos novos

Em `src/reels/state.ts`, dois campos opcionais adicionados a `ReelRecord`
(retrocompatíveis — reels antigos simplesmente não os têm):

```ts
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
  assetId?: string;   // presente só em cenas de B-roll
  thumbnailUrl?: string;
}

export interface ReelRecord {
  // ...campos existentes...
  scenes?: SceneSummary[];
  timelineSteps?: TimelineStep[];
}
```

`generator.ts` já monta as `scenes` via `buildStudioScenes()` antes de enviar
pro HeyGen — hoje esse valor é descartado após o envio. A mudança é persistir
esse mesmo array (mapeado para `SceneSummary`) junto do `ReelRecord` no
momento da criação, sem alterar a lógica de composição das cenas.

`timelineSteps` é populado incrementalmente pelos três pontos que já fazem
transição de estado — cada um adiciona seu próprio step, sem lógica nova de
orquestração:

- `generator.ts` (criação): `roteiro_gerado`, `cenas_montadas`,
  `enviado_heygen`.
- `reconciler.ts` (polling): `processando` (enquanto `rendering`),
  `video_concluido` (ao virar `pending_approval`).
- `publisher.ts` / rota de aprovação: `aguardando_aprovacao` já é implícito
  na transição existente; `publicado` quando `status` vira `published`.

### Novo endpoint: `GET /api/reels/:id`

Retorna o `ReelRecord` completo (incluindo `scenes`/`timelineSteps`) para um
workspace+id. `GET /api/reels` (listagem) **não muda de contrato** — continua
sem esses campos, mantendo o payload leve para o painel geral. Só a tela de
detalhe (Fase 3) busca via este novo endpoint, sob demanda.

### Leads / Clientes / Relatórios / Blog / Conteúdo — sem mudança de backend

- **Leads/Clientes**: `SalesPipelineEntry.assessment.intent` já inclui o
  valor `"customer"` (`src/sales/types.ts`). "Clientes" é um filtro sobre o
  `/api/sales` existente; "Leads" é a mesma lista sem filtro.
- **Relatórios**: reorganização de `/api/performance`, `/api/usage`,
  `/api/attribution` já existentes numa página só.
- **Blog**: reorganização de `/api/history` (posts publicados) numa página
  própria.
- **Conteúdo**: nova leitura de `content-calendar.json` (pautas planejadas,
  ainda não publicadas) — distinto de Blog (já publicado). Não existe rota
  hoje para isso (`src/server.ts` não tem nenhuma rota `content-calendar`) —
  a Fase 1 adiciona `GET /api/content-calendar?workspace=`, leitura simples
  do JSON já existente, seguindo o padrão de `dataSource.ts`.

## Fase 2 — Casca do frontend

### Tailwind

Adiciona `tailwindcss`, `postcss`, `autoprefixer` a `web/`. `tailwind.config.ts`
define os tokens do tema escuro:

```ts
colors: {
  bg: "#0d1220",        // fundo da página
  surface: "#141b2e",   // cards
  border: "#1f2940",
  text: { primary: "#e7ebf5", secondary: "#8992a5" },
  accent: "#7b61ff",     // badges/destaques (mesmo roxo do player-avatar atual)
  status: { ok: "#34b56b", warn: "#ffb020", error: "#e5484d" },
}
```

`web/src/styles.css` deixa de crescer — permanece só para o que não vira
utility class limpa (ex.: gráfico SVG do `PerformancePanel`, que já é exceção
documentada no spec anterior). Migração de página existente para Tailwind
acontece junto da migração de cada página na Fase 3, não como um passo de
"reformatar tudo" à parte.

### Ícones

Sem dependência nova — mantém o padrão de emoji já usado hoje (📝📸💼🔍📈 nos
cards atuais) para os 9 itens da sidebar.

### Roteamento

Adiciona `react-router-dom`. `App.tsx` troca o `useState<View>` por
`<BrowserRouter>` com as rotas abaixo. `WorkspaceProvider`, `ToastProvider`,
`PipelineProvider` continuam envolvendo o router — workspace selecionado
continua fora da URL (mesmo comportamento atual de trocar workspace sem
navegar).

```
/                 → Dashboard (KPIs + banner de prioridades do Revenue Director)
/agentes          → cards dos 5 agentes
/agentes/:agentId → drill-down (abas: Visão geral / Detalhes técnicos / Histórico / Ações)
/conteudo         → backlog do content-calendar.json
/reels            → ReelApprovalPanel promovido a página
/reels/:id        → detalhe (timeline + B-roll), via GET /api/reels/:id
/blog             → posts publicados (/api/history)
/leads            → SalesPanel, sem filtro
/clientes         → SalesPanel, filtro intent === "customer"
/relatorios       → Performance + Usage + Attribution consolidados
/configuracoes    → ConfigView (placeholder, sem mudança)
```

A sidebar/rota antiga (`painel`/`config`) é substituída de uma vez ao final
da Fase 3 — não coexiste atrás de feature flag, para não manter dois shells
em paralelo durante o desenvolvimento.

### Requisito herdado: cancelamento de fetch por workspace

Toda página nova que busca dados dependentes de `?workspace=` **deve** seguir
o mesmo padrão de `AbortController` já exigido no spec anterior (seção
"Requisito: cancelamento em toda requisição dependente de workspace") — troca
de workspace não pode deixar uma página nova mostrando dado da empresa
errada. Isso vale em especial para `/agentes/:agentId` e `/reels/:id`, que
disparam fetch adicional ao montar.

## Fase 3 — Páginas

| Página | Fonte de dados | Componente(s) reaproveitado(s) |
|---|---|---|
| Dashboard (`/`) | `RevenuePanel` | Reestilizado como banner de prioridades + resumo condensado |
| Agentes (`/agentes`) | 5 cards | Social→dado de Reels/Instagram; Analytics→Performance+Usage+InstagramPerformance; Sales→SalesPanel; Finance→UsagePanel (sem créditos HeyGen, ver "Fora de escopo"); Revenue→RevenuePanel |
| `/agentes/:id` | Visão geral = card resumido; Histórico = `RunsPanel` filtrado; Detalhes técnicos = payload bruto do último run; Ações = somente leitura (exceto Reel) | |
| Reels (`/reels`, `/reels/:id`) | `ReelApprovalPanel` + `GET /api/reels/:id` (Fase 1) | Único drill-down com dado genuinamente novo (scenes/timeline) |
| Conteúdo (`/conteudo`) | `content-calendar.json` | Página nova |
| Blog (`/blog`) | `/api/history` | Reuso direto |
| Leads (`/leads`) | `/api/sales` | `SalesPanel` reaproveitado |
| Clientes (`/clientes`) | `/api/sales`, filtro `customer` | `SalesPanel` reaproveitado, filtrado |
| Relatórios (`/relatorios`) | `/api/performance` + `/api/usage` + `/api/attribution` | `PerformancePanel` + `UsagePanel` + `AttributionPanel` |
| Configurações | — | `ConfigView` inalterado |

### Princípio de migração (herdado do spec anterior)

"Comportamento 1:1, não implementação 1:1" — ao mover um painel existente
para uma página nova, preservar o que o usuário vê e como se comporta, não
reimplementar do zero. Manipulação de DOM imperativo dentro de um componente
React continua sendo sinal de migração malfeita, com a mesma exceção já
documentada para o gráfico SVG do `PerformancePanel`.

## Testes

- **Backend**: testes novos seguindo o padrão de `generator.test.ts` /
  `studioScenes.test.ts` — `scenes`/`timelineSteps` populados corretamente em
  cada transição; `GET /api/reels/:id` (200 com payload completo, 404 para id
  inexistente).
- **Frontend**: Vitest + Testing Library (já configurado). Cada página nova
  ganha um teste de render básico; rotas testadas com `MemoryRouter`. Reforça
  o item 1 do spec anterior (cancelamento de fetch) para `/agentes/:id` e
  `/reels/:id`, que são as duas rotas com fetch adicional ao montar.
- **Verificação manual**: `npm run web:dev` + `npm run office`, navegando
  pelas 9 páginas, comparando dado exibido com o painel atual (paridade),
  abrindo um Reel real para conferir timeline/B-roll, e forçando erro de
  fetch (offline) para confirmar que o card Finance Agent degrada para
  "indisponível" em vez de quebrar a página.

## Erros e estados vazios

Todas as páginas novas reaproveitam o padrão "Aguardando dados" já existente
para estado vazio/carregando, e erros de fetch aparecem via `ToastProvider`
(já existente) — nenhum padrão novo de UI de erro introduzido.

## Riscos

- **Persistência de `scenes`/`timelineSteps` em 3 arquivos diferentes**
  (`generator.ts`, `reconciler.ts`, `publisher.ts`) pode divergir se um dos
  três não escrever o step esperado — mitigado por teste cobrindo a sequência
  completa de transições de um Reel (queued→rendering→pending_approval→
  approved→published) e checando `timelineSteps` ao final.
- **Migração de 12 componentes existentes para páginas novas** repete o
  risco já documentado no spec anterior (comportamento sutil quebrado
  durante o port) — mesma mitigação: verificação manual página por página
  contra o comportamento atual antes de considerar a fase completa.
- **Gap do Finance Agent** (créditos HeyGen) pode gerar expectativa errada se
  o card for lançado sem deixar claro que é só custo de IA — mitigado
  deixando o rótulo do card explícito ("Custo de IA — créditos HeyGen em
  breve") até a Fase de verificação da API da HeyGen acontecer.
