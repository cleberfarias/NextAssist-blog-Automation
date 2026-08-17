# Marketing Director — Backlog Autoalimentado

> Spec original do usuário, capturada em 2026-08-17.

## Contexto

Hoje, quando todos os tópicos do `content-calendar.json` estão com
`publicado: true`, o pipeline encerra com "Nenhum tópico pendente no
calendário". Queremos evoluir o pipeline para que ele **nunca pare por
falta de tópicos**, transferindo essa responsabilidade para um novo agente:
o **Marketing Director**.

## Objetivo

Transformar o `content-calendar.json` em um **backlog operacional
autoalimentado**.

Fluxo esperado:

```text
Pipeline inicia
        ↓
Conta tópicos pendentes
        ↓
Se houver quantidade suficiente
        ↓
Executa normalmente

Se houver poucos ou nenhum tópico
        ↓
Marketing Director analisa contexto
        ↓
Gera novas oportunidades de conteúdo
        ↓
Valida duplicidade e qualidade
        ↓
Persiste novos tópicos no calendário
        ↓
Pipeline continua normalmente
```

## Regra inicial

Configuração por workspace:

```json
{
  "contentStrategy": {
    "minimumPendingTopics": 5,
    "replenishAmount": 15
  }
}
```

Quando a quantidade de tópicos com `publicado: false` ficar abaixo de
`minimumPendingTopics`, o sistema deve tentar gerar `replenishAmount` novas
pautas.

## Fonte de contexto do Marketing Director

A decisão deve considerar, quando disponível: `workspace.brand`,
`workspace.goals`, público-alvo, concorrentes, proposta de valor, artigos já
publicados, histórico do calendário, Search Console, performance dos posts,
conversões, palavras-chave já utilizadas, temas já utilizados, objetivo
principal do workspace.

Não geração aleatória de temas — priorizar por potencial de impacto no
objetivo do workspace (aumentar leads, aumentar tráfego orgânico, explorar
oportunidade do Search Console, reforçar temas que já convertem, atacar
lacunas em relação a concorrentes, atualizar clusters existentes).

## Nova Skill

```ts
generateContentBacklog(ctx, options)
```

Devolve dados estruturados:

```ts
interface ContentOpportunity {
  tema: string;
  palavraChaveAlvo: string;
  reason: string;
  priority: "high" | "medium" | "low";
  source:
    | "search-console"
    | "conversion"
    | "competitor"
    | "content-gap"
    | "workspace-goal"
    | "other";
}
```

O LLM não escreve diretamente no JSON. Fluxo: Marketing Director gera
`ContentOpportunity[]` → sistema valida → sistema remove duplicados →
sistema persiste.

## Validações obrigatórias

Antes de salvar: não repetir `tema`; não repetir `palavraChaveAlvo`; não
gerar pauta muito semelhante a post já publicado; não gerar pauta muito
semelhante a item pendente; respeitar `brand.forbiddenTerms`; respeitar
público e posicionamento do workspace; quantidade máxima configurável;
resposta do LLM validada por schema.

## Persistência

Mantém o modelo atual: `workspaces/<workspaceId>/content-calendar.json`.
Novos itens:

```json
{
  "tema": "...",
  "palavraChaveAlvo": "...",
  "publicado": false,
  "generatedBy": "marketing-director",
  "createdAt": "...",
  "reason": "...",
  "priority": "high"
}
```

Compatível com itens antigos que só têm `tema`, `palavraChaveAlvo`,
`publicado`.

## Comportamento do pipeline

```ts
await ensureContentBacklog(ctx);
const topic = await getNextTopic(ctx);
```

`ensureContentBacklog(ctx)`: lê o calendário; conta pendentes; acima do
threshold não faz nada; abaixo, chama o Marketing Director; persiste pautas
válidas; retorna. Se o Director falhar, registra erro claramente. Se ainda
houver ao menos um tópico pendente antigo, o pipeline pode continuar usando
esse tópico. Se não houver nenhum tópico e o reabastecimento falhar, aí sim
encerra com erro explicativo.

## Eventos do painel

Novo agente `marketing-director` no `AgentId`, com eventos como:
"analisando backlog...", "analisando Search Console...", "identificou 18
oportunidades", "15 novas pautas adicionadas".

## Observabilidade

Registrar no histórico da execução:

```json
{
  "backlog": {
    "pendingBefore": 0,
    "generated": 15,
    "discardedDuplicates": 3,
    "pendingAfter": 15
  }
}
```

Se possível, registrar também os motivos das pautas geradas.

## Fora de escopo (nesta fase)

Banco vetorial, RAG complexo, PostgreSQL, sistema completo de memória,
LinkedIn, Recommendation Engine, scheduler novo.

## Critérios de aceite

- [ ] Pipeline não para simplesmente porque acabou o calendário.
- [ ] Threshold é configurável por workspace.
- [ ] Director gera pautas estruturadas.
- [ ] Duplicidades são bloqueadas.
- [ ] Novas pautas são persistidas por workspace.
- [ ] Pipeline continua usando a primeira pauta disponível após o
      reabastecimento.
- [ ] Eventos aparecem no painel.
- [ ] Histórico registra o reabastecimento.
- [ ] Falha do Director não corrompe o calendário.
- [ ] `npm run build` passa.
- [ ] `npm test` passa.
- [ ] Testes para calendário cheio, calendário baixo, calendário vazio,
      duplicidades e falha do Director.
