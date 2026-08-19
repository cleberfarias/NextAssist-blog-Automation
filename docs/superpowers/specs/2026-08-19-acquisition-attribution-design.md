# Camada de analytics e atribuição de aquisição — Design (P0)

## Contexto

O escritório de marketing com IA já pesquisa pautas, gera conteúdo e publica
automaticamente. Ele já mede alcance (Search Console, via
`src/performance.ts`/`post-performance.json`) e já recebe alguns eventos de
conversão do site (`demo_view`, `demo_submit`, `contact_submit`,
`whatsapp_click`, via `POST /api/conversions`/`conversions.json`). O
Marketing Director (`src/lib/marketingDirector.ts`) já usa esses dados para
priorizar pautas.

O que falta: fechar o ciclo **conteúdo → visita → trial → ativação →
cliente**, com um identificador de conteúdo formal, eventos de produto
(trial, cadastro, primeira Ordem de Serviço, assinatura) e uma camada
determinística que junte tudo por conteúdo, para que o dashboard e o
Marketing Director decidam com base em resultado comercial — não em
alcance bruto.

Hipótese de ativação (a validar com dado real, P1): **usuário que completou
o fluxo básico e criou sua primeira Ordem de Serviço** (`first_order_created`).

## Fora de escopo do P0

- Emissão real dos eventos de produto pelo app NextAssist (depende do time
  de produto) — este repo só define o contrato e fica pronto para receber.
- CAC / mídia paga, atribuição multi-touch, cohortes, scoring de
  priorização, detecção automática de saturação de tema, store dedicado,
  integração com analytics externo, alertas automáticos.
- Qualquer agente novo, fila, microserviço ou banco de dados. Toda a camada
  usa os mesmos arquivos JSON e o mesmo padrão de storage já existentes
  (`src/lib/storage.ts`).

## Modelo de dados

### `content-registry.json` (novo)

Um registro por conteúdo publicado, escrito por uma única função,
`registerContent(ctx, entry)`, chamada em `src/pipeline.ts` imediatamente
após `publishPost` — o mesmo ponto onde `appendHistory` já é chamado hoje
(linha ~106). Nenhum outro módulo escreve neste arquivo (em particular,
`editorSeo.ts` e `publisher.ts` não escrevem — eles só produzem os dados
que `pipeline.ts` repassa).

```ts
interface ContentRegistryEntry {
  contentId: string;        // = slug. Contrato explícito, não convenção.
                             // Deve ser globalmente único entre canais
                             // (limitação conhecida do P0 — ver Riscos).
  campaignId: string | null; // agrupamento temático opcional, ex.:
                              // "serie-precificacao-2026-08". null é válido no P0.
  tema: string;
  formato: "blog" | "instagram-reel";
  channel: "blog" | "instagram";
  funnelStage: "topo" | "meio" | "fundo"; // herdado do plano do topicPlanner
  publicadoEm: string;       // ISO 8601
  status: "published" | "draft-pending-approval";
  url: string;               // postUrl(ctx, slug)
}
```

`registerContent` é **upsert por `contentId`**: se já existe uma entrada
com o mesmo `contentId`, ela é substituída; senão, é inserida. Isso torna a
função idempotente a reexecuções do pipeline (retry, falha pós-publicação,
etc.).

### `conversions.json` — extensão retrocompatível

O armazenamento continua sendo um array aberto de eventos (sem enum rígido
em disco). Só o tipo em código passa a restringir os nomes aceitos:

```ts
export type ConversionEventName =
  | "page_view" | "cta_click"
  | "demo_view" | "demo_submit" | "contact_submit" | "whatsapp_click"
  | "trial_started" | "signup_completed"
  | "first_customer_created" | "first_device_linked" | "first_order_created"
  | "returning_user" | "subscription_started";

interface ConversionEvent {
  name: ConversionEventName;
  anonymousId?: string;   // identidade do visitante não autenticado
                           // (cookie do site — gerado fora deste repo)
  userId?: string;        // identidade do produto, presente a partir do signup
  path?: string;
  source?: string;
  medium?: string;
  campaign?: string;      // = campaignId (utm_campaign)
  content?: string;       // = contentId  (utm_content) — chave do join
  ctaId?: string;         // ex.: "cta-inline", "cta-final" — não é UTM padrão
  createdAt: string;
}
```

