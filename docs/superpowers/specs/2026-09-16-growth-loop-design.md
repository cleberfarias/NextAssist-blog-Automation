# Loop de Crescimento — Revenue Director aciona Marketing e Sales

> Spec capturada em 2026-09-16, a partir de pedido do usuário: "refinar o
> motor, os agentes devem conversar um com o outro, trazer eficiência para a
> operação, ser especialistas melhores do mercado." Depois de refinar a parte
> visual do painel, este spec cobre o motor: como os agentes do Harness
> passam a se coordenar de verdade.

## Contexto

O Harness (`src/harness/*`) já tem Revenue Director, Marketing Director e
Sales Agent rodando cada um isolado, com budget, aprovação humana e tracing
(ver `docs/AGENT_HARNESS_P0.md`). O problema: **o Revenue Director
diagnostica o gargalo do funil e essa decisão morre num dashboard.**

- `runRevenueDirector` roda a cada `GET /api/revenue` (dashboard) e devolve
  um `RevenueDecision` (`bottleneck`, `action`, `reason`, `evidence`,
  `requiresHumanApproval`) — mas a skill que o gera é explícita: "recomenda a
  próxima ação de receita **sem executar efeitos externos**"
  (`src/harness/skills/revenueDirectorSkills.ts`).
- Marketing Director só gera pauta quando `content-calendar.json` fica abaixo
  de `minimumPendingTopics` (`src/backlog.ts`) — nunca sabe que o gargalo real
  apontado pelo Revenue Director é outro (ex: CTA fraco, não volume).
- Sales Agent (`runWorkspaceSalesCopilot`, `src/sales/pipeline.ts`) hoje **não
  é chamado de lugar nenhum em produção** — nem workflow agendado nem rota do
  servidor o aciona. Só existe testado, isolado.
- As personas dos agentes (`SYSTEM_TEMPLATE` em `lib/marketingDirector.ts`,
  system prompt em `skills/salesOutreachSkills.ts`) são só "Você é o cargo X"
  + regras de negócio — sem framing de especialista.

Isso já era o próximo passo documentado em `docs/AGENT_HARNESS_P0.md`
("5. Adicionar Revenue Director acima de Marketing + Sales") — este spec
fecha esse elo.

## Objetivo

1. A saída do Revenue Director passa a ser **input real** do próximo agente
   — não só dado pra humano ler. Isso é a "conversa entre agentes".
2. O trabalho é **preparado automaticamente** (gerar pauta, redigir
   abordagem); envio/publicação continuam exigindo aprovação humana, como já
   é hoje (`requiresHumanApproval`, `autonomy.mode === "copilot"` em
   `publisher.ts`). Nenhuma skill de envio é tocada por este spec.
3. Marketing Director e Sales Agent ganham personas de especialista de
   mercado de verdade, não só o rótulo do cargo.
4. Roda 1x/dia via GitHub Actions, mesmo padrão de `daily-post.yml` /
   `reconcile-reels.yml` — sem nenhuma chamada de IA nova por carregamento de
   dashboard.

## Fluxo

```text
growth-loop.yml (cron 1x/dia, por workspace ativo)
        ↓
runGrowthLoop(ctx)
        ↓
runRevenueDirector(ctx) — decisão determinística, como já é hoje
        ↓
routeDecision(decision) — bottleneck/action → agente dono
        ↓
   ┌────────────┬──────────────┬───────────────┐
   ↓            ↓              ↓                ↓
Marketing    Sales Agent    (sem dono:       (sem gargalo:
Director     prioriza/      activation)      do_nothing)
gera pauta   redige         → só registra    → só registra
direcionada  abordagem
   ↓            ↓
content-     sales-state.json
calendar     (rascunho pendente
.json        de aprovação humana)
   └────────────┴──────────────┴────────────────┘
                    ↓
        growth-loop-state.json (o que rodou, por quê, resultado)
                    ↓
        GET /api/revenue devolve o último resultado (leitura, sem custo de IA)
```

