# Loop de Crescimento — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fazer a decisão do Revenue Director virar trabalho real de Marketing Director/Sales Agent automaticamente (1x/dia), com aprovação humana preservada em tudo que sai (envio, publicação), e correlação completa (`runId`/`causedBy`) entre a decisão e as chamadas de IA que ela gerou.

**Architecture:** Um novo orquestrador (`runGrowthLoop`) roda dentro de um workflow agendado do GitHub Actions, chama o Revenue Director (já determinístico, sem LLM), roteia a decisão para Marketing Director ou Sales Agent por uma tabela fixa de ações, e persiste o resultado em `growth-loop-state.json` (Firebase Storage) para o painel ler sem custo de IA. `ensureContentBacklog` é dividido em "decidir se preciso gerar" (inalterado) + "gerar/validar/persistir" (extraído, reaproveitado pelos dois motivos de disparo).

**Tech Stack:** TypeScript (Node `node:test` + `node:assert/strict` no backend), Vitest + Testing Library no frontend (`web/`), GitHub Actions, Firebase Storage (via `src/lib/storage.ts`).

**Spec:** `docs/superpowers/specs/2026-09-16-growth-loop-design.md`

## Global Constraints

- Nenhuma skill de envio (`sales.send_email`/`sales.send_whatsapp`) nem publicação automática é tocada — aprovação humana continua exatamente como hoje em tudo que sai para fora do sistema.
- Nenhum deploy é feito durante esta implementação.
- Nenhum número inventado no painel — todo campo novo exposto em `GET /api/revenue` vem de dado real persistido, nunca de placeholder.
- `decideRevenueAction` (Revenue Director) continua 100% determinístico — nenhuma chamada de LLM é adicionada a ele.
- Comportamento observável de `ensureContentBacklog` não muda (testes existentes de `backlog.test.ts` continuam passando sem alteração de asserção).
- `npm run build` e `npm test` precisam passar depois de cada task.
- Commits em português, seguindo o estilo já usado no repositório (`git log --oneline` para referência).

---

## File Structure

| Arquivo | Ação | Responsabilidade |
|---|---|---|
| `src/revenue/types.ts` | modificar | ganha `GrowthLoopProvenance` (tipo compartilhado de proveniência) |
| `src/harness/types.ts` | modificar | `AgentRunRequest`/`AgentTrace` ganham `causedBy?: string` |
| `src/harness/runtime.ts` | modificar | `AgentHarnessRuntime.run()` propaga `causedBy` pro trace |
| `src/contentCalendar.ts` | modificar | `CalendarTopic`/`NewTopicInput` ganham `growthLoop?: GrowthLoopProvenance`; `addTopics` propaga |
| `src/lib/marketingDirector.ts` | modificar | `steering` no prompt; persona especialista; checklist de qualidade |
| `src/harness/marketingDirectorRuntime.ts` | modificar | `runMarketingDirectorBacklog` ganha `causedBy?` |
| `src/backlog.ts` | modificar | extrai `replenishContentBacklog`; estampa `growthLoop` antes de persistir |
| `src/harness/skills/salesOutreachSkills.ts` | modificar | `steering` no prompt; persona especialista |
| `src/harness/salesAgentRuntime.ts` | modificar | `runSalesOutreachCopilot` ganha `steering?`/`causedBy?` |
| `src/sales/pipeline.ts` | modificar | `runWorkspaceSalesCopilot` retorna `{entries, outreachCreated, outreachReused}`; não sobrescreve rascunho pendente; `steering?`/`causedBy?` |
| `src/growthLoop.ts` | criar | `GrowthLoopState`/`GrowthLoopOutcome` + `saveGrowthLoopState`/`getGrowthLoopState` |
| `src/harness/growthLoopRuntime.ts` | criar | `routeDecision`, `marketingAlreadyHandled`, `runGrowthLoop` |
| `src/scripts/runGrowthLoop.ts` | criar | entrypoint CLI do workflow |
| `.github/workflows/growth-loop.yml` | criar | cron 1x/dia + `workflow_dispatch` |
| `src/server.ts` | modificar | `GET /api/revenue` inclui `growthLoop` |
| `web/src/types/api.ts` | modificar | tipos `GrowthLoopState`/`GrowthLoopOutcome` no frontend |
| `web/src/views/dashboard/RevenuePanel.tsx` | modificar | card do resultado do loop |
| `web/src/views/dashboard/RevenuePanel.test.tsx` | criar | primeiro teste deste painel (hoje não tem nenhum) |

---

### Task 1: `causedBy` no Harness — correlação entre runs

**Files:**
- Modify: `src/harness/types.ts`
- Modify: `src/harness/runtime.ts`
- Test: `src/harness/runtime.test.ts`

**Interfaces:**
- Produces: `AgentRunRequest.causedBy?: string`, `AgentTrace.causedBy?: string` — usados por Task 4 (`runMarketingDirectorBacklog`) e Task 5 (`runSalesOutreachCopilot`).

- [ ] **Step 1: Escrever o teste que falha**

Adicionar ao final de `src/harness/runtime.test.ts`:

```ts
test("propaga causedBy do request pro trace quando informado", async () => {
  const registry = new SkillRegistry().register({ name: "echo", async execute() { return true; } });
  const runtime = new AgentHarnessRuntime({ registry });

  const result = await runtime.run(request({ causedBy: "growth-loop-run-123" }), async ({ invoke }) => invoke("echo", {}));

  assert.equal(result.trace.causedBy, "growth-loop-run-123");
});

test("causedBy fica undefined quando não informado — comportamento atual não muda", async () => {
  const registry = new SkillRegistry().register({ name: "echo", async execute() { return true; } });
  const runtime = new AgentHarnessRuntime({ registry });

  const result = await runtime.run(request(), async ({ invoke }) => invoke("echo", {}));

  assert.equal(result.trace.causedBy, undefined);
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npm test -- --test-name-pattern="causedBy"`
Expected: FAIL — `Property 'causedBy' does not exist on type` (erro de tipo) ou `undefined !== "growth-loop-run-123"`.

- [ ] **Step 3: Implementar**

Em `src/harness/types.ts`, adicionar `causedBy?: string` a `AgentRunRequest` e a `AgentTrace`:

```ts
export interface AgentRunRequest<TContext = unknown> {
  workspaceId: string;
  agent: HarnessAgentId;
  goal: string;
  context: TContext;
  allowedSkills: string[];
  budget: AgentBudget;
  /** `GrowthLoopState.runId` quando este run foi disparado pelo Loop de Crescimento. */
  causedBy?: string;
}
```

```ts
export interface AgentTrace {
  runId: string;
  workspaceId: string;
  agent: HarnessAgentId;
  goal: string;
  startedAt: string;
  finishedAt?: string;
  status: AgentRunStatus;
  steps: TraceStep[];
  costUsd: number;
  error?: string;
  causedBy?: string;
}
```

Em `src/harness/runtime.ts`, dentro de `run()`, ao montar `trace` (linha onde `trace: AgentTrace = { runId, workspaceId: request.workspaceId, ... }`), adicionar `causedBy: request.causedBy`:

```ts
const trace: AgentTrace = {
  runId,
  workspaceId: request.workspaceId,
  agent: request.agent,
  goal: request.goal,
  startedAt,
  status: "completed",
  steps: [],
  costUsd: 0,
  causedBy: request.causedBy,
};
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npm test -- --test-name-pattern="causedBy"`
Expected: PASS (2 testes).

- [ ] **Step 5: Rodar toda a suíte do harness pra garantir que nada quebrou**

Run: `npm test -- src/harness/runtime.test.ts`
Expected: PASS (todos os testes, incluindo os 4 já existentes).

- [ ] **Step 6: Commit**

```bash
git add src/harness/types.ts src/harness/runtime.ts src/harness/runtime.test.ts
git commit -m "feat(harness): AgentTrace ganha causedBy para correlacionar runs do Growth Loop"
```

---

### Task 2: `GrowthLoopProvenance` — proveniência estruturada no calendário

**Files:**
- Modify: `src/revenue/types.ts`
- Modify: `src/contentCalendar.ts`
- Test: `src/contentCalendar.test.ts` (**já existe** — tem testes de `getNextTopic`/`countPendingTopics`/`markTopicPublished`/`addTopics`. ACRESCENTAR o teste abaixo ao final do arquivo, nunca sobrescrever — os testes existentes cobrem `getNextTopic`/`markTopicPublished`, únicos consumidos por `src/pipeline.ts:53,133`, e não têm cobertura em nenhum outro lugar do repo)

**Interfaces:**
- Produces: `GrowthLoopProvenance` (de `src/revenue/types.ts`), `CalendarTopic.growthLoop?`, `NewTopicInput.growthLoop?` — usados por Task 7 (`marketingAlreadyHandled` lê `CalendarTopic.growthLoop`) e Task 6 do backlog (estampagem).

- [ ] **Step 1: Escrever o teste que falha**

Adicionar ao final de `src/contentCalendar.test.ts` (o arquivo já existe com outros testes — não sobrescrever):

O arquivo já importa `buildWorkspaceContext`, `createTempWorkspace`, `addTopics`, `getAllTopics`, e já tem os helpers `workspace` (const) e `contextWithCalendar(topicos)` — reaproveitar, não redeclarar:

```ts
test("addTopics propaga growthLoop quando informado, e não exige o campo quando ausente", async () => {
  const { ctx, cleanup } = await contextWithCalendar([]);
  try {
    await addTopics(ctx, [
      { tema: "Tema com proveniência", palavraChaveAlvo: "k1", growthLoop: { bottleneck: "traffic", action: "create_content", runId: "run-1" } },
      { tema: "Tema sem proveniência", palavraChaveAlvo: "k2" },
    ]);

    const all = await getAllTopics(ctx);
    const withProvenance = all.find((t) => t.tema === "Tema com proveniência");
    const withoutProvenance = all.find((t) => t.tema === "Tema sem proveniência");

    assert.deepEqual(withProvenance?.growthLoop, { bottleneck: "traffic", action: "create_content", runId: "run-1" });
    assert.equal(withoutProvenance?.growthLoop, undefined);
  } finally {
    await cleanup();
  }
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npm test -- --test-name-pattern="growthLoop quando informado"`
Expected: FAIL — erro de tipo (`growthLoop` não existe em `NewTopicInput`) ou `undefined` no lugar do objeto esperado.

- [ ] **Step 3: Implementar**

Em `src/revenue/types.ts`, adicionar ao final do arquivo:

```ts
/** Proveniência estruturada de algo gerado pelo Loop de Crescimento — usada para medir depois "das pautas ordenadas pelo Revenue Director, quantas geraram trial/cliente?" sem parsear texto livre. */
export interface GrowthLoopProvenance {
  bottleneck: RevenueBottleneck;
  action: RevenueAction;
  runId: string;
}
```

Em `src/contentCalendar.ts`, adicionar o import e o campo em `CalendarTopic`/`NewTopicInput`, e propagar em `addTopics`:

```ts
// src/contentCalendar.ts
import { readFile, writeFile } from "node:fs/promises";
import type { WorkspaceContext } from "./context.js";
import type { GrowthLoopProvenance } from "./revenue/types.js";

export interface CalendarTopic {
  tema: string;
  palavraChaveAlvo: string;
  publicado: boolean;
  publicadoEm?: string;
  generatedBy?: "marketing-director";
  createdAt?: string;
  reason?: string;
  priority?: "high" | "medium" | "low";
  growthLoop?: GrowthLoopProvenance;
}

export interface NewTopicInput {
  tema: string;
  palavraChaveAlvo: string;
  reason?: string;
  priority?: "high" | "medium" | "low";
  growthLoop?: GrowthLoopProvenance;
}
```

E, dentro de `addTopics`, no `map`:

```ts
  const newTopics: CalendarTopic[] = inputs.map((input) => ({
    tema: input.tema,
    palavraChaveAlvo: input.palavraChaveAlvo,
    publicado: false,
    generatedBy: "marketing-director",
    createdAt,
    reason: input.reason,
    priority: input.priority,
    growthLoop: input.growthLoop,
  }));
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npm test -- --test-name-pattern="growthLoop quando informado"`
Expected: PASS.

- [ ] **Step 5: Rodar toda a suíte de calendário/backlog pra garantir que nada quebrou**

Run: `npm test -- src/contentCalendar.test.ts src/backlog.test.ts`
Expected: PASS (todos).

- [ ] **Step 6: Commit**

```bash
git add src/revenue/types.ts src/contentCalendar.ts src/contentCalendar.test.ts
git commit -m "feat: CalendarTopic ganha growthLoop — proveniência estruturada de pautas do Growth Loop"
```

---

### Task 3: Steering + persona em `src/lib/marketingDirector.ts`

**Files:**
- Modify: `src/lib/marketingDirector.ts`
- Test: `src/lib/marketingDirector.test.ts`

**Interfaces:**
- Produces: `GenerateContentBacklogOptions.steering?: string` — consumido por Task 6 (`replenishContentBacklog`).

- [ ] **Step 1: Escrever o teste que falha**

Adicionar ao final de `src/lib/marketingDirector.test.ts`:

```ts
test("buildPrompt inclui o direcionamento do Revenue Director quando steering está presente", () => {
  const ctx = { workspace: baseWorkspace } as any;
  const prompt = buildPrompt(
    ctx,
    { count: 3, existingThemes: [], existingKeywords: [], publishedTitles: [], steering: "Gargalo identificado: trial_conversion. Ação recomendada: improve_cta." },
    null, null, [],
  );
  assert.match(prompt, /Direcionamento prioritário desta rodada \(Revenue Director\)/);
  assert.match(prompt, /trial_conversion/);
});

test("buildPrompt sem steering não menciona Revenue Director — comportamento atual não muda", () => {
  const ctx = { workspace: baseWorkspace } as any;
  const prompt = buildPrompt(ctx, { count: 3, existingThemes: [], existingKeywords: [], publishedTitles: [] }, null, null, []);
  assert.doesNotMatch(prompt, /Revenue Director/);
});

test("SYSTEM_TEMPLATE tem framing de especialista de mercado", () => {
  const ctx = { workspace: baseWorkspace } as any;
  const system = SYSTEM_TEMPLATE(ctx);
  assert.match(system, /Head of Content\/Growth/);
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npm test -- --test-name-pattern="steering|especialista de mercado"`
Expected: FAIL — erro de tipo (`steering` não existe em `GenerateContentBacklogOptions`) e/ou texto ausente.

- [ ] **Step 3: Implementar**

Em `src/lib/marketingDirector.ts`, atualizar `GenerateContentBacklogOptions`:

```ts
export interface GenerateContentBacklogOptions {
  count: number;
  existingThemes: string[];
  existingKeywords: string[];
  publishedTitles: string[];
  /** Texto do Revenue Director quando esta rodada foi disparada por um gargalo específico do funil (Loop de Crescimento), em vez de calendário baixo. */
  steering?: string;
}
```

Atualizar `SYSTEM_TEMPLATE` — inserir o parágrafo de persona logo após a linha do objetivo principal do workspace, e o checklist logo antes do "Responda SOMENTE":

```ts
export const SYSTEM_TEMPLATE = (ctx: WorkspaceContext) => `Você é o Marketing Director do ${ctx.workspace.brand.name} — ${ctx.workspace.brand.description}
Você atua como um Head of Content/Growth de mercado: mais de uma década lançando estratégias de conteúdo B2B SaaS que geram pipeline comercial mensurável, não apenas tráfego. Você pensa em clusters temáticos e autoridade de tópico (não posts isolados), em intenção de busca por estágio de funil, e nunca aprova uma pauta sem conseguir explicar, em uma frase, que resultado de negócio ela deve mover.
Tom de voz: ${ctx.workspace.brand.toneOfVoice}
Público-alvo: ${ctx.workspace.brand.targetAudience.join(", ") || "não especificado"}
Concorrentes diretos: ${ctx.workspace.brand.competitors.join(", ") || "não especificado"}
Propostas de valor: ${(ctx.workspace.brand.valuePropositions ?? []).join(", ") || "não especificado"}
Objetivo principal do workspace: ${ctx.workspace.goals.primary}

Sua responsabilidade é perceber quando o backlog de pautas do blog está
ficando baixo — ou quando o Revenue Director sinalizar um gargalo específico
do funil — e propor novas oportunidades de conteúdo com potencial real de
impacto nesse objetivo — nunca gere temas aleatórios ou genéricos.

Priorize, nesta ordem, sempre que houver dado suficiente:
1. Conteúdos que já geraram clientes pagantes (assinatura) — nunca deixe alcance bruto superar isso.
2. Entre os que ainda não geraram cliente, os com mais usuários ativados (criaram a 1ª Ordem de Serviço).
3. Entre os que ainda não ativaram ninguém, os com mais trials.
4. Taxas de conversão calculadas com menos de ${MIN_TRIALS_FOR_RATE} trials têm amostra insuficiente — NÃO as use para priorizar, mesmo que pareçam altas.
5. Só quando não houver sinal comercial suficiente (poucos ou nenhum dado de atribuição), use Search Console, concorrentes ou clusters de conteúdo como critério.