Os 4 eventos já existentes (`demo_view`, `demo_submit`, `contact_submit`,
`whatsapp_click`) continuam funcionando sem alteração de schema.
`POST /api/conversions` passa a aceitar os nomes novos sem mudar a
validação estrutural atual (regex de caracteres UTM-safe em
`campaign`/`content` permanece).

Não há evento primário `activated_user`. **Ativação é métrica derivada**,
calculada em `attribution.ts` a partir do evento bruto
`first_order_created` — isso preserva o dado bruto caso a definição de
ativação mude no futuro (ex.: passar a exigir também
`first_customer_created` + `returning_user` em 7 dias).

### UTM e CTA

Em `editorSeo.ts`, os links de CTA passam a usar:

```
${demoPath}?utm_source=blog&utm_medium=article
  &utm_campaign={campaignId ?? "sem-campanha"}
  &utm_content={contentId}
  &cta_id={cta-inline|cta-final}
```

`cta_id` fica deliberadamente fora do padrão UTM — ele identifica a
interação dentro do conteúdo (qual CTA foi clicado), enquanto os campos UTM
identificam a origem da aquisição. O evento `cta_click` deve enviar esse
mesmo valor no campo `ctaId`.

## `src/attribution.ts` (novo módulo, não é agente)

Função pura e determinística: `computeAttribution(ctx): AttributionRow[]`,
lida a partir de `content-registry.json`, `conversions.json` e
`post-performance.json`. Sem chamada a LLM, sem estado próprio — roda sob
demanda (rota do dashboard, e chamada direta pelo Marketing Director).

### Algoritmo

1. **Resolver identidade**: percorrer `conversions.json` e, para todo
   evento que carregue `anonymousId` *e* `userId` simultaneamente
   (tipicamente `signup_completed`), registrar o par no mapa
   `anonymousId ↔ userId`.
2. **Primeiro toque por `anonymousId`**: para cada `anonymousId`, achar o
   evento mais antigo (`createdAt`) que tenha `content` preenchido → esse
   `contentId` é a origem atribuída daquele visitante (**first-touch**,
   decisão de P0, revisável — documentado como não sendo prova de
   causalidade).
3. **Propagar para `userId`**: eventos que só têm `userId`
   (`first_order_created`, `subscription_started`) herdam o `contentId` de
   origem via o mapa do passo 1.
4. **Contagem por entidade única, não por evento**: `trials`, `signups`,
   `activated`, `customers` usam `Set<anonymousId | userId>` por
   `contentId` — nunca contagem bruta de eventos, para não inflar métricas
   com retries/duplicidade.
   - `trials`/`signups` usam a atribuição first-touch do passo 2/3 quando
     há identidade resolvível; fallback para contagem direta por `content`
     do próprio evento só quando não há `anonymousId`/`userId`.
   - `activated` = distinct users com `first_order_created` atribuído.
   - `customers` = distinct users com `subscription_started` atribuído.
5. **Precedência de "visitas"** (regra explícita, não ambígua):
   1. Se existir dado em `post-performance.json` para o post (canal blog),
      usar esse valor (cliques SEO).
   2. Senão, usar `page_view` atribuível ao `contentId`.
   3. `demo_view` **nunca** conta como visita — é evento de intenção,
      entra apenas no funil de conversão, não no denominador de alcance.
6. Eventos sem `content` nem identidade resolvível são ignorados nas
   métricas por conteúdo e somados em `unattributedEvents` (evita inflar
   taxas silenciosamente).
7. **Confiabilidade da taxa**: `MIN_TRIALS_FOR_RATE = 5` (constante,
   ajustável depois com mais dado — não é verdade estatística). Taxas
   calculadas com denominador abaixo desse mínimo são marcadas como não
   confiáveis; a regra é aplicada aqui, deterministicamente — não é deixada
   para o LLM interpretar.

### Contrato de saída

