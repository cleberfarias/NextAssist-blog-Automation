# HeyGen híbrido: MCP interativo + API headless

O Harness suporta dois providers de HeyGen ao mesmo tempo, escolhidos de forma explícita por modo de runtime — nunca por fallback automático de um para o outro.

## Seleção de provider

`videoStrategy.provider` é o padrão para qualquer modo. `videoStrategy.runtimeProviders.{interactive,headless}` sobrescreve por modo, quando declarado. A resolução é feita por `selectHeyGenProvider` (`src/lib/heygenProvider.ts`):

```json
"videoStrategy": {
  "provider": "heygen-mcp",
  "runtimeProviders": { "headless": "heygen-api" },
  "avatarId": "...",
  "voiceId": "...",
  "requiresApproval": true,
  "fallback": "none"
}
```

Com essa configuração: modo interativo usa `heygen-mcp` (herda `provider`, sem override); modo headless usa `heygen-api` (override explícito). Se `runtimeProviders` não existir, todo modo usa `provider` — não há promoção automática de MCP para API.

## heygen-api (headless) — assíncrono, nunca bloqueia o pipeline

O pipeline principal **nunca espera** o HeyGen terminar. Ele só envia o vídeo, persiste `rendering` + `videoId` e encerra o estágio — quem confirma a conclusão é um reconciler periódico, separado.

```
pipeline principal
  → client.generate()               (POST /v3/videos)
  → persiste status=rendering, provider=heygen-api, videoId=<id>
  → encerra o estágio de Reel (log "submitted", não é erro)

reconcile-reels.yml (de hora em hora)
  → carrega Reels rendering + heygen-api + videoId
  → client.getStatus(mesmo videoId)  (GET /v3/videos/{id})
  → pending/processing  → continua rendering
  → completed           → persiste videoUrl, vira pending_approval
  → failed/cancelled/not_found → vira failed
```

- Cliente: `src/harness/heygenApi.ts` (`createHeyGenApiClient` — só request/response, sem laço de espera nenhum).
- Autenticação: header `X-Api-Key`, lido em runtime via `ctx.secrets.get(workspaceId, "HEYGEN_API_KEY")`. Sem o secret, a chamada falha antes de qualquer requisição de rede — nunca há fallback silencioso para outro gerador.
- Endpoint: `POST https://api.heygen.com/v3/videos` para gerar, `GET https://api.heygen.com/v3/videos/{id}` para status — com timeout individual configurável por requisição (padrão 30s) e `redirect: "error"`.
- O `brandKitId` do workspace é mantido na configuração para referência, mas **não é enviado** no payload do `/v3/videos` — o endpoint de vídeo não aceita brand kit diretamente.
- Toda falha (secret ausente, HTTP, rede, timeout, JSON inválido, erro remoto, status inesperado) vira uma mensagem genérica. O corpo da resposta, headers e mensagens de erro originais nunca são propagados — evita vazar o valor do secret ou dados do payload em logs. Um HTTP 404 vira o valor `{status:"not_found"}` (não uma exceção), pra distinguir de um erro transitório nosso (rede/timeout/5xx) — só o 404 é um "job não existe mais" confirmado pelo HeyGen.
- `pending_approval` guarda o `videoUrl` **do próprio HeyGen** (não baixa nem reenvia pro Firebase Storage) — ver risco documentado abaixo.
- Geração via API só produz o rascunho do vídeo. Nunca publica no Instagram — publicação é uma ação humana separada, feita só a partir de `approved` (`src/reels/publisher.ts`).

### Reel reconciler (`src/reels/reconciler.ts`, `src/scripts/reconcileReels.ts`, `.github/workflows/reconcile-reels.yml`)

Roda de hora em hora (`workflow_dispatch` também disponível). Único responsável por: consultar o HeyGen, mover `rendering → pending_approval` quando `completed`, ou `rendering → failed` numa falha terminal confirmada (`failed`/`cancelled`/`not_found`). Nunca chama `generate` (não cria vídeo), nunca publica no Instagram, nunca roda o pipeline do blog.

Semântica explícita dos estados remotos — **pending/processing, timeout de polling, o runner ou o workflow terminarem nunca significam failed**:
- `queued`/`rendering` (remoto `waiting`/`pending`/`processing`) → local continua/volta a `rendering`.
- `completed` → persiste `videoUrl`, vira `pending_approval`, um evento de audit.
- `failed`/`cancelled`/`not_found` (confirmado pelo HeyGen) → só aí vira `failed`.
- Erro nosso ao consultar (rede, timeout, 5xx) → `inconclusive`: não muda nada, tenta nas próxima execução.

Idempotente: rodar duas vezes seguidas com o mesmo status remoto não duplica evento de audit — sem mudança de estado, não há transição, e sem transição não há novo evento.

### Recuperação de `failed` por timeout/encerramento local

Um `failed` local com `videoId` (ex: o processo foi encerrado, ou um polling antigo desistiu cedo) não é tratado como definitivo: antes de qualquer `generate` novo, `reconcileReelWithRemote` consulta o HeyGen pelo MESMO id. Se o HeyGen ainda mostra `pending`/`processing`/`completed`, o Reel se recupera — `failed → rendering` (limpando o erro antigo, preservando o audit trail) e, se já `completed`, segue direto pra `pending_approval`. Só permanece `failed` se o HeyGen confirmar `failed`/`cancelled`/`not_found`.

### Nunca gera um segundo vídeo