## Tabela de roteamento

Usa exatamente as ações que `decideRevenueAction` já produz
(`src/revenue/director.ts`) — nenhuma mudança na lógica de decisão, que
continua determinística e auditável.

| `bottleneck` | `action` | dono | o que faz |
|---|---|---|---|
| `traffic` | `create_content` | Marketing Director | gera pauta nova (skill existente) |
| `trial_conversion` | `improve_cta` | Marketing Director | gera pauta nova, prompt direcionado a reforçar CTA de trial |
| `sales_followup` | `prioritize_hot_leads` | Sales Agent | roda scoring + rascunho de abordagem pros leads quentes represados |
| `sales_conversion` | `improve_sales_conversion` | Sales Agent | idem, com framing de urgência de fechamento |
| `activation` | `improve_activation` | — | sem agente dono hoje; só registra (ver Fora de escopo) |
| `none` | `do_nothing` | — | loop não age, registra "sem ação necessária" |

## Mudanças por componente

### 1. `src/backlog.ts` — extrair a geração reutilizável

Hoje `ensureContentBacklog` mistura "decidir se preciso gerar" (gargalo de
volume) com "gerar → validar → persistir". O Revenue Director aciona
Marketing Director por um motivo **diferente** (gargalo diagnosticado, não
calendário vazio) — não deve passar pelo mesmo gate de
`minimumPendingTopics`, senão o loop vira no-op sempre que o calendário já
estiver cheio, mesmo com tráfego caindo.

Extrai o corpo (gerar → validar → persistir) para uma função nova,
independente do gate:

```ts
export interface ReplenishContentBacklogOptions {
  count: number;
  /** Texto livre do Revenue Director injetado no prompt do Marketing Director. */
  steering?: string;
  generate?: (ctx: WorkspaceContext, options: GenerateContentBacklogOptions) => Promise<ContentOpportunity[]>;
}

/** Gera, valida e persiste novas pautas — sem decidir SE deve gerar. Quem chama decide o motivo (calendário baixo ou gargalo do Revenue Director) e o `count`. */
export async function replenishContentBacklog(
  ctx: WorkspaceContext,
  options: ReplenishContentBacklogOptions,
  onEvent?: OnEvent,
): Promise<BacklogResult> { /* corpo atual de ensureContentBacklog, sem o if de threshold */ }
```

`ensureContentBacklog` passa a só decidir o gate (`pendingBefore >=
minimumPendingTopics` → `skipped: true`) e, se abaixo, chama
`replenishContentBacklog(ctx, { count: strategy.replenishAmount }, onEvent)`.
Comportamento observável de `ensureContentBacklog` não muda.

### 2. `src/lib/marketingDirector.ts` — steering + persona

`GenerateContentBacklogOptions` ganha `steering?: string`. `buildPrompt`
inclui, quando presente:

```text
Direcionamento prioritário desta rodada (Revenue Director): ${steering}
Todas as pautas geradas devem atacar diretamente esse gargalo — não gere
pautas genéricas de reforço de marca enquanto esse direcionamento estiver
ativo.
```

`SYSTEM_TEMPLATE` ganha framing de especialista (mantém 100% das 5 regras de
priorização existentes — essas já são boas e auditáveis, não mexer):

```text
Você atua como um Head of Content/Growth de mercado: mais de uma década
lançando estratégias de conteúdo B2B SaaS que geram pipeline comercial
mensurável, não apenas tráfego. Você pensa em clusters temáticos e
autoridade de tópico (não posts isolados), em intenção de busca por estágio
de funil, e nunca aprova uma pauta sem conseguir explicar, em uma frase, que
resultado de negócio ela deve mover.
```

E, antes do "Responda SOMENTE com um array JSON", um checklist de qualidade:

```text
Antes de responder, audite cada pauta: (1) ela ataca um gargalo real, não
uma hipótese? (2) o público-alvo reconheceria a dor descrita? (3) ela não
compete por atenção com um cluster já publicado? Descarte qualquer ideia que
falhe nesse teste em vez de incluí-la.
```

### 3. `src/sales/pipeline.ts` — steering + correção de desperdício

`runWorkspaceSalesCopilot` ganha `steering?: string`. Além disso, corrige um
desperdício real: hoje, se rodar duas vezes seguidas, ele **sobrescreve** o
rascunho de abordagem de um lead mesmo que a revisão humana ainda esteja
pendente — reescrevendo o texto que a pessoa está prestes a revisar. Isso
passa a rodar 1x/dia via o loop, então o risco fica real. Correção: antes de
compor abordagem nova, olha o `sales-state.json` anterior; se o lead já tem
`outreach` com `review` ausente/`pending`/`approved` (ainda não rejeitado),
mantém o rascunho existente em vez de gerar outro:

```ts
const previous = await getSalesState(ctx);
const previousByLead = new Map((previous?.entries ?? []).map((e) => [e.lead.leadId, e] as const));
// ...
const prior = previousByLead.get(lead.leadId);
const hasUnresolvedDraft = Boolean(prior?.outreach) && prior?.review?.status !== "rejected";
if (options.composeOutreach && shouldComposeOutreach(assessment)) {
  entry.outreach = hasUnresolvedDraft ? prior!.outreach : await runSalesOutreachCopilot(ctx, lead, assessment, options.steering);
}
```

### 4. `src/harness/salesAgentRuntime.ts` + `src/harness/skills/salesOutreachSkills.ts`

`runSalesOutreachCopilot` e `composeOutreachSkill`/`SalesOutreachInput` ganham
`steering?: string`, incluído no prompt quando presente. System prompt ganha
persona (mantém todas as regras de segurança comercial existentes — nunca
inventar dado, sempre `requiresHumanApproval: true`):

```text
Você é o Sales Development Rep sênior do ${brand.name} — especialista em
venda consultiva B2B SaaS, referência de mercado em abordagens que ajudam
antes de vender: você lê os sinais de comportamento do lead e escreve como
quem já entendeu o contexto dele, nunca como script genérico de disparo em
massa.
```

### 5. Revenue Director — sem mudança de lógica

`decideRevenueAction` continua 100% determinístico (regra arquitetural do
Harness: "LLM decide dentro de limites"). Novo: uma função pura em
`growthLoopRuntime.ts` que transforma a decisão em texto de steering, sem
LLM extra:

```ts
function buildSteering(decision: RevenueDecision): string {
  return `Gargalo identificado: ${decision.bottleneck}. Ação recomendada: ${decision.action}. Motivo: ${decision.reason} Evidência: ${decision.evidence.join("; ")}.`;
}
```

### 6. `src/harness/growthLoopRuntime.ts` (novo) — o orquestrador

```ts
export type GrowthLoopOutcome =
  | ({ type: "marketing" } & BacklogResult)
  | { type: "sales"; leadsAssessed: number; outreachComposed: number }
  | { type: "no_owner"; note: string }
  | { type: "no_action" };

export interface GrowthLoopState {
  updatedAt: string;
  snapshot: RevenueSnapshot;
  decision: RevenueDecision;
  outcome: GrowthLoopOutcome;
}

const GROWTH_LOOP_CONTENT_COUNT = 3; // pautas por rodada quando acionado por gargalo — não é reabastecimento de calendário, é correção pontual

export async function runGrowthLoop(ctx: WorkspaceContext, onEvent?: OnEvent): Promise<GrowthLoopState> {
  const { snapshot, decision } = await runRevenueDirector(ctx);
  const route = routeDecision(decision); // tabela de roteamento acima

  const outcome: GrowthLoopOutcome = await (async () => {
    if (route.owner === "marketing") {
      const result = await replenishContentBacklog(ctx, { count: GROWTH_LOOP_CONTENT_COUNT, steering: route.steering }, onEvent);
      return { type: "marketing", ...result };
    }
    if (route.owner === "sales") {
      const entries = await runWorkspaceSalesCopilot(ctx, { composeOutreach: true, steering: route.steering });
      return { type: "sales", leadsAssessed: entries.length, outreachComposed: entries.filter((e) => e.outreach).length };
    }
    if (decision.action === "do_nothing") return { type: "no_action" };
    return { type: "no_owner", note: route.note };
  })();

  const state: GrowthLoopState = { updatedAt: new Date().toISOString(), snapshot, decision, outcome };
  await saveGrowthLoopState(ctx, state);
  return state;
}
```