```ts
interface AttributionRow {
  contentId: string;
  campaignId?: string | null;
  tema?: string;
  channel?: string;
  formato?: string;
  funnelStage?: string;

  visits: number;
  trials: number;
  signups: number;
  activated: number;
  customers: number;

  visitToTrialRate: number;       // 0 se denominador = 0
  trialToActivationRate: number;
  activationToCustomerRate: number;
  rateReliable: boolean;          // false se trials < MIN_TRIALS_FOR_RATE

  unattributedEvents?: number;
}
```

## Dashboard (`server.ts` + `web/public/app.js`)

Novo endpoint `GET /api/attribution` — mesmo padrão dos demais (Basic Auth,
sem cache próprio, chama `computeAttribution(ctx)` sob demanda a partir dos
JSONs já em disco).

Nova tabela em `app.js`, reaproveitando o componente de tabela já usado na
seção de conversões, **ordenada por `customers` desc por padrão**:

| Conteúdo | Canal | Tema | Visitas | Trials | Cadastros | Ativados | Clientes | Visita→Trial | Trial→Ativação | Ativação→Cliente |
|---|---|---|---|---|---|---|---|---|---|---|

Sem gráfico novo no P0 — a tabela ordenada por resultado comercial já expõe
por inspeção visual os casos "alto alcance/baixa conversão" e "baixo
alcance/alta conversão" citados no pedido original.

## Marketing Director (`src/lib/marketingDirector.ts`)

Passa a receber `AttributionRow[]` de `computeAttribution(ctx)` no lugar do
`getConversionSummary` agregado atual. O prompt é atualizado para:

- Priorizar deterministicamente **clientes > ativados > trials > visitas >
  alcance**, nunca o inverso.
- Instrução explícita e não-interpretável: *"Taxas com menos de
  `MIN_TRIALS_FOR_RATE` trials têm amostra insuficiente e não devem ser
  usadas para priorização"* — a decisão de confiabilidade já vem calculada
  (`rateReliable`), o LLM não infere isso sozinho.
- O campo `reason` já existente em `backlog.ts` por oportunidade passa a
  citar o dado de atribuição que motivou a pauta (ex.: "Conteúdos sobre
  precificação converteram 2,8x mais em trial que os de estoque —
  priorizando 2 pautas novas sobre precificação").

## Riscos e limitações conhecidas (P0)

- `contentId = slug` exige unicidade global entre canais (blog e
  instagram-reel não podem colidir no mesmo slug). Não resolvido no P0
  (seria `${channel}:${slug}` se necessário) — documentado aqui como
  limitação aceita.
- Atribuição first-touch é uma decisão de modelagem, não uma verdade de
  negócio comprovada — não deve ser tratada como causalidade absoluta pelo
  Marketing Director nem por quem lê o dashboard.
- Enquanto o app NextAssist não emitir os eventos de produto (trial/signup/
  OS/assinatura), as colunas correspondentes ficam zeradas — o P0 entrega o
  contrato e a tubulação prontos, não o dado em si.

## Corte de tarefas

**P0** — descrito acima, integralmente:
`content-registry.json`/`contentRegistry.ts`, extensão de
`ConversionEvent`/`/api/conversions`, UTM+`cta_id` em `editorSeo.ts`,
`attribution.ts`, `GET /api/attribution`, tabela no dashboard,
`marketingDirector.ts` consumindo `AttributionRow[]`.

**P1**:
- Disparo real dos eventos de produto pelo app NextAssist (depende do time
  de produto).
- Cobertura de `page_view`/`cta_click` em todo o funil de topo (hoje só
  `demo_view`/`demo_submit`/`contact_submit`/`whatsapp_click`).
- CAC quando houver mídia paga.
- Atribuição real de `campaignId` (séries temáticas) no `topicPlanner`.
- Detecção de saturação de tema.
- Validação estatística da hipótese de ativação com dado real.

**P2**:
- Atribuição multi-touch, cohortes, scoring de priorização, store
  dedicado (se o volume exigir), integração com analytics externo,
  alertas automáticos de alto-alcance/baixa-conversão.
