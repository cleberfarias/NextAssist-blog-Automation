# Agent Harness P0

## Objetivo

Evoluir o NextAssist Blog Automation de um pipeline multiagente linear para uma plataforma de agentes controlados por um harness compartilhado, sem quebrar o fluxo atual de publicação.

O Harness é responsável por autorização, budget, aprovação humana, tracing e execução de skills. Os agentes continuam focados em decisões de domínio.

## Componentes implementados nesta branch

- `src/harness/types.ts`: contratos do runtime, traces, budgets e skills.
- `src/harness/registry.ts`: registro explícito de skills.
- `src/harness/runtime.ts`: execução com allowlist, limite de steps/custo, approval e trace.
- `src/harness/skills/marketingDirectorSkills.ts`: adapter da skill existente de geração de backlog.
- `src/harness/marketingDirectorRuntime.ts`: Marketing Director executado através do Harness.
- `src/harness/skills/salesSkills.ts`: scoring comercial determinístico.
- `src/harness/skills/salesOutreachSkills.ts`: redação contextual de abordagem com IA, sem envio.
- `src/harness/salesAgentRuntime.ts`: Sales Agent em modo copilot/read-only.
- `src/sales/funnel.ts`: transforma eventos reais de conversão em leads comerciais, ligando anonymousId e userId.
- `src/sales/pipeline.ts`: analisa o funil real, classifica leads e opcionalmente gera abordagem para leads quentes.
- `src/sales/types.ts`: contratos de lead, sinais, assessment, outreach e pipeline.

## Marketing Director no Harness

```text
Pipeline
  ↓
ensureContentBacklog()
  ↓
Marketing Director Harness
  ↓
Policy / Allowlist
  ↓
Budget
  ↓
marketing.generate_content_backlog
  ↓
Marketing Director existente
  ↓
Search Console + Attribution + Performance
```

A regra de negócio do Marketing Director não foi reescrita. O Harness envolve a execução existente e passa a controlar como ela é executada.

## Sales Agent conectado ao funil real

```text
conversion-events.json
  ↓
anonymousId ↔ userId
  ↓
SalesLeadContext
  ↓
sales.assess_lead
  ↓
score + intent + nextAction
  ↓
[apenas lead high]
  ↓
sales.compose_outreach
  ↓
rascunho para aprovação humana
```

Sinais iniciais:

- site_visit
- pricing_view
- trial_started
- signup_completed
- first_order_created
- subscription_started
- whatsapp_click
- contact_submit

Saídas do scoring:

- `low` → nurture
- `medium` → invite_trial / offer_help
- `high` → request_human_contact
- `customer` → customer_success

A pontuação é determinística e auditável. O LLM não altera score nem estágio; ele é usado apenas para redigir a abordagem com base nos sinais já observados.

## Regras de segurança comercial

- `sales.compose_outreach` não envia nada.
- o rascunho sempre retorna `requiresHumanApproval: true`.
- o prompt proíbe inventar nome, empresa, telefone, e-mail, dor, desconto ou funcionalidade.
- nenhuma skill de envio está registrada neste P0.
- futuras skills `sales.send_email` / `sales.send_whatsapp` deverão usar `requiresApproval: true` no Harness.
- o pipeline gera abordagem automaticamente apenas para leads de alta intenção quando `composeOutreach` estiver habilitado.

## Próximas etapas

1. Persistir assessments e traces do Sales Agent por workspace.
2. Expor leads quentes + rascunhos no painel do Marketing AI Office.
3. Adicionar contatos reais/consentimento vindos do produto/CRM sem colocar PII em logs desnecessários.
4. Criar `sales.send_email` / `sales.send_whatsapp` com aprovação humana obrigatória.
5. Adicionar Revenue Director acima de Marketing + Sales.
6. Evoluir decisões do Marketing Director além de `create_article` para `update_article`, `change_cta`, `create_social` e `do_nothing`.

## Regra arquitetural

LLM decide dentro de limites. O Harness controla permissões, ferramentas, budget, aprovação e auditoria.