Antes de responder, audite cada pauta: (1) ela ataca um gargalo real, não
uma hipótese? (2) o público-alvo reconheceria a dor descrita? (3) ela não
compete por atenção com um cluster já publicado? Descarte qualquer ideia que
falhe nesse teste em vez de incluí-la.

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
```

Atualizar `buildPrompt` — adicionar o bloco de steering entre o parágrafo de abertura ("Gere até...") e "Temas já existentes":

```ts
export function buildPrompt(
  ctx: WorkspaceContext,
  options: GenerateContentBacklogOptions,
  performance: PerformanceReport | null,
  attribution: { rows: AttributionRow[]; unattributedEvents: number } | null,
  topQueries: Awaited<ReturnType<typeof getTopSearchQueries>>,
): string {
  const forbidden = ctx.workspace.brand.forbiddenTerms ?? [];

  const topByClicks = /* ...inalterado... */
  const topByAttribution = /* ...inalterado... */
  const searchOpportunities = /* ...inalterado... */

  const steeringBlock = options.steering
    ? `\nDirecionamento prioritário desta rodada (Revenue Director): ${options.steering}\nTodas as pautas geradas devem atacar diretamente esse gargalo — não gere pautas genéricas de reforço de marca enquanto esse direcionamento estiver ativo.\n`
    : "";

  return `Gere até ${options.count} novas oportunidades de pauta para o blog.
${steeringBlock}
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

(Os três blocos marcados "inalterado" mantêm exatamente o código já existente no arquivo — apenas o cabeçalho de `buildPrompt` e o corpo entre `Gere até...` e `Temas já existentes` mudam.)

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npm test -- --test-name-pattern="steering|especialista de mercado"`
Expected: PASS (3 testes).

- [ ] **Step 5: Rodar toda a suíte de marketingDirector**

Run: `npm test -- src/lib/marketingDirector.test.ts`
Expected: PASS (todos, incluindo os testes já existentes de `buildPrompt`/`SYSTEM_TEMPLATE`/`parseContentOpportunities`).

- [ ] **Step 6: Commit**

```bash
git add src/lib/marketingDirector.ts src/lib/marketingDirector.test.ts
git commit -m "feat(marketing-director): persona de especialista + steering do Revenue Director no prompt"
```

---

### Task 4: `causedBy` em `runMarketingDirectorBacklog`

**Files:**
- Modify: `src/harness/marketingDirectorRuntime.ts`
- Test: nenhum arquivo de teste dedicado existe para este runtime — validado indiretamente pela Task 6 (`backlog.test.ts` com injeção) e pela Task 8 (fim-a-fim). Este passo só troca a assinatura.

**Interfaces:**
- Consumes: `AgentRunRequest.causedBy` (Task 1).
- Produces: `runMarketingDirectorBacklog(ctx, options, causedBy?)` — consumido por Task 6.

- [ ] **Step 1: Implementar**

Em `src/harness/marketingDirectorRuntime.ts`, atualizar a assinatura e passar `causedBy` no request:

```ts
export async function runMarketingDirectorBacklog(
  ctx: WorkspaceContext,
  options: GenerateContentBacklogOptions,
  causedBy?: string,
): Promise<MarketingDirectorHarnessResult> {
  const registry = new SkillRegistry().register(generateContentBacklogSkill);
  const runtime = new AgentHarnessRuntime({
    registry,
    getCostUsd: () => ctx.usage.get().estimatedUsd,
  });

  const harnessContext: MarketingDirectorHarnessContext = { workspaceContext: ctx };
  const result = await runtime.run<MarketingDirectorHarnessContext, ContentOpportunity[]>(
    {
      workspaceId: ctx.workspace.id,
      agent: "marketing-director",
      goal: "replenish_content_backlog",
      context: harnessContext,
      allowedSkills: [GENERATE_CONTENT_BACKLOG_SKILL],
      budget: MARKETING_DIRECTOR_BUDGET,
      causedBy,
    },
    ({ invoke }) => invoke<GenerateContentBacklogOptions, ContentOpportunity[]>(GENERATE_CONTENT_BACKLOG_SKILL, options),
  );

  await saveHarnessTrace(ctx, result.trace);

  if (result.status !== "completed" || !result.output) {
    throw new Error(`Marketing Director bloqueado pelo Harness: ${result.trace.error ?? result.status}`);
  }

  return {
    opportunities: result.output,
    runId: result.runId,
    costUsd: result.costUsd,
  };
}
```

- [ ] **Step 2: Rodar o build pra garantir que a assinatura nova não quebra os chamadores atuais**

Run: `npm run build`
Expected: PASS — `causedBy` é opcional, nenhum chamador existente precisa mudar ainda (Task 6 vai passar a usá-lo).

- [ ] **Step 3: Commit**

```bash
git add src/harness/marketingDirectorRuntime.ts
git commit -m "feat(marketing-director): runMarketingDirectorBacklog aceita causedBy opcional"
```

---

### Task 5: Steering + persona + `causedBy` em `salesOutreachSkills.ts`/`salesAgentRuntime.ts`

**Files:**
- Modify: `src/harness/skills/salesOutreachSkills.ts`
- Modify: `src/harness/salesAgentRuntime.ts`
- Test: nenhum arquivo de teste cobre `composeOutreachSkill` hoje (ele chama IA de verdade). A cobertura de comportamento entra na Task 6 via injeção. Aqui só validamos tipos com o build.

**Interfaces:**
- Consumes: `AgentRunRequest.causedBy` (Task 1).
- Produces: `runSalesOutreachCopilot(ctx, lead, assessment, steering?, causedBy?)` — consumido por Task 6.

- [ ] **Step 1: Implementar `salesOutreachSkills.ts`**

Em `src/harness/skills/salesOutreachSkills.ts`, atualizar `SalesOutreachInput` e o corpo de `execute`:

```ts
export interface SalesOutreachInput {
  lead: SalesLeadContext;
  assessment: SalesAssessment;
  /** Texto do Revenue Director quando esta abordagem foi priorizada por um gargalo do funil (Loop de Crescimento). */
  steering?: string;
}
```

Dentro de `composeOutreachSkill.execute`, no `system`, inserir a persona logo após a linha `Você é o Sales Agent do ${ctx.workspace.brand.name}.` — e no `prompt`, inserir o steering antes de "Escreva uma abordagem":

```ts
    const system = `Você é o Sales Development Rep sênior do ${ctx.workspace.brand.name} — especialista em venda consultiva B2B SaaS, referência de mercado em abordagens que ajudam antes de vender: você lê os sinais de comportamento do lead e escreve como quem já entendeu o contexto dele, nunca como script genérico de disparo em massa.
Produto: ${ctx.workspace.brand.description}
Público-alvo: ${ctx.workspace.brand.targetAudience.join(", ") || "não especificado"}
Propostas de valor: ${(ctx.workspace.brand.valuePropositions ?? []).join(", ") || "não especificado"}

Sua função nesta etapa é SOMENTE redigir uma sugestão de abordagem comercial curta, útil e não agressiva.
Não invente nome, empresa, telefone, e-mail, dor ou informação que não esteja nos sinais fornecidos.
Não prometa desconto, condição comercial ou funcionalidade não informada.
Não diga que a mensagem já foi enviada.
A saída será revisada por uma pessoa antes de qualquer contato externo.`;

    const steeringLine = input.steering ? `\nDirecionamento prioritário desta rodada (Revenue Director): ${input.steering}\n` : "";

    const prompt = `Lead: ${input.lead.leadId}
Origem: ${input.lead.source ?? "não informada"}
Score: ${input.assessment.score}/100
Intenção: ${input.assessment.intent}
Próxima ação recomendada: ${input.assessment.nextAction}
Motivos: ${input.assessment.reasons.join("; ") || "sem motivo adicional"}
Sinais recentes: ${recentSignals || "nenhum"}
${steeringLine}
Escreva uma abordagem em português do Brasil, de 2 a 5 frases, focada em ajudar e avançar um único próximo passo.
Responda SOMENTE JSON:
{
  "subject": "opcional; use apenas se fizer sentido para e-mail",
  "message": "...",
  "rationale": "por que esta abordagem é adequada para os sinais observados"
}`;
```

- [ ] **Step 2: Implementar `salesAgentRuntime.ts`**

Atualizar `runSalesOutreachCopilot`:

```ts
export async function runSalesOutreachCopilot(
  ctx: WorkspaceContext,
  lead: SalesLeadContext,
  assessment: SalesAssessment,
  steering?: string,
  causedBy?: string,
): Promise<SalesOutreachDraft> {
  const registry = new SkillRegistry()
    .register(assessLeadSkill)
    .register(composeOutreachSkill);
  const runtime = new AgentHarnessRuntime({
    registry,
    getCostUsd: () => ctx.usage.get().estimatedUsd,
  });
  const harnessContext: SalesOutreachHarnessContext = { workspaceContext: ctx };

  const result = await runtime.run<SalesOutreachHarnessContext, SalesOutreachDraft>(
    {
      workspaceId: ctx.workspace.id,
      agent: "sales-agent",
      goal: "compose_contextual_outreach_for_human_approval",
      context: harnessContext,
      allowedSkills: [COMPOSE_OUTREACH_SKILL],
      budget: SALES_AGENT_BUDGET,
      causedBy,
    },
    ({ invoke }) => invoke(COMPOSE_OUTREACH_SKILL, { lead, assessment, steering }),
  );

  await saveHarnessTrace(ctx, result.trace);

  if (result.status !== "completed" || !result.output) {
    throw new Error(`Sales Agent não conseguiu compor abordagem: ${result.trace.error ?? result.status}`);
  }

  return result.output;
}
```

(`runSalesCopilot` não muda — sua trace nunca é persistida via `saveHarnessTrace`, então propagar `causedBy` nele não teria efeito observável em `harness-traces.json`; ver nota de escopo na Task 6.)

- [ ] **Step 3: Rodar o build e a suíte do harness de vendas**

Run: `npm run build && npm test -- src/harness/salesAgentRuntime.test.ts`
Expected: PASS — assinatura antiga (`runSalesOutreachCopilot(ctx, lead, assessment)`) continua válida porque os dois novos parâmetros são opcionais; nenhum teste existente quebra.

- [ ] **Step 4: Commit**

```bash
git add src/harness/skills/salesOutreachSkills.ts src/harness/salesAgentRuntime.ts
git commit -m "feat(sales-agent): persona de SDR sênior + steering do Revenue Director + causedBy"
```

---

### Task 6: `sales/pipeline.ts` — dedup de rascunho + `SalesPipelineRunResult`

**Files:**
- Modify: `src/sales/pipeline.ts`
- Modify: `src/sales/state.ts` (achado da revisão: `saveSalesState` reanexa incondicionalmente `old.review` a qualquer entrada nova pelo mesmo `leadId` — isso reata uma revisão "rejected" antiga a um rascunho recém-recomposto, escondendo-o de uma fila de revisão pendente; ver correção abaixo)
- Test: `src/sales/pipeline.test.ts`

**Interfaces:**
- Consumes: `runSalesOutreachCopilot(ctx, lead, assessment, steering?, causedBy?)` (Task 5), `getSalesState`/`SalesHumanReview` (`src/sales/state.ts`, `src/sales/types.ts` — já existentes).
- Produces: `SalesPipelineRunResult { entries, outreachCreated, outreachReused }` — consumido por Task 8.

**Correção obrigatória em `src/sales/state.ts`:** dentro de `saveSalesState`, remover a linha
`...(old?.review ? { review: old.review } : {})` do `merged = entries.map(...)`. A revisão de
uma pessoa pertence a um rascunho específico — quando `pipeline.ts` compõe um rascunho novo
(branch "senão" do dedup), a entrada não deve herdar a revisão antiga. Em compensação,
`pipeline.ts` passa a propagar `prior.review` explicitamente no branch de reaproveitamento
(`hasUnresolvedDraft`), junto com `prior.outreach` — ver Step 3. A linha de `executions` no
merge de `state.ts` NÃO muda (log de tentativas de envio não é atrelado à identidade do
rascunho).

- [ ] **Step 1: Escrever o teste que falha**

Adicionar ao final de `src/sales/pipeline.test.ts` (o arquivo ainda só tem o teste de `shouldComposeOutreach`; manter esse teste como está e adicionar os novos):

```ts
import { buildWorkspaceContext } from "../context.js";
import type { MarketingWorkspace } from "../workspace.js";
import type { SecretProvider } from "../lib/secrets.js";
import { createTempWorkspace } from "../testing/tempWorkspace.js";
import { runWorkspaceSalesCopilot } from "./pipeline.js";
import type { SalesOutreachDraft } from "./types.js";

function baseWorkspace(): MarketingWorkspace {
  return {
    id: "acme", name: "Acme", active: true,
    brand: { name: "Acme", description: "d", toneOfVoice: "t", targetAudience: [], competitors: [] },
    goals: { primary: "leads" },
    channels: { blog: true, instagram: false, linkedin: false },
    integrations: { siteUrl: "https://acme.test", cms: { provider: "nextassist", apiUrl: "https://api.acme.test" } },
    autonomy: { mode: "copilot" },
    secrets: { required: [] },
  };
}

function fakeSecrets(): SecretProvider {
  return { async get() { return undefined; } };
}

// Precisa somar >= 70 pontos pra virar intent "high" + nextAction
// "request_human_contact" (ver src/harness/skills/salesSkills.ts: WEIGHTS —
// site_visit 5 + pricing_view 15 + trial_started 30 + contact_submit 25 = 75).
const hotLeadEvents = [
  { name: "page_view", anonymousId: "lead-1", path: "/", createdAt: "2026-09-14T09:00:00.000Z" },
  { name: "page_view", anonymousId: "lead-1", path: "/precos", createdAt: "2026-09-14T09:30:00.000Z" },
  { name: "trial_started", anonymousId: "lead-1", createdAt: "2026-09-14T10:00:00.000Z" },
  { name: "contact_submit", anonymousId: "lead-1", createdAt: "2026-09-14T10:05:00.000Z" },
];

const fakeDraft: SalesOutreachDraft = {
  leadId: "lead-1", channel: "human", message: "Rascunho novo", rationale: "r", requiresHumanApproval: true,
};

test("não reescreve rascunho de venda com review pendente — não chama o composer de novo", async () => {
  const temp = await createTempWorkspace("acme", {
    "conversion-events.json": hotLeadEvents,
    "sales-state.json": {
      updatedAt: "2026-09-14T10:05:00.000Z",
      entries: [{
        lead: { leadId: "lead-1", anonymousId: "lead-1", signals: [] },
        assessment: { leadId: "lead-1", score: 75, intent: "high", nextAction: "request_human_contact", reasons: [] },
        outreach: { leadId: "lead-1", channel: "human", message: "Rascunho antigo aguardando revisão", rationale: "r", requiresHumanApproval: true },
        review: { status: "pending", message: "Rascunho antigo aguardando revisão", updatedAt: "2026-09-14T10:05:00.000Z" },
      }],
    },
  });
  try {
    const ctx = await buildWorkspaceContext(baseWorkspace(), fakeSecrets(), { workspacesRoot: temp.root, requireAiProvider: false });
    let composeCalls = 0;
    const composeOutreachFn = async (): Promise<SalesOutreachDraft> => { composeCalls++; return fakeDraft; };

    const result = await runWorkspaceSalesCopilot(ctx, { composeOutreach: true, composeOutreachFn });

    assert.equal(composeCalls, 0, "não deveria chamar o composer — já existe rascunho pendente");
    assert.equal(result.outreachCreated, 0);
    assert.equal(result.outreachReused, 1);
    assert.equal(result.entries[0]?.outreach?.message, "Rascunho antigo aguardando revisão");
  } finally {
    await temp.cleanup();
  }
});

test("gera rascunho novo quando não existe nenhum anterior", async () => {
  const temp = await createTempWorkspace("acme", { "conversion-events.json": hotLeadEvents });
  try {
    const ctx = await buildWorkspaceContext(baseWorkspace(), fakeSecrets(), { workspacesRoot: temp.root, requireAiProvider: false });
    let composeCalls = 0;
    const composeOutreachFn = async (): Promise<SalesOutreachDraft> => { composeCalls++; return fakeDraft; };

    const result = await runWorkspaceSalesCopilot(ctx, { composeOutreach: true, composeOutreachFn });

    assert.equal(composeCalls, 1);
    assert.equal(result.outreachCreated, 1);
    assert.equal(result.outreachReused, 0);
    assert.equal(result.entries[0]?.outreach?.message, "Rascunho novo");
  } finally {
    await temp.cleanup();
  }
});

test("gera rascunho novo quando o anterior foi rejeitado", async () => {
  const temp = await createTempWorkspace("acme", {
    "conversion-events.json": hotLeadEvents,
    "sales-state.json": {
      updatedAt: "2026-09-14T10:05:00.000Z",
      entries: [{
        lead: { leadId: "lead-1", anonymousId: "lead-1", signals: [] },
        assessment: { leadId: "lead-1", score: 75, intent: "high", nextAction: "request_human_contact", reasons: [] },
        outreach: { leadId: "lead-1", channel: "human", message: "Rascunho rejeitado", rationale: "r", requiresHumanApproval: true },
        review: { status: "rejected", message: "Rascunho rejeitado", updatedAt: "2026-09-14T10:05:00.000Z" },
      }],
    },
  });
  try {
    const ctx = await buildWorkspaceContext(baseWorkspace(), fakeSecrets(), { workspacesRoot: temp.root, requireAiProvider: false });
    let composeCalls = 0;
    const composeOutreachFn = async (): Promise<SalesOutreachDraft> => { composeCalls++; return fakeDraft; };

    const result = await runWorkspaceSalesCopilot(ctx, { composeOutreach: true, composeOutreachFn });

    assert.equal(composeCalls, 1, "review rejeitada libera uma nova tentativa");
    assert.equal(result.outreachCreated, 1);
    assert.equal(result.outreachReused, 0);
  } finally {
    await temp.cleanup();
  }
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npm test -- src/sales/pipeline.test.ts`
Expected: FAIL — `composeOutreachFn` não existe em `SalesPipelineOptions`, `runWorkspaceSalesCopilot` ainda devolve um array (não `{entries, outreachCreated, outreachReused}`).

- [ ] **Step 3: Implementar**

Reescrever `src/sales/pipeline.ts` por completo:

```ts
import type { WorkspaceContext } from "../context.js";
import { runSalesCopilot, runSalesOutreachCopilot } from "../harness/salesAgentRuntime.js";
import { getSalesLeads } from "./funnel.js";
import { getSalesState, saveSalesState } from "./state.js";
import type { SalesAssessment, SalesOutreachDraft, SalesPipelineEntry } from "./types.js";

export interface SalesPipelineOptions {
  composeOutreach?: boolean;
  maxLeads?: number;
  /** Texto do Revenue Director quando este run foi disparado por um gargalo do funil (Loop de Crescimento). */
  steering?: string;
  /** `GrowthLoopState.runId`, propagado até o trace do Harness. */
  causedBy?: string;
  /** Ponto de injeção para testes — evita chamar IA de verdade. Padrão: `runSalesOutreachCopilot`. */
  composeOutreachFn?: typeof runSalesOutreachCopilot;
}

export interface SalesPipelineRunResult {
  entries: SalesPipelineEntry[];
  outreachCreated: number;
  outreachReused: number;
}

export function shouldComposeOutreach(assessment: SalesAssessment): boolean {
  return assessment.intent === "high" && assessment.nextAction === "request_human_contact";
}

/**
 * Analisa o funil comercial real do workspace.
 *
 * - lê conversion-events existentes;
 * - reconstrói leads por identidade;
 * - aplica scoring determinístico via Harness;
 * - opcionalmente gera rascunho com IA somente para leads de alta intenção
 *   que ainda não têm um rascunho pendente/aprovado — nunca sobrescreve o
 *   que um humano está prestes a revisar;
 * - persiste o snapshot comercial por workspace para consumo do painel;
 * - nunca envia mensagem nem altera CRM/lead.
 */
export async function runWorkspaceSalesCopilot(
  ctx: WorkspaceContext,
  options: SalesPipelineOptions = {},
): Promise<SalesPipelineRunResult> {
  const maxLeads = Math.max(1, options.maxLeads ?? 50);
  const composeOutreachFn = options.composeOutreachFn ?? runSalesOutreachCopilot;
  const leads = (await getSalesLeads(ctx)).slice(0, maxLeads);
  const previous = await getSalesState(ctx);
  const previousByLead = new Map((previous?.entries ?? []).map((e) => [e.lead.leadId, e] as const));

  const results: SalesPipelineEntry[] = [];
  let outreachCreated = 0;
  let outreachReused = 0;

  // Sequencial de propósito: evita burst de chamadas de IA caso vários leads
  // quentes sejam encontrados ao mesmo tempo.
  for (const lead of leads) {
    const assessment = await runSalesCopilot(ctx.workspace.id, lead);
    const entry: SalesPipelineEntry = { lead, assessment };

    if (options.composeOutreach && shouldComposeOutreach(assessment)) {
      const prior = previousByLead.get(lead.leadId);
      const hasUnresolvedDraft = Boolean(prior?.outreach) && prior?.review?.status !== "rejected";

      if (hasUnresolvedDraft) {
        entry.outreach = prior!.outreach;
        entry.review = prior!.review; // mesmo rascunho — a revisão em andamento/aprovada continua válida
        outreachReused++;
      } else {
        entry.outreach = await composeOutreachFn(ctx, lead, assessment, options.steering, options.causedBy);
        // entry.review fica ausente de propósito: rascunho novo, revisão antiga (se existia) não se aplica mais
        outreachCreated++;
      }
    }

    results.push(entry);
  }

  const sorted = results.sort((a, b) => b.assessment.score - a.assessment.score);
  await saveSalesState(ctx, sorted);
  return { entries: sorted, outreachCreated, outreachReused };
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npm test -- src/sales/pipeline.test.ts`
Expected: PASS (4 testes: o original de `shouldComposeOutreach` + os 3 novos).

- [ ] **Step 5: Commit**

```bash
git add src/sales/pipeline.ts src/sales/pipeline.test.ts
git commit -m "fix(sales): não sobrescreve rascunho pendente/aprovado; retorno distingue created de reused"
```

---

### Task 7: `src/growthLoop.ts` — persistência do estado do loop

**Files:**
- Create: `src/growthLoop.ts`
- Test: `src/growthLoop.test.ts`

**Interfaces:**
- Consumes: `BacklogResult` (`src/backlog.ts`), `RevenueDecision`/`RevenueSnapshot` (`src/revenue/types.ts`).
- Produces: `GrowthLoopOutcome`, `GrowthLoopState`, `saveGrowthLoopState(ctx, state)`, `getGrowthLoopState(ctx)` — consumidos por Task 8 e Task 9 (server.ts).

- [ ] **Step 1: Escrever o teste que falha**

Criar `src/growthLoop.test.ts`:

```ts
// src/growthLoop.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import { buildWorkspaceContext } from "./context.js";
import type { MarketingWorkspace } from "./workspace.js";
import type { SecretProvider } from "./lib/secrets.js";
import { createTempWorkspace } from "./testing/tempWorkspace.js";
import { getGrowthLoopState, saveGrowthLoopState, type GrowthLoopState } from "./growthLoop.js";

function baseWorkspace(): MarketingWorkspace {
  return {
    id: "acme", name: "Acme", active: true,
    brand: { name: "Acme", description: "d", toneOfVoice: "t", targetAudience: [], competitors: [] },
    goals: { primary: "leads" },
    channels: { blog: true, instagram: false, linkedin: false },
    integrations: { siteUrl: "https://acme.test", cms: { provider: "nextassist", apiUrl: "https://api.acme.test" } },
    autonomy: { mode: "copilot" },
    secrets: { required: [] },
  };
}

function fakeSecrets(): SecretProvider {
  return { async get() { return undefined; } };
}

const sampleState: GrowthLoopState = {
  runId: "run-1",
  startedAt: "2026-09-16T12:00:00.000Z",
  completedAt: "2026-09-16T12:00:05.000Z",
  updatedAt: "2026-09-16T12:00:05.000Z",
  snapshot: { visits: 10, trials: 2, activated: 1, customers: 0, hotLeads: 1, pendingSalesApprovals: 0, visitToTrialRate: 0.2, trialToActivationRate: 0.5, activationToCustomerRate: 0 },
  decision: { objective: "increase_paying_customers", bottleneck: "traffic", action: "create_content", priority: "medium", reason: "pouco tráfego", evidence: [], requiresHumanApproval: false },
  outcome: { type: "no_action" },
};

test("getGrowthLoopState devolve null quando nunca foi salvo", async () => {
  const temp = await createTempWorkspace("acme");
  try {
    const ctx = await buildWorkspaceContext(baseWorkspace(), fakeSecrets(), { workspacesRoot: temp.root, requireAiProvider: false });
    assert.equal(await getGrowthLoopState(ctx), null);
  } finally {
    await temp.cleanup();
  }
});

test("saveGrowthLoopState + getGrowthLoopState fazem round-trip", async () => {
  const temp = await createTempWorkspace("acme");
  try {
    const ctx = await buildWorkspaceContext(baseWorkspace(), fakeSecrets(), { workspacesRoot: temp.root, requireAiProvider: false });
    await saveGrowthLoopState(ctx, sampleState);
    assert.deepEqual(await getGrowthLoopState(ctx), sampleState);
  } finally {
    await temp.cleanup();
  }
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npm test -- src/growthLoop.test.ts`
Expected: FAIL — `Cannot find module './growthLoop.js'`.

- [ ] **Step 3: Implementar**

Criar `src/growthLoop.ts`, espelhando exatamente o padrão dual de `src/sales/state.ts`:

```ts
// src/growthLoop.ts
import { readFile, writeFile } from "node:fs/promises";
import { config } from "./config.js";
import type { WorkspaceContext } from "./context.js";
import { readStoredStateJson, writeStateJson } from "./lib/storage.js";
import type { RevenueDecision, RevenueSnapshot } from "./revenue/types.js";
import type { BacklogResult } from "./backlog.js";

const GROWTH_LOOP_STATE_FILE = "growth-loop-state.json";

export type GrowthLoopOutcome =
  | ({ type: "marketing" } & BacklogResult)
  | { type: "marketing_skipped"; reason: string }
  | { type: "sales"; leadsAssessed: number; outreachCreated: number; outreachReused: number }
  | { type: "no_owner"; note: string }
  | { type: "no_action" };

export interface GrowthLoopState {
  runId: string;
  startedAt: string;
  completedAt: string;
  updatedAt: string;
  snapshot: RevenueSnapshot;
  decision: RevenueDecision;
  outcome: GrowthLoopOutcome;
}

function localFile(ctx: WorkspaceContext): URL {
  return new URL(GROWTH_LOOP_STATE_FILE, ctx.paths.root);
}

export async function saveGrowthLoopState(ctx: WorkspaceContext, state: GrowthLoopState): Promise<void> {
  if (config.dataSource === "github") {
    await writeStateJson(ctx, GROWTH_LOOP_STATE_FILE, state);
    return;
  }
  await writeFile(localFile(ctx), `${JSON.stringify(state, null, 2)}\n`);
}

export async function getGrowthLoopState(ctx: WorkspaceContext): Promise<GrowthLoopState | null> {
  try {
    if (config.dataSource === "github") {
      return await readStoredStateJson<GrowthLoopState | null>(ctx, GROWTH_LOOP_STATE_FILE, null);
    }
    return JSON.parse(await readFile(localFile(ctx), "utf-8")) as GrowthLoopState;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npm test -- src/growthLoop.test.ts`
Expected: PASS (2 testes).

- [ ] **Step 5: Commit**

```bash
git add src/growthLoop.ts src/growthLoop.test.ts
git commit -m "feat: persistência de growth-loop-state.json (padrão dual de sales/state.ts)"
```

---

### Task 8: `src/backlog.ts` — extrair `replenishContentBacklog` + estampar proveniência

**Files:**
- Modify: `src/backlog.ts`
- Test: `src/backlog.test.ts`

**Interfaces:**
- Consumes: `GrowthLoopProvenance` (Task 2), `GenerateContentBacklogOptions.steering` (Task 3), `runMarketingDirectorBacklog(ctx, options, causedBy?)` (Task 4).
- Produces: `replenishContentBacklog(ctx, options, onEvent?)` — consumido por Task 9 (`growthLoopRuntime.ts`).

- [ ] **Step 1: Escrever o teste que falha**

Adicionar ao final de `src/backlog.test.ts`:

```ts
import { replenishContentBacklog } from "./backlog.js";

test("replenishContentBacklog ignora o gate de minimumPendingTopics — gera mesmo com calendário cheio", async () => {
  const workspace = baseWorkspace({ contentStrategy: { minimumPendingTopics: 1, replenishAmount: 5 } });
  const { ctx, cleanup } = await contextWithCalendar(workspace, [
    { tema: "Já tem de sobra", palavraChaveAlvo: "sobra", publicado: false },
  ]);
  try {
    const result = await replenishContentBacklog(ctx, {
      count: 3,
      generate: async () => [opportunity({ tema: "Pauta do Growth Loop", palavraChaveAlvo: "growth loop" })],
    });
    assert.equal(result.generated, 1);
    assert.equal(await countPendingTopics(ctx), 2);
  } finally {
    await cleanup();
  }
});

test("replenishContentBacklog estampa growthLoopMeta nas pautas aceitas", async () => {
  const workspace = baseWorkspace({ contentStrategy: { minimumPendingTopics: 1, replenishAmount: 5 } });
  const { ctx, cleanup } = await contextWithCalendar(workspace, []);
  try {
    await replenishContentBacklog(ctx, {
      count: 3,
      growthLoopMeta: { bottleneck: "traffic", action: "create_content", runId: "run-abc" },
      generate: async () => [opportunity({ tema: "Pauta do Growth Loop", palavraChaveAlvo: "growth loop" })],
    });
    const all = await getAllTopics(ctx);
    assert.deepEqual(all[0]?.growthLoop, { bottleneck: "traffic", action: "create_content", runId: "run-abc" });
  } finally {
    await cleanup();
  }
});

test("replenishContentBacklog sem growthLoopMeta não estampa nada — comportamento atual não muda", async () => {
  const workspace = baseWorkspace({ contentStrategy: { minimumPendingTopics: 1, replenishAmount: 5 } });
  const { ctx, cleanup } = await contextWithCalendar(workspace, []);
  try {
    await replenishContentBacklog(ctx, {
      count: 3,
      generate: async () => [opportunity({ tema: "Pauta comum", palavraChaveAlvo: "comum" })],
    });
    const all = await getAllTopics(ctx);
    assert.equal(all[0]?.growthLoop, undefined);
  } finally {
    await cleanup();
  }
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npm test -- src/backlog.test.ts`
Expected: FAIL — `replenishContentBacklog` não existe.

- [ ] **Step 3: Implementar**

No topo de `src/backlog.ts`, junto aos imports já existentes, adicionar:

```ts
import type { GrowthLoopProvenance } from "./revenue/types.js";
import type { NewTopicInput } from "./contentCalendar.js";
```

Depois, reescrever o arquivo a partir da linha do `EnsureContentBacklogOptions` até o final:

```ts
export interface EnsureContentBacklogOptions {
  generate?: (ctx: WorkspaceContext, options: GenerateContentBacklogOptions) => Promise<ContentOpportunity[]>;
}

export interface ReplenishContentBacklogOptions {
  count: number;
  /** Texto livre do Revenue Director injetado no prompt do Marketing Director. */
  steering?: string;
  /** Proveniência estruturada — estampada em cada oportunidade aceita antes de persistir. */
  growthLoopMeta?: GrowthLoopProvenance;
  /** `GrowthLoopState.runId`, repassado como `causedBy` até o trace do Harness. */
  causedBy?: string;
  generate?: (ctx: WorkspaceContext, options: GenerateContentBacklogOptions) => Promise<ContentOpportunity[]>;
}

async function generateThroughHarness(
  ctx: WorkspaceContext,
  options: GenerateContentBacklogOptions,
  causedBy?: string,
): Promise<ContentOpportunity[]> {
  const result = await runMarketingDirectorBacklog(ctx, options, causedBy);
  return result.opportunities;
}

/**
 * Gera, valida e persiste novas pautas — sem decidir SE deve gerar. Quem
 * chama decide o motivo (calendário baixo, via `ensureContentBacklog`, ou
 * gargalo diagnosticado pelo Revenue Director, via o Loop de Crescimento) e
 * o `count`. NUNCA lança por falha do Marketing Director — qualquer falha
 * vira um evento "error" e um `BacklogResult.error`.
 */
export async function replenishContentBacklog(
  ctx: WorkspaceContext,
  options: ReplenishContentBacklogOptions,
  onEvent?: OnEvent,
): Promise<BacklogResult> {
  const pendingBefore = await countPendingTopics(ctx);

  emit(onEvent, {
    agent: "marketing-director", status: "working",
    message: `Gerando até ${options.count} pauta(s) via Agent Harness...`,
  });

  try {
    const [allTopics, history] = await Promise.all([getAllTopics(ctx), getHistory(ctx)]);
    const existingThemes = allTopics.map((t) => t.tema);
    const existingKeywords = allTopics.map((t) => t.palavraChaveAlvo);
    const publishedTitles = history.map((h) => h.titulo);

    const generateOptions: GenerateContentBacklogOptions = {
      count: options.count, existingThemes, existingKeywords, publishedTitles, steering: options.steering,
    };
    const opportunities = options.generate
      ? await options.generate(ctx, generateOptions)
      : await generateThroughHarness(ctx, generateOptions, options.causedBy);

    emit(onEvent, { agent: "marketing-director", status: "working", message: `Identificou ${opportunities.length} oportunidade(s) de conteúdo.` });

    const { accepted, discardedDuplicates, discardedForbidden, discardedInvalid } = validateOpportunities(opportunities, {
      existingThemes, existingKeywords, publishedTitles,
      forbiddenTerms: ctx.workspace.brand.forbiddenTerms ?? [],
      maxCount: options.count,
    });

    const stamped: NewTopicInput[] = options.growthLoopMeta
      ? accepted.map((o) => ({ ...o, growthLoop: options.growthLoopMeta }))
      : accepted;
    await addTopics(ctx, stamped);
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

/**
 * Garante que o calendário sempre tenha pautas suficientes para o pipeline
 * seguir rodando. Decide SE deve reabastecer (calendário abaixo do mínimo
 * configurado); quem gera/valida/persiste é `replenishContentBacklog`.
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
    message: `Backlog com ${pendingBefore} tópico(s) pendente(s) (mínimo: ${strategy.minimumPendingTopics}) — analisando contexto do workspace via Agent Harness...`,
  });

  return replenishContentBacklog(ctx, { count: strategy.replenishAmount, generate: options.generate }, onEvent);
}
```

Também é preciso adicionar o import de `runMarketingDirectorBacklog` (já existe no topo do arquivo) e remover o antigo `generateThroughHarness`/corpo duplicado de `ensureContentBacklog` que ficou no arquivo original — o bloco acima já é a versão final e substitui tudo entre `EnsureContentBacklogOptions` e o final do arquivo.

Note que a segunda mensagem de evento ("Backlog com N tópico(s) pendente(s)...") agora é emitida por `ensureContentBacklog` antes de chamar `replenishContentBacklog`, que por sua vez emite sua própria mensagem "Gerando até N pauta(s)...". Isso adiciona um evento a mais na sequência quando `ensureContentBacklog` aciona a geração — os testes de `backlog.test.ts` que verificam `events.some(...)` continuam passando porque usam `.some()` (não checam a lista exata de eventos), mas rode o Step 4 pra confirmar.

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npm test -- src/backlog.test.ts`
Expected: PASS — todos os testes, incluindo os 6 já existentes e os 3 novos desta task.

- [ ] **Step 5: Rodar o build**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/backlog.ts src/backlog.test.ts
git commit -m "refactor(backlog): extrai replenishContentBacklog reutilizável pelo Growth Loop"
```

---

### Task 9: `src/harness/growthLoopRuntime.ts` — o orquestrador

**Files:**
- Create: `src/harness/growthLoopRuntime.ts`
- Test: `src/harness/growthLoopRuntime.test.ts`

**Interfaces:**
- Consumes: `runRevenueDirector` (`src/harness/revenueDirectorRuntime.ts`), `replenishContentBacklog` (Task 8), `runWorkspaceSalesCopilot`/`SalesPipelineRunResult` (Task 6), `getAllTopics` (`src/contentCalendar.ts`), `saveGrowthLoopState`/`GrowthLoopState`/`GrowthLoopOutcome` (Task 7).
- Produces: `routeDecision(decision)`, `marketingAlreadyHandled(ctx, decision)`, `runGrowthLoop(ctx, onEvent?, options?)` — consumido por Task 10 (`scripts/runGrowthLoop.ts`).

- [ ] **Step 1: Escrever o teste que falha**

Criar `src/harness/growthLoopRuntime.test.ts`:

```ts
// src/harness/growthLoopRuntime.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import { buildWorkspaceContext } from "../context.js";
import type { MarketingWorkspace } from "../workspace.js";
import type { SecretProvider } from "../lib/secrets.js";
import { createTempWorkspace } from "../testing/tempWorkspace.js";
import { routeDecision, runGrowthLoop } from "./growthLoopRuntime.js";
import { getAllTopics } from "../contentCalendar.js";
import type { RevenueDecision } from "../revenue/types.js";
import type { SalesPipelineRunResult } from "../sales/pipeline.js";
import type { ContentOpportunity } from "../lib/marketingDirector.js";

function baseWorkspace(): MarketingWorkspace {
  return {
    id: "acme", name: "Acme", active: true,
    brand: { name: "Acme", description: "d", toneOfVoice: "t", targetAudience: [], competitors: [] },
    goals: { primary: "leads" },
    channels: { blog: true, instagram: false, linkedin: false },
    integrations: { siteUrl: "https://acme.test", cms: { provider: "nextassist", apiUrl: "https://api.acme.test" } },
    autonomy: { mode: "copilot" },
    secrets: { required: [] },
  };
}

function fakeSecrets(): SecretProvider {
  return { async get() { return undefined; } };
}

function decision(overrides: Partial<RevenueDecision> = {}): RevenueDecision {
  return {
    objective: "increase_paying_customers", bottleneck: "none", action: "do_nothing",
    priority: "low", reason: "sem gargalo", evidence: [], requiresHumanApproval: false,
    ...overrides,
  };
}

test("routeDecision: create_content e improve_cta vão para marketing", () => {
  assert.equal(routeDecision(decision({ bottleneck: "traffic", action: "create_content" })).owner, "marketing");
  assert.equal(routeDecision(decision({ bottleneck: "trial_conversion", action: "improve_cta" })).owner, "marketing");
});

test("routeDecision: prioritize_hot_leads e improve_sales_conversion vão para sales", () => {
  assert.equal(routeDecision(decision({ bottleneck: "sales_followup", action: "prioritize_hot_leads" })).owner, "sales");
  assert.equal(routeDecision(decision({ bottleneck: "sales_conversion", action: "improve_sales_conversion" })).owner, "sales");
});

test("routeDecision: improve_activation e do_nothing não têm dono", () => {
  const activation = routeDecision(decision({ bottleneck: "activation", action: "improve_activation" }));
  const none = routeDecision(decision({ bottleneck: "none", action: "do_nothing" }));
  assert.equal(activation.owner, "none");
  assert.equal(none.owner, "none");
});

test("routeDecision: steering inclui o motivo e a evidência da decisão", () => {
  const route = routeDecision(decision({ bottleneck: "traffic", action: "create_content", reason: "pouco tráfego orgânico", evidence: ["10 visitas"] }));
  assert.equal(route.owner, "marketing");
  if (route.owner === "marketing") {
    assert.match(route.steering, /pouco tráfego orgânico/);
    assert.match(route.steering, /10 visitas/);
  }
});

test("runGrowthLoop roteia para marketing, estampa growthLoop e persiste o estado", async () => {
  const temp = await createTempWorkspace("acme", { "content-calendar.json": { topicos: [] } });
  try {
    const ctx = await buildWorkspaceContext(baseWorkspace(), fakeSecrets(), { workspacesRoot: temp.root, requireAiProvider: false });
    const fakeGenerate = async (): Promise<ContentOpportunity[]> => [
      { tema: "Pauta do loop", palavraChaveAlvo: "loop", reason: "r", priority: "high", source: "other" },
    ];

    const state = await runGrowthLoop(ctx, undefined, {
      revenueDecision: decision({ bottleneck: "traffic", action: "create_content" }),
      revenueSnapshot: { visits: 5, trials: 0, activated: 0, customers: 0, hotLeads: 0, pendingSalesApprovals: 0, visitToTrialRate: 0, trialToActivationRate: 0, activationToCustomerRate: 0 },
      generate: fakeGenerate,
    });

    assert.equal(state.outcome.type, "marketing");
    if (state.outcome.type === "marketing") assert.equal(state.outcome.generated, 1);
    assert.ok(state.runId);

    const topics = await getAllTopics(ctx);
    assert.equal(topics[0]?.growthLoop?.runId, state.runId);
    assert.equal(topics[0]?.growthLoop?.bottleneck, "traffic");
  } finally {
    await temp.cleanup();
  }
});

test("runGrowthLoop não gera de novo quando já existe pauta pendente pro mesmo bottleneck/action", async () => {
  const temp = await createTempWorkspace("acme", {
    "content-calendar.json": { topicos: [{ tema: "Já gerada", palavraChaveAlvo: "k", publicado: false, growthLoop: { bottleneck: "traffic", action: "create_content", runId: "run-antigo" } }] },
  });
  try {
    const ctx = await buildWorkspaceContext(baseWorkspace(), fakeSecrets(), { workspacesRoot: temp.root, requireAiProvider: false });
    let generateCalls = 0;
    const fakeGenerate = async (): Promise<ContentOpportunity[]> => { generateCalls++; return []; };

    const state = await runGrowthLoop(ctx, undefined, {
      revenueDecision: decision({ bottleneck: "traffic", action: "create_content" }),
      revenueSnapshot: { visits: 5, trials: 0, activated: 0, customers: 0, hotLeads: 0, pendingSalesApprovals: 0, visitToTrialRate: 0, trialToActivationRate: 0, activationToCustomerRate: 0 },
      generate: fakeGenerate,
    });

    assert.equal(generateCalls, 0);
    assert.equal(state.outcome.type, "marketing_skipped");
  } finally {
    await temp.cleanup();
  }
});

test("runGrowthLoop roteia para sales", async () => {
  const temp = await createTempWorkspace("acme");
  try {
    const ctx = await buildWorkspaceContext(baseWorkspace(), fakeSecrets(), { workspacesRoot: temp.root, requireAiProvider: false });
    const fakeComposeSales = async (): Promise<SalesPipelineRunResult> => ({ entries: [], outreachCreated: 2, outreachReused: 1 });

    const state = await runGrowthLoop(ctx, undefined, {
      revenueDecision: decision({ bottleneck: "sales_followup", action: "prioritize_hot_leads" }),
      revenueSnapshot: { visits: 5, trials: 0, activated: 0, customers: 0, hotLeads: 3, pendingSalesApprovals: 1, visitToTrialRate: 0, trialToActivationRate: 0, activationToCustomerRate: 0 },
      composeSales: fakeComposeSales,
    });

    assert.deepEqual(state.outcome, { type: "sales", leadsAssessed: 0, outreachCreated: 2, outreachReused: 1 });
  } finally {
    await temp.cleanup();
  }
});

test("runGrowthLoop não aciona ninguém para activation/do_nothing", async () => {
  const temp = await createTempWorkspace("acme");
  try {
    const ctx = await buildWorkspaceContext(baseWorkspace(), fakeSecrets(), { workspacesRoot: temp.root, requireAiProvider: false });

    const stateActivation = await runGrowthLoop(ctx, undefined, {
      revenueDecision: decision({ bottleneck: "activation", action: "improve_activation" }),
      revenueSnapshot: { visits: 5, trials: 0, activated: 0, customers: 0, hotLeads: 0, pendingSalesApprovals: 0, visitToTrialRate: 0, trialToActivationRate: 0, activationToCustomerRate: 0 },
    });
    assert.equal(stateActivation.outcome.type, "no_owner");

    const stateNone = await runGrowthLoop(ctx, undefined, {
      revenueDecision: decision({ bottleneck: "none", action: "do_nothing" }),
      revenueSnapshot: { visits: 5, trials: 0, activated: 0, customers: 0, hotLeads: 0, pendingSalesApprovals: 0, visitToTrialRate: 0, trialToActivationRate: 0, activationToCustomerRate: 0 },
    });
    assert.equal(stateNone.outcome.type, "no_action");
  } finally {
    await temp.cleanup();
  }
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npm test -- src/harness/growthLoopRuntime.test.ts`
Expected: FAIL — `Cannot find module './growthLoopRuntime.js'`.

- [ ] **Step 3: Implementar**

Criar `src/harness/growthLoopRuntime.ts`:

```ts
// src/harness/growthLoopRuntime.ts
import { randomUUID } from "node:crypto";
import type { WorkspaceContext } from "../context.js";
import type { OnEvent } from "../pipelineEvents.js";
import { getAllTopics } from "../contentCalendar.js";
import { replenishContentBacklog } from "../backlog.js";
import { runWorkspaceSalesCopilot, type SalesPipelineRunResult } from "../sales/pipeline.js";
import { runRevenueDirector } from "./revenueDirectorRuntime.js";
import { saveGrowthLoopState, type GrowthLoopOutcome, type GrowthLoopState } from "../growthLoop.js";
import type { RevenueDecision, RevenueSnapshot } from "../revenue/types.js";

const GROWTH_LOOP_CONTENT_COUNT = 3; // pautas por rodada quando acionado por gargalo — não é reabastecimento de calendário, é correção pontual

export type GrowthLoopRoute =
  | { owner: "marketing"; steering: string }
  | { owner: "sales"; steering: string }
  | { owner: "none"; note: string };

function buildSteering(decision: RevenueDecision): string {
  return `Gargalo identificado: ${decision.bottleneck}. Ação recomendada: ${decision.action}. Motivo: ${decision.reason} Evidência: ${decision.evidence.join("; ")}.`;
}

export function routeDecision(decision: RevenueDecision): GrowthLoopRoute {
  const steering = buildSteering(decision);
  switch (decision.action) {
    case "create_content":
    case "improve_cta":
      return { owner: "marketing", steering };
    case "prioritize_hot_leads":
    case "improve_sales_conversion":
      return { owner: "sales", steering };
    case "improve_activation":
      return { owner: "none", note: "Não existe agente de ativação/onboarding no Harness ainda." };
    case "do_nothing":
      return { owner: "none", note: "Revenue Director não identificou gargalo prioritário." };
  }
}

/**
 * Idempotência do branch de Marketing: se já existe algum tópico pendente
 * (não publicado) no calendário gerado para este MESMO bottleneck+action,
 * não gera de novo. Checa direto no calendário — não no histórico de
 * `growth-loop-state.json` — porque depois de um `marketing_skipped` o
 * último estado persistido deixaria de referenciar o `runId` original das
 * pautas ainda pendentes. Assim que uma pauta gerada é publicada (ou
 * removida), ela para de bloquear novas rodadas.
 */
export async function marketingAlreadyHandled(ctx: WorkspaceContext, decision: RevenueDecision): Promise<boolean> {
  const allTopics = await getAllTopics(ctx);
  return allTopics.some(
    (t) => !t.publicado && t.growthLoop?.bottleneck === decision.bottleneck && t.growthLoop?.action === decision.action,
  );
}

export interface RunGrowthLoopOptions {
  /** Pontos de injeção para teste — evitam IA/rede real. Padrão: as implementações reais. */
  revenueDecision?: RevenueDecision;
  revenueSnapshot?: RevenueSnapshot;
  replenish?: typeof replenishContentBacklog;
  composeSales?: (ctx: WorkspaceContext, options: Parameters<typeof runWorkspaceSalesCopilot>[1]) => Promise<SalesPipelineRunResult>;
  generate?: Parameters<typeof replenishContentBacklog>[1]["generate"];
}

export async function runGrowthLoop(
  ctx: WorkspaceContext,
  onEvent?: OnEvent,
  options: RunGrowthLoopOptions = {},
): Promise<GrowthLoopState> {
  const runId = randomUUID();
  const startedAt = new Date().toISOString();

  let snapshot: RevenueSnapshot;
  let decision: RevenueDecision;
  if (options.revenueDecision && options.revenueSnapshot) {
    snapshot = options.revenueSnapshot;
    decision = options.revenueDecision;
  } else {
    const revenue = await runRevenueDirector(ctx);
    snapshot = revenue.snapshot;
    decision = revenue.decision;
  }

  const route = routeDecision(decision);
  const replenish = options.replenish ?? replenishContentBacklog;
  const composeSales = options.composeSales ?? runWorkspaceSalesCopilot;

  const outcome: GrowthLoopOutcome = await (async () => {
    if (route.owner === "marketing") {
      if (await marketingAlreadyHandled(ctx, decision)) {
        return { type: "marketing_skipped", reason: "Mesmo gargalo já tratado e pautas anteriores ainda pendentes." };
      }
      const growthLoopMeta = { bottleneck: decision.bottleneck, action: decision.action, runId };
      const result = await replenish(
        ctx,
        { count: GROWTH_LOOP_CONTENT_COUNT, steering: route.steering, growthLoopMeta, causedBy: runId, generate: options.generate },
        onEvent,
      );
      return { type: "marketing", ...result };
    }
    if (route.owner === "sales") {
      const { entries, outreachCreated, outreachReused } = await composeSales(ctx, { composeOutreach: true, steering: route.steering, causedBy: runId });
      return { type: "sales", leadsAssessed: entries.length, outreachCreated, outreachReused };
    }
    if (decision.action === "do_nothing") return { type: "no_action" };
    return { type: "no_owner", note: route.note };
  })();

  const state: GrowthLoopState = {
    runId, startedAt, completedAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    snapshot, decision, outcome,
  };
  await saveGrowthLoopState(ctx, state);
  return state;
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npm test -- src/harness/growthLoopRuntime.test.ts`
Expected: PASS (8 testes).

- [ ] **Step 5: Rodar a suíte inteira**

Run: `npm test`
Expected: PASS — todos os testes do repositório, incluindo os de todas as tasks anteriores.

- [ ] **Step 6: Rodar o build**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/harness/growthLoopRuntime.ts src/harness/growthLoopRuntime.test.ts
git commit -m "feat: orquestrador do Loop de Crescimento — routeDecision + runGrowthLoop"
```

---

### Task 10: `src/scripts/runGrowthLoop.ts` — entrypoint do workflow

**Files:**
- Create: `src/scripts/runGrowthLoop.ts`

**Interfaces:**
- Consumes: `runGrowthLoop` (Task 9), `loadWorkspace` (`src/workspace.ts`), `buildWorkspaceContext` (`src/context.ts`), `EnvSecretProvider` (`src/lib/secrets.ts`).

- [ ] **Step 1: Implementar**

Criar `src/scripts/runGrowthLoop.ts`, no mesmo formato de `src/scripts/reconcileReels.ts`/`src/index.ts`:

```ts
// src/scripts/runGrowthLoop.ts
//
// Entrypoint do Loop de Crescimento: roda o Revenue Director, roteia a
// decisão pra Marketing Director ou Sales Agent, e persiste o resultado.
// Nunca envia mensagem nem publica nada — só prepara trabalho para
// aprovação humana (ver docs/superpowers/specs/2026-09-16-growth-loop-design.md).
import { loadWorkspace } from "../workspace.js";
import { EnvSecretProvider } from "../lib/secrets.js";
import { buildWorkspaceContext } from "../context.js";
import { runGrowthLoop } from "../harness/growthLoopRuntime.js";

const workspaceId = process.env.WORKSPACE_ID ?? "nextassist";

try {
  const workspace = await loadWorkspace(workspaceId);
  const ctx = await buildWorkspaceContext(workspace, new EnvSecretProvider());
  const state = await runGrowthLoop(ctx, (event) => {
    console.log(`[${workspaceId}][${event.agent}] ${event.status}${event.message ? " — " + event.message : ""}`);
  });
  console.log(
    `[growth-loop] workspace=${workspaceId} runId=${state.runId} bottleneck=${state.decision.bottleneck} ` +
    `action=${state.decision.action} outcome=${state.outcome.type}`,
  );
  process.exit(0);
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[growth-loop] workspace=${workspaceId} erro:`, message);
  process.exit(1);
}
```

- [ ] **Step 2: Rodar o build**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 3: Testar manualmente contra um workspace real (dry run local)**

Run: `WORKSPACE_ID=nextassist npx tsx src/scripts/runGrowthLoop.ts`
Expected: imprime uma linha `[growth-loop] workspace=nextassist runId=... bottleneck=... action=... outcome=...` e sai com código 0. Requer `ANTHROPIC_API_KEY`/`OPENAI_API_KEY` no `.env` local (mesmo requisito de `npm run run`). Se não tiver as chaves configuradas localmente, pular este step manual e confiar no `npm test`/`npm run build` — o smoke test real acontece no `workflow_dispatch` da Task 11.

- [ ] **Step 4: Commit**

```bash
git add src/scripts/runGrowthLoop.ts
git commit -m "feat: entrypoint CLI do Loop de Crescimento (src/scripts/runGrowthLoop.ts)"
```

---

### Task 11: `.github/workflows/growth-loop.yml`

**Files:**
- Create: `.github/workflows/growth-loop.yml`

**Interfaces:**
- Consumes: `src/scripts/runGrowthLoop.ts` (Task 10), `src/scripts/mergeWorkspaceState.ts` (já existe, sem alteração).

- [ ] **Step 1: Implementar**

Criar `.github/workflows/growth-loop.yml`, espelhando a estrutura de `.github/workflows/daily-post.yml` (mesmos secrets — evita falha por segredo obrigatório ausente na validação de `buildWorkspaceContext`), com `DATA_SOURCE: github` adicionado e o `git add` restrito a `content-calendar.json` (único arquivo que este workflow sempre escreve em disco local, independente de `DATA_SOURCE` — ver spec item 9):

```yaml
name: Loop de Crescimento

on:
  schedule:
    - cron: "0 12 * * *" # 12:00 UTC — antes do post diário (13:18 UTC)
  workflow_dispatch:
    inputs:
      workspace_id:
        description: "Rodar só este workspace (vazio = todos os ativos)"
        required: false
        type: string

permissions:
  contents: write

jobs:
  list-workspaces:
    runs-on: ubuntu-latest
    outputs:
      workspaces: ${{ steps.list.outputs.workspaces }}
    steps:
      - uses: actions/checkout@v4
      - id: list
        env:
          WORKSPACE_ID_INPUT: ${{ github.event.inputs.workspace_id }}
        run: |
          if [ -n "$WORKSPACE_ID_INPUT" ]; then
            echo "workspaces=$(jq -nc --arg id "$WORKSPACE_ID_INPUT" '[$id]')" >> "$GITHUB_OUTPUT"
          else
            ids=$(for f in workspaces/*/workspace.json; do
              active=$(jq -r '.active' "$f")
              if [ "$active" = "true" ]; then jq -r '.id' "$f"; fi
            done | jq -R . | jq -sc .)
            echo "workspaces=$ids" >> "$GITHUB_OUTPUT"
          fi

  run-growth-loop:
    needs: list-workspaces
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false
      matrix:
        workspace: ${{ fromJson(needs.list-workspaces.outputs.workspaces) }}
    environment: ${{ matrix.workspace }}
    concurrency:
      group: growth-loop-${{ matrix.workspace }}
      cancel-in-progress: false
    steps:
      - name: Checkout do repositório
        uses: actions/checkout@v4

      - name: Configurar Node.js
        uses: actions/setup-node@v4
        with:
          node-version: "22"
          cache: "npm"

      - name: Instalar dependências
        run: npm ci

      - name: Rodar o Loop de Crescimento (Revenue Director aciona Marketing/Sales)
        env:
          WORKSPACE_ID: ${{ matrix.workspace }}
          DATA_SOURCE: github
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
          FIREBASE_WEB_API_KEY: ${{ secrets.FIREBASE_WEB_API_KEY }}
          FIREBASE_ADMIN_EMAIL: ${{ secrets.FIREBASE_ADMIN_EMAIL }}
          FIREBASE_ADMIN_PASSWORD: ${{ secrets.FIREBASE_ADMIN_PASSWORD }}
          FIREBASE_SERVICE_ACCOUNT_JSON: ${{ secrets.FIREBASE_SERVICE_ACCOUNT_JSON }}
          FIREBASE_STORAGE_BUCKET: ${{ secrets.FIREBASE_STORAGE_BUCKET }}
          GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY }}
          GEMINI_API_KEY_FALLBACK: ${{ secrets.GEMINI_API_KEY_FALLBACK }}
        run: npx tsx src/scripts/runGrowthLoop.ts

      - name: Commitar content-calendar.json atualizado
        if: always()
        env:
          TARGET_BRANCH: ${{ github.ref_name }}
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git add "workspaces/${{ matrix.workspace }}/content-calendar.json"
          if git diff --staged --quiet; then
            echo "Nada mudou no calendário — nenhum commit necessário."
            exit 0
          fi

          for tentativa in 1 2 3 4 5; do
            echo "Tentativa ${tentativa} de publicar o estado em ${TARGET_BRANCH}..."
            git fetch origin "$TARGET_BRANCH"
            npx tsx src/scripts/mergeWorkspaceState.ts "${{ matrix.workspace }}" "origin/$TARGET_BRANCH"
            git reset --soft "origin/$TARGET_BRANCH"
            git add "workspaces/${{ matrix.workspace }}/content-calendar.json"
            if git diff --cached --quiet; then
              echo "Estado já reconciliado no remoto — nada a publicar."
              exit 0
            fi
            git commit -q -m "chore: pautas do Loop de Crescimento (${{ matrix.workspace }}) [skip ci]"
            if git push origin "HEAD:$TARGET_BRANCH"; then
              exit 0
            fi
            sleep 5
          done

          echo "Não foi possível publicar o estado após 5 tentativas."
          exit 1
```

- [ ] **Step 2: Validar o YAML**

Run: `npx yaml-lint .github/workflows/growth-loop.yml 2>/dev/null || node -e "require('js-yaml') ? console.log('sem yaml-lint disponível, pulando') : null" 2>/dev/null; cat .github/workflows/growth-loop.yml | python3 -c "import sys, yaml; yaml.safe_load(sys.stdin)" 2>/dev/null && echo "YAML válido" || echo "checar sintaxe manualmente"`
Expected: "YAML válido" (ou, se nenhuma ferramenta de lint estiver disponível no ambiente, revisar visualmente a indentação contra `daily-post.yml`).

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/growth-loop.yml
git commit -m "ci: workflow do Loop de Crescimento (1x/dia, antes do post diário)"
```

**Nota para quem for mergear:** antes do primeiro `workflow_dispatch` real, confirmar nos GitHub Environment secrets do workspace que `FIREBASE_SERVICE_ACCOUNT_JSON`/`FIREBASE_STORAGE_BUCKET` estão configurados — sem eles, `saveGrowthLoopState`/`saveSalesState`/`saveHarnessTrace` falham em modo `DATA_SOURCE=github` (mesmo requisito que já vale hoje para `/api/sales` e `/api/harness/traces` funcionarem no painel hospedado).

---

### Task 12: `server.ts` — expõe `growthLoop` em `GET /api/revenue`

**Files:**
- Modify: `src/server.ts`

**Interfaces:**
- Consumes: `getGrowthLoopState` (Task 7).

- [ ] **Step 1: Implementar**

Em `src/server.ts`, adicionar o import:

```ts
import { getGrowthLoopState } from "./growthLoop.js";
```

E atualizar o handler de `GET /api/revenue`:

```ts
app.get("/api/revenue", asyncHandler(async (req, res) => {
  const workspaceId = requireWorkspaceId(req, res);
  if (!workspaceId) return;
  const ctx = await contextFor(workspaceId);
  const result = await runRevenueDirector(ctx);
  const growthLoop = await getGrowthLoopState(ctx);
  res.json({
    ...result,
    growthLoop,
    monthlyCustomerTarget: ctx.workspace.goals.monthlyCustomerTarget ?? null,
  });
}));
```

- [ ] **Step 2: Rodar o build**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 3: Testar manualmente (smoke test local, se houver `.env` configurado)**

Run: `npm run dev` (ou o script equivalente de desenvolvimento do `server.ts` — conferir `package.json`), depois em outro terminal: `curl -s "http://localhost:4173/api/revenue?workspaceId=nextassist" | jq '.growthLoop'`
Expected: `null` (workspace ainda sem nenhuma rodada do Loop de Crescimento persistida) — confirma que o campo aparece na resposta sem quebrar o endpoint.

- [ ] **Step 4: Commit**

```bash
git add src/server.ts
git commit -m "feat(api): GET /api/revenue inclui o último resultado do Loop de Crescimento"
```

---

### Task 13: Painel — card do Loop de Crescimento

**Files:**
- Modify: `web/src/types/api.ts`
- Modify: `web/src/views/dashboard/RevenuePanel.tsx`
- Create: `web/src/views/dashboard/RevenuePanel.test.tsx`

**Interfaces:**
- Consumes: `RevenueDashboardResponse.growthLoop` (via `GET /api/revenue`, Task 12).

- [ ] **Step 1: Escrever o teste que falha**

Criar `web/src/views/dashboard/RevenuePanel.test.tsx`, seguindo o padrão de `SalesPanel.test.tsx`:

```tsx
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { WorkspaceProvider } from "../../hooks/useWorkspace";
import { RevenuePanel } from "./RevenuePanel";

const BASE_RESPONSE = {
  runId: "run-1",
  monthlyCustomerTarget: null,
  snapshot: { visits: 12, trials: 2, activated: 1, customers: 0, hotLeads: 1, pendingSalesApprovals: 0, visitToTrialRate: 0.16, trialToActivationRate: 0.5, activationToCustomerRate: 0 },
  decision: { objective: "increase_paying_customers", bottleneck: "traffic", action: "create_content", priority: "medium", reason: "pouco tráfego", evidence: ["12 visitas"], requiresHumanApproval: false },
};

function stubFetch(response: unknown) {
  vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/api/workspaces")) return Promise.resolve({ ok: true, json: async () => [{ id: "nextassist", name: "NextAssist" }] });
    if (url.includes("/api/revenue")) return Promise.resolve({ ok: true, json: async () => response });
    return Promise.resolve({ ok: true, json: async () => ({}) });
  }));
}