### 7. `src/growthLoop.ts` (novo) — persistência

Mesmo padrão dual de `src/sales/state.ts` (arquivo é escrito por processo de
vida curta — o workflow — mas precisa ser lido de forma durável pelo painel
hospedado): Firebase Storage quando `config.dataSource === "github"`, disco
local caso contrário.

```ts
const GROWTH_LOOP_STATE_FILE = "growth-loop-state.json";
export async function saveGrowthLoopState(ctx: WorkspaceContext, state: GrowthLoopState): Promise<void> { /* espelha persist() de sales/state.ts */ }
export async function getGrowthLoopState(ctx: WorkspaceContext): Promise<GrowthLoopState | null> { /* espelha getSalesState() */ }
```

Não entra em `mergeWorkspaceState.ts` — assim como `sales-state.json` e
`harness-traces.json`, este arquivo não é git-commitado; sua origem de
verdade é o Firebase Storage (mesmo bucket que já serve `/api/sales` e
`/api/harness/traces` em produção hoje).

### 8. `src/scripts/runGrowthLoop.ts` (novo) — entrypoint

Mesmo formato de `src/scripts/reconcileReels.ts` / `src/index.ts`: resolve
`WORKSPACE_ID`, monta `WorkspaceContext` completo (`requireAiProvider: true`
— o loop chama `runAgent`), roda `runGrowthLoop`, loga resultado, `exit(0)`
em sucesso e `exit(1)` logando o erro em falha (nunca derruba o workflow de
outros workspaces na matrix).

### 9. `.github/workflows/growth-loop.yml` (novo)

Mesma estrutura de `daily-post.yml` (job `list-workspaces` + matrix por
workspace ativo, `workflow_dispatch` com `workspace_id` opcional):

- `schedule: "0 12 * * *"` (12:00 UTC — antes do post diário às 13:18 UTC, pra
  qualquer pauta gerada pelo loop já poder entrar na fila do dia).
- `env`: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `FIREBASE_SERVICE_ACCOUNT_JSON`,
  `FIREBASE_STORAGE_BUCKET`, e **`DATA_SOURCE: github`** — necessário para
  que `sales-state.json` / `harness-traces.json` / `growth-loop-state.json`
  persistam no Firebase Storage em vez de sumirem com o container do job
  (mesma premissa que já vale hoje pra `/api/sales` e `/api/harness/traces`
  funcionarem no painel hospedado).
- Único arquivo commitado via a mesma reconciliação determinística das
  outras workflows (`mergeWorkspaceState.ts`, nunca rebase): `content-calendar.json`
  — o único arquivo que a mudança nesta rodada sempre escreve em disco local
  independente de `DATA_SOURCE` (`contentCalendar.ts` não segue o padrão
  dual dos outros módulos de estado; isso já é assim hoje, não é introduzido
  por este spec).

### 10. `server.ts` — exposição no painel

`GET /api/revenue` passa a incluir o último resultado persistido, sem
recalculá-lo nem disparar nenhum agente:

```ts
app.get("/api/revenue", asyncHandler(async (req, res) => {
  const ctx = await contextFor(workspaceId);
  const result = await runRevenueDirector(ctx); // decisão ao vivo, como já é hoje — barata, determinística
  const growthLoop = await getGrowthLoopState(ctx); // leitura pura do último resultado do loop agendado
  res.json({ ...result, growthLoop, monthlyCustomerTarget: ctx.workspace.goals.monthlyCustomerTarget ?? null });
}));
```

