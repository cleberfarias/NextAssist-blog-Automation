# Agent Harness — resumo da branch

Branch: `feat/agent-harness`

## Entregue

- Agent Harness runtime com allowlist de skills, budget, aprovação humana e tracing.
- Skill registry.
- Marketing Director atual migrado para execução através do Harness.
- Backlog continua compatível com o gerador injetável usado nos testes.
- Sales Agent P0 em modo copilot/read-only.
- Conversão de `conversion-events` reais em leads, ligando `anonymousId` e `userId`.
- Scoring comercial determinístico e auditável.
- `sales.compose_outreach` com LLM para gerar rascunho contextual sem envio.
- Rascunhos comerciais sempre marcados para aprovação humana.
- Pipeline comercial que só compõe abordagem para leads de alta intenção.
- Testes do runtime, Sales Agent, funil e seleção de outreach adicionados ao runner principal.

## Ainda não habilitado

- envio automático de WhatsApp/e-mail;
- CRM write actions;
- Revenue Director;
- persistência de traces/assessments por workspace;
- decisão multi-ação do Marketing Director.

A próxima etapa é persistir o estado comercial e mostrar leads quentes/rascunhos no painel antes de introduzir qualquer skill de envio externo.
