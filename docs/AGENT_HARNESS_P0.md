# Agent Harness P0

## Objetivo

Criar uma camada de execução comum para agentes de IA, separando decisão, permissões, ferramentas, memória, observabilidade e limites operacionais do código específico de cada agente.

A primeira migração será o Marketing Director atual. Depois, o mesmo runtime servirá de base para Sales Agent e Revenue Director.

## Princípios

1. Nenhum agente executa ferramentas diretamente sem passar pelo runtime.
2. Cada agente recebe apenas as skills permitidas.
3. Toda execução possui workspace, runId, budget, trace e policy.
4. A saída do LLM deve ser validada antes de qualquer side effect.
5. Ações de maior risco podem exigir aprovação humana.
6. O runtime deve registrar custo, tokens, steps, erros, retries e ferramentas usadas.
7. O harness não substitui o pipeline atual de uma vez; a migração será incremental.

## Estrutura alvo P0

```text
src/
  harness/
    types.ts
    runtime.ts
    registry.ts
    policies.ts
    tracing.ts
    approvals.ts
    budget.ts
  agents/
    marketingDirector/
      agent.ts
      skills.ts
```

## Contratos principais

```ts
export type AgentId = "marketing-director" | "sales-agent" | "revenue-director";

export interface AgentBudget {
  maxSteps: number;
  maxCostUsd: number;
}

export interface AgentRunRequest<TContext = unknown> {
  workspaceId: string;
  agent: AgentId;
  goal: string;
  context: TContext;
  allowedSkills: string[];
  budget: AgentBudget;
}

export interface AgentRunResult<TOutput = unknown> {
  runId: string;
  output: TOutput;
  steps: number;
  costUsd: number;
  status: "completed" | "blocked" | "failed";
}
```

## Skills P0

Marketing Director:

- analyzePerformance
- analyzeAttribution
- analyzeSearchConsole
- generateContentBacklog

As chamadas existentes continuam sendo reaproveitadas; o objetivo é registrá-las e controlá-las pelo harness.

## Policies P0

- isolamento obrigatório por workspace;
- bloqueio de skill não autorizada;
- limite de steps por execução;
- limite estimado de custo por execução;
- falha fechada para ações não reconhecidas;
- nenhuma execução arbitrária de código retornado por LLM;
- side effects futuros de vendas/publicação devem suportar `requiresApproval`.

## Tracing P0

Cada execução deve produzir eventos com pelo menos:

```json
{
  "runId": "uuid",
  "workspaceId": "nextassist",
  "agent": "marketing-director",
  "goal": "replenish_content_backlog",
  "startedAt": "...",
  "finishedAt": "...",
  "steps": [],
  "usage": {},
  "costUsd": 0,
  "status": "completed"
}
```

## Migração do Marketing Director

Estado atual:

```text
ensureContentBacklog
  -> generateContentBacklog
  -> runAgent
```

Estado alvo:

```text
ensureContentBacklog
  -> harness.run(marketing-director)
      -> skill: analyzePerformance
      -> skill: analyzeAttribution
      -> skill: analyzeSearchConsole
      -> skill: generateContentBacklog
```

O resultado final continua compatível com `ContentOpportunity[]`, evitando quebrar o pipeline atual.

## Sales Agent — próxima fase

O Sales Agent deve começar em modo copilot.

Entradas esperadas:

- origem do lead;
- contentId/campaignId;
- eventos de funil;
- dados do trial;
- estágio de ativação;
- histórico comercial;
- dados públicos/autorizados do workspace.

Saídas iniciais:

- lead score;
- intenção estimada;
- problema provável;
- próxima melhor ação;
- mensagem sugerida;
- necessidade de follow-up;
- necessidade de handoff humano.

Ações externas reais (e-mail, WhatsApp, CRM) ficam atrás de policy + approval até haver confiança operacional.

## Revenue Director — fase seguinte

O Revenue Director será o agente coordenador acima de Marketing e Sales, com objetivo de negócio, por exemplo:

```text
increase_paid_customers
increase_mrr
improve_trial_activation
reduce_trial_to_paid_dropoff
```

Ele poderá priorizar entre ações de marketing, conversão e vendas com base em resultado real.

## Critério de pronto do P0

- runtime executa o Marketing Director;
- skills são registradas explicitamente;
- policy bloqueia skill não permitida;
- budget interrompe execução fora dos limites;
- tracing registra a execução;
- `ensureContentBacklog` mantém o comportamento atual;
- testes existentes continuam passando;
- novos testes cobrem runtime, policies e budget.
