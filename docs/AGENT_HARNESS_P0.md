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
- `src/harness/skills/salesSkills.ts`: primeira skill comercial determinística.
- `src/harness/salesAgentRuntime.ts`: Sales Agent em modo copilot/read-only.
- `src/sales/types.ts`: contratos de lead, sinais e recomendação comercial.

## Fluxo atual

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

## Sales Agent P0

O Sales Agent começa em modo copilot para evitar automações comerciais prematuras.

```text
Lead signals
  ↓
Sales Agent Harness
  ↓
sales.assess_lead
  ↓
score + intent + next action
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

Saídas:

- `low` → nurture
- `medium` → invite_trial / offer_help
- `high` → request_human_contact
- `customer` → customer_success

A pontuação é determinística e auditável nesta fase. O LLM poderá depois interpretar contexto e redigir abordagens, mas não deverá ser a única fonte da pontuação comercial.

## Próximas etapas

1. Conectar o Sales Agent aos eventos reais de conversão do workspace.
2. Criar `sales.compose_outreach` para gerar abordagem contextual.
3. Criar `sales.send_*` com `requiresApproval: true`.
4. Persistir traces do Harness por workspace.
5. Adicionar Revenue Director acima de Marketing + Sales.
6. Evoluir decisões do Marketing Director além de `create_article` para `update_article`, `change_cta`, `create_social` e `do_nothing`.

## Regra arquitetural

LLM decide dentro de limites. O Harness controla permissões, ferramentas, budget, aprovação e auditoria.