`planReelGeneration` (`src/reels/state.ts`) decide isso antes de qualquer chamada de rede: um Reel `rendering` ou `failed` com `videoId` presente vai direto pro reconciler (`check-remote`) — o pipeline principal e o reconciler NUNCA chamam `client.generate()` nesse caso. Só chama `generate` quando não há nenhum `videoId` pra checar (`queued` que nunca chegou a renderizar, ou `failed` sem id).

## Segredo em runtime — nunca no repositório

- `HEYGEN_API_KEY` nunca é hardcoded, nem em `workspace.json`, `.env.example`, docs ou código.
- `src/workspace.ts` rejeita declarar `HEYGEN_API_KEY` como secret a menos que `videoStrategy` configure `heygen-api` (via `provider` ou `runtimeProviders`) — evita declarar o secret "à toa" num workspace que não usa a API.
- `HEYGEN_REST_FALLBACK` continua permanentemente proibido: a escolha de provider precisa ser explícita em `videoStrategy.runtimeProviders`, nunca um fallback implícito por secret.
- No GitHub Actions (`.github/workflows/daily-post.yml`), o valor entra só como variável de ambiente do passo que roda o pipeline (`HEYGEN_API_KEY: ${{ secrets.HEYGEN_API_KEY }}`) — nunca é impresso em log.

### Cadastrar o secret no GitHub

O workflow roda por `environment: <workspace>` (ex.: `nextassist`), então o secret precisa existir nesse Environment (ou no repositório, se preferir compartilhar entre workspaces):

```
Settings → Environments → nextassist → Environment secrets → New environment secret
Nome: HEYGEN_API_KEY
Valor: <chave real, obtida no painel do HeyGen>
```

Alternativa via `gh` CLI (também nunca imprime o valor no terminal, desde que a chave venha de um arquivo ou variável de shell local, não digitada em texto puro no histórico):

```
gh secret set HEYGEN_API_KEY --env nextassist --repo cleberfarias/NextAssist-blog-Automation
```

## Fluxo persistente (compartilhado entre os dois providers)

`queued → rendering → pending_approval → approved/rejected → publishing → published/failed`, com audit trail por Reel (`src/reels/state.ts`). O provider usado fica gravado no registro (`ReelRecord.provider`), mas a máquina de estados e o gate de aprovação (`src/reels/publisher.ts`) são os mesmos para `heygen-mcp` e `heygen-api`.

## Idempotência por reexecução (`src/reels/generator.ts`, `planReelGeneration`)

O id do Reel é determinístico: `${workspace.id}:${post.slug}`. Uma reexecução do pipeline para o mesmo slug (retry manual, workflow duplicado, smoke test repetido) **nunca** reseta um Reel que já esteja em `pending_approval`, `approved`, `publishing`, `published` ou `rejected` — o registro existente é devolvido intocado. Se estiver `rendering` ou `failed` com `videoId`, consulta o HeyGen (`check-remote`, ver seção do reconciler acima) em vez de gerar de novo. Só chama `generate` quando não há `videoId` nenhum: `queued` que nunca chegou a renderizar, ou `failed` sem id — preservando o histórico de audit em vez de recriar do zero. Essa decisão é pura e testada isoladamente em `src/reels/state.test.ts` (`planReelGeneration`).

## Reconciliação de estado entre execuções concorrentes

O pipeline roda como job de GitHub Actions por workspace, com `concurrency` por workspace mas sem exclusão entre uma execução agendada e uma manual na mesma janela, nem entre workflows disparados em branches diferentes que commitam nos mesmos arquivos. `src/scripts/mergeWorkspaceState.ts` (lógica pura em `src/scripts/workspaceStateMerge.ts`) reconcilia `content-calendar.json`, `content-registry.json`, `post-history.json`, `runs-history.json` e `reel-state.json` contra a ref remota mais recente antes de cada tentativa de push — nunca por `--ours`/`--theirs`, sempre preservando informação dos dois lados (união por chave estável de cada arquivo; para `reel-state.json`, o status nunca regride e os audit trails são fundidos). Ver `.github/workflows/daily-post.yml`.

## Riscos conhecidos (não corrigidos neste trabalho)

- **`videoUrl` de `pending_approval` (heygen-api) aponta pro próprio HeyGen, não pro Firebase Storage.** Ao contrário do caminho heygen-mcp (que baixa o vídeo e reenvia pro nosso bucket), o reconciler persiste a URL que o HeyGen devolve diretamente — mais simples e sem precisar de credenciais do Firebase Storage no workflow do reconciler, mas se essa URL expirar antes da aprovação humana, o vídeo fica inacessível no painel. Não verificado neste trabalho por quanto tempo o HeyGen mantém a URL hospedada.
- **Mesmo slug pode ser reprocessado pelo blog.** `content-calendar.json` decide o próximo tópico por `publicado:false`; se esse flag for perdido (ex.: uma corrida de push antes da reconciliação acima existir) ou se o pipeline for reexecutado manualmente para o mesmo tópico, o LLM tende a gerar o mesmo `slug` de novo (título determinístico o suficiente — confirmado em smoke test real, `ordem-servico-online-assistencia-tecnica` saiu duas vezes). `publishPost`/`ctx.cms.createPost` chama a API externa do blog NextAssist; o comportamento dela num `slug` colidente (rejeita, ou sobrescreve o post publicado) não é verificado nem testado neste repositório — depende do backend, fora do escopo aqui. A reconciliação de `content-calendar.json`/`post-history.json` acima reduz a chance (para de perder o `publicado:true`), mas não elimina corrida genuína dentro da mesma janela de execução.
