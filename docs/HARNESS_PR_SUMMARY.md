# Agent Harness — resumo da branch

Branch: `feat/agent-harness`

## Entregue

- Agent Harness runtime com allowlist de skills, budget, aprovação humana e tracing.
- Skill registry.
- Marketing Director atual migrado para execução através do Harness.
- Backlog continua compatível com o gerador injetável usado nos testes.
- Sales Agent P0 em modo copilot/read-only.
- Scoring comercial determinístico e auditável.
- Testes do runtime e do Sales Agent adicionados ao runner principal.

## Ainda não habilitado

- envio automático de WhatsApp/e-mail;
- CRM write actions;
- Revenue Director;
- persistência de traces por workspace;
- decisão multi-ação do Marketing Director.

A próxima etapa é ligar o Sales Agent aos eventos reais de conversão e criar `sales.compose_outreach`; ações de envio deverão exigir aprovação humana no Harness.