describe("RevenuePanel", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sem growthLoop ainda persistido, não mostra a seção do loop", async () => {
    stubFetch({ ...BASE_RESPONSE, growthLoop: null });
    render(<WorkspaceProvider><RevenuePanel /></WorkspaceProvider>);

    expect(await screen.findByText("Revenue Director")).toBeInTheDocument();
    expect(screen.queryByText("Loop de Crescimento")).not.toBeInTheDocument();
  });

  it("com growthLoop preparado pelo Marketing Director, mostra a cadeia completa", async () => {
    stubFetch({
      ...BASE_RESPONSE,
      growthLoop: {
        runId: "gl-1", startedAt: "2026-09-16T12:00:00.000Z", completedAt: "2026-09-16T12:00:05.000Z", updatedAt: "2026-09-16T12:00:05.000Z",
        snapshot: BASE_RESPONSE.snapshot, decision: BASE_RESPONSE.decision,
        outcome: { type: "marketing", skipped: false, pendingBefore: 1, generated: 3, discardedDuplicates: 0, discardedForbidden: 0, discardedInvalid: 0, pendingAfter: 4, error: null },
      },
    });
    render(<WorkspaceProvider><RevenuePanel /></WorkspaceProvider>);

    expect(await screen.findByText("Loop de Crescimento")).toBeInTheDocument();
    expect(screen.getByText(/Marketing Director preparou 3 pauta/)).toBeInTheDocument();
  });

  it("com growthLoop roteado pro Sales Agent, mostra rascunhos criados e reaproveitados", async () => {
    stubFetch({
      ...BASE_RESPONSE,
      decision: { ...BASE_RESPONSE.decision, bottleneck: "sales_followup", action: "prioritize_hot_leads" },
      growthLoop: {
        runId: "gl-2", startedAt: "2026-09-16T12:00:00.000Z", completedAt: "2026-09-16T12:00:05.000Z", updatedAt: "2026-09-16T12:00:05.000Z",
        snapshot: BASE_RESPONSE.snapshot, decision: { ...BASE_RESPONSE.decision, bottleneck: "sales_followup", action: "prioritize_hot_leads" },
        outcome: { type: "sales", leadsAssessed: 5, outreachCreated: 2, outreachReused: 1 },
      },
    });
    render(<WorkspaceProvider><RevenuePanel /></WorkspaceProvider>);

    expect(await screen.findByText("Loop de Crescimento")).toBeInTheDocument();
    expect(screen.getByText(/2 rascunho\(s\) novo\(s\)/)).toBeInTheDocument();
    expect(screen.getByText(/1 reaproveitado\(s\)/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `cd web && npx vitest run src/views/dashboard/RevenuePanel.test.tsx`
Expected: FAIL — erro de tipo (`growthLoop` não existe em `RevenueDashboardResponse`) e/ou os textos não são encontrados no DOM.

- [ ] **Step 3: Implementar os tipos**

Em `web/src/types/api.ts`, adicionar após `RevenueDashboardResponse`:

```ts
export interface BacklogOutcome {
  type: "marketing";
  skipped: boolean;
  pendingBefore: number;
  generated: number;
  discardedDuplicates: number;
  discardedForbidden: number;
  discardedInvalid: number;
  pendingAfter: number;
  error: string | null;
}

export type GrowthLoopOutcome =
  | BacklogOutcome
  | { type: "marketing_skipped"; reason: string }
  | { type: "sales"; leadsAssessed: number; outreachCreated: number; outreachReused: number }
  | { type: "no_owner"; note: string }
  | { type: "no_action" };

export interface GrowthLoopState {
  runId: string;
  startedAt: string;
  completedAt: string;
  updatedAt: string;
  snapshot: RevenueSnapshot;
  decision: RevenueDecision;
  outcome: GrowthLoopOutcome;
}
```

E atualizar `RevenueDashboardResponse`:

```ts
export interface RevenueDashboardResponse {
  runId: string;
  monthlyCustomerTarget: number | null;
  snapshot: RevenueSnapshot;
  decision: RevenueDecision;
  growthLoop: GrowthLoopState | null;
}
```

- [ ] **Step 4: Implementar o componente**

Em `web/src/views/dashboard/RevenuePanel.tsx`, adicionar uma função de renderização do outcome e a seção nova, logo após o bloco de "Evidências":

```tsx
function outcomeLabel(outcome: GrowthLoopOutcome): string {
  switch (outcome.type) {
    case "marketing":
      return `Marketing Director preparou ${outcome.generated} pauta(s) nova(s) direcionada(s) ao gargalo.`;
    case "marketing_skipped":
      return `Marketing Director não precisou agir — ${outcome.reason}`;
    case "sales":
      return `Sales Agent preparou ${outcome.outreachCreated} rascunho(s) novo(s) e reaproveitou ${outcome.outreachReused} reaproveitado(s) — aguardando aprovação.`;
    case "no_owner":
      return outcome.note;
    case "no_action":
      return "Nenhuma ação necessária nesta rodada.";
  }
}
```

E, dentro do `return` de `RevenuePanel`, após o bloco `{decision.evidence.length ? (...) : null}`:

```tsx
      {data.growthLoop ? (
        <section>
          <h3>Loop de Crescimento</h3>
          <p>{outcomeLabel(data.growthLoop.outcome)}</p>
          <p><small>Última rodada: {new Date(data.growthLoop.completedAt).toLocaleString("pt-BR")}</small></p>
        </section>
      ) : null}
```

E importar o tipo novo no topo do arquivo:

```tsx
import type { GrowthLoopOutcome, RevenueDashboardResponse } from "../../types/api";
```

- [ ] **Step 5: Rodar e confirmar que passa**

Run: `cd web && npx vitest run src/views/dashboard/RevenuePanel.test.tsx`
Expected: PASS (3 testes).

- [ ] **Step 6: Rodar a suíte inteira do frontend**

Run: `cd web && npx vitest run`
Expected: PASS — todos os testes do `web/`, incluindo `App.test.tsx` (garante que a rota que renderiza `RevenuePanel` continua montando sem erro).

- [ ] **Step 7: Build do frontend**

Run: `cd web && npm run build`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add web/src/types/api.ts web/src/views/dashboard/RevenuePanel.tsx web/src/views/dashboard/RevenuePanel.test.tsx
git commit -m "feat(painel): card do Loop de Crescimento em RevenuePanel"
```

---

## Self-Review

**Cobertura do spec:** Contexto/Objetivo → Tasks 1–13 no conjunto. Fluxo/Tabela de roteamento → Task 9 (`routeDecision`). Item 1 (backlog.ts) → Task 8. Item 2 (marketingDirector.ts) → Task 3 (persona/steering) + Task 2 (proveniência, versão simplificada — ver nota abaixo). Item 3 (sales/pipeline.ts) → Task 6. Item 4 (salesOutreachSkills/salesAgentRuntime) → Task 5. Item 4a (causedBy) → Task 1, 4, 5. Item 5 (buildSteering) → Task 9. Item 6 (growthLoopRuntime.ts) → Task 9. Item 7 (growthLoop.ts) → Task 7. Item 8 (script) → Task 10. Item 9 (workflow) → Task 11. Item 10 (server.ts) → Task 12. Item 11 (painel) → Task 13. Critérios de aceite → cobertos pelos testes de cada task; `npm run build`/`npm test` aparecem como step explícito nas tasks 8, 9, 12, 13.

**Desvio documentado do spec:** o spec (seção "Mudanças por componente", item 2) descreve `growthLoop` como campo tanto de `ContentOpportunity` quanto de `CalendarTopic`. Este plano simplifica para estampar `growthLoop` apenas no limite de persistência (`NewTopicInput`/`CalendarTopic`, Task 2 + Task 8), sem adicionar o campo a `ContentOpportunity` (que é só o formato efêmero de saída do LLM). O resultado observável é idêntico — `marketingAlreadyHandled` (Task 9) só precisa ler `CalendarTopic.growthLoop`, que este plano garante — com uma superfície de tipos menor.

**Varredura de placeholders:** nenhum "TBD"/"implementar depois" encontrado; todo step de código tem o código completo, não uma referência a outro step.

**Consistência de tipos:** `GrowthLoopProvenance` (Task 2) usado identicamente em `contentCalendar.ts`, `backlog.ts` (Task 8) e `growthLoopRuntime.ts` (Task 9). `SalesPipelineRunResult` (Task 6) é o tipo de retorno consumido por `growthLoopRuntime.ts` (Task 9) e pelo card do painel via `outreachCreated`/`outreachReused` (Task 13). `GrowthLoopOutcome`/`GrowthLoopState` (Task 7) são os mesmos tipos persistidos (Task 9), expostos pela API (Task 12) e espelhados manualmente no frontend (Task 13, seguindo a convenção já usada pelo arquivo pra `RevenueDecision`/`RevenueSnapshot`).

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-09-16-growth-loop.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