### 11. Painel (mínimo)

Um card novo reaproveitando os componentes já existentes, mostrando a
cadeia: "Revenue Director apontou {bottleneck} → {agente} já preparou
{resultado} → aguardando aprovação". Sem reabrir o redesenho visual recém-
concluído — só plugar o campo `growthLoop` novo do `GET /api/revenue`.

## Fora de escopo

- **Ativação/onboarding sem agente dono**: `improve_activation` fica só
  registrado (`{ type: "no_owner" }`). Não existe Activation/Onboarding
  Agent no Harness hoje; criar um é um projeto à parte.
- **Editar posts já publicados**: `improve_cta` gera pauta nova (reforçando
  CTA), não edita conteúdo live. Editar exigiria uma skill de mutação em
  conteúdo publicado com aprovação humana — decisão explícita de adiar
  (ver pergunta "Escopo CTA" respondida no brainstorming).
- **Cooldown configurável por workspace**: a decisão de não desperdiçar
  chamadas de IA já está coberta por dois mecanismos existentes/corrigidos
  (gate de `minimumPendingTopics` para o reabastecimento comum, e a correção
  do item 3 para não sobrescrever rascunho de vendas pendente) — não
  introduz um novo bloco de configuração `growthLoop` no `workspace.json`
  nesta rodada.
- **Skills de envio** (`sales.send_email`, `sales.send_whatsapp`) e
  publicação automática: continuam exigindo aprovação humana exatamente como
  hoje; este spec não toca `salesExecutionRuntime.ts` nem `publisher.ts`.
- **Persona especialista nos agentes do pipeline de blog** (redator, editor):
  fora de escopo desta rodada — ver conversa de brainstorming, escopo
  definido como "loop de crescimento primeiro".

## Observabilidade

Cada chamada a `runMarketingDirectorBacklog` / `runSalesCopilot` /
`runSalesOutreachCopilot` dentro do loop já grava trace via
`saveHarnessTrace` (nenhuma mudança necessária ali). `growth-loop-state.json`
guarda o resumo de alto nível (decisão + resultado); os traces individuais
continuam disponíveis em `GET /api/harness/traces` para investigar o
detalhe de uma rodada específica.

## Critérios de aceite

- [ ] `runGrowthLoop` roda Revenue Director, roteia pela tabela de ações, e
      persiste `growth-loop-state.json`.
- [ ] Bottleneck `traffic`/`trial_conversion` aciona Marketing Director com
      `steering` preenchido; pautas geradas citam o gargalo no `reason`.
- [ ] Bottleneck `sales_followup`/`sales_conversion` aciona Sales Agent com
      `steering` preenchido; nenhuma mensagem é enviada, só rascunho.
- [ ] Bottleneck `activation` e `none` não chamam nenhum agente, só
      registram o resultado.
- [ ] Rodar o loop duas vezes seguidas não sobrescreve um rascunho de venda
      com `review` pendente/aprovado.
- [ ] `ensureContentBacklog` mantém exatamente o comportamento atual (testes
      existentes de `backlog.test.ts` continuam passando sem alteração).
- [ ] `GET /api/revenue` inclui `growthLoop` sem custo de IA adicional.
- [ ] `growth-loop.yml` roda 1x/dia, por workspace ativo, sem quebrar
      `daily-post.yml`/`reconcile-reels.yml`.
- [ ] `npm run build` passa.
- [ ] `npm test` passa, com testes novos para: `routeDecision` (todas as
      combinações bottleneck/action), `replenishContentBacklog` isolada de
      `ensureContentBacklog`, a correção de rascunho pendente em
      `runWorkspaceSalesCopilot`, e `runGrowthLoop` fim-a-fim com fakes.
