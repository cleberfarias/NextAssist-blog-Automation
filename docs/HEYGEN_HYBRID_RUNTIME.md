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

## heygen-api (headless)

- Cliente: `src/harness/heygenApi.ts` (`createHeyGenApiClient` + `pollHeyGenApiVideo`).
- Autenticação: header `X-Api-Key`, lido em runtime via `ctx.secrets.get(workspaceId, "HEYGEN_API_KEY")`. Sem o secret, a chamada falha antes de qualquer requisição de rede — nunca há fallback silencioso para outro gerador.
- Endpoint: `POST https://api.heygen.com/v3/videos` para gerar, `GET https://api.heygen.com/v3/videos/{id}` para status — com timeout individual configurável por requisição (padrão 30s) e `redirect: "error"`.
- O `brandKitId` do workspace é mantido na configuração para referência, mas **não é enviado** no payload do `/v3/videos` — o endpoint de vídeo não aceita brand kit diretamente.
- Toda falha (secret ausente, HTTP, rede, timeout, JSON inválido, erro remoto, status inesperado) vira uma mensagem genérica. O corpo da resposta, headers e mensagens de erro originais nunca são propagados — evita vazar o valor do secret ou dados do payload em logs.
- Geração via API só produz o rascunho do vídeo (`pending_approval`). Nunca publica no Instagram — publicação é uma ação humana separada, feita só a partir de `approved` (`src/reels/publisher.ts`).

### Polling: timeout total, não número de tentativas

`pollHeyGenApiVideo` (`src/harness/heygenApi.ts`) espera por prazo de parede, não por uma contagem fixa de tentativas — uma renderização real de 5-10 minutos não é abandonada só porque o intervalo de polling era curto. Padrão: até **15 minutos** de espera total, consultando a cada **10s** (`totalTimeoutMs`/`pollIntervalMs` configuráveis). Sempre a mesma consulta pro mesmo `video_id` — nunca inicia outro vídeo só porque uma consulta demorou. Estados tratados explicitamente: `waiting`/`pending` → `queued`, `processing` → `rendering`, `completed` (extrai a URL), `failed` e `cancelled` (falham imediatamente, sem esperar o prazo total). Estourar o prazo total gera `"HeyGen API: renderização excedeu o tempo máximo de 15 minutos."` — sem vazar API key, headers ou corpo de resposta.

### Retomada — nunca gera um segundo vídeo

`resolveHeyGenApiVideoId` reusa o `videoId` já persistido no `ReelRecord` (campo `videoId`, gravado assim que o HeyGen aceita a renderização, via `patchStoredReel` — não é uma transição de estado, é progresso dentro do mesmo `rendering`) em vez de chamar `generate` de novo. Isso cobre tanto o caso comum (uma única execução, polling e download) quanto o caso de recuperação (o processo caiu/foi cancelado no meio do polling): a próxima execução para o mesmo Reel encontra o `videoId` salvo e retoma o polling, sem gerar um vídeo duplicado.

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

O id do Reel é determinístico: `${workspace.id}:${post.slug}`. Uma reexecução do pipeline para o mesmo slug (retry manual, workflow duplicado, smoke test repetido) **nunca** reseta um Reel que já esteja em `pending_approval`, `approved`, `publishing`, `published` ou `rejected` — o registro existente é devolvido intocado. Se estiver `rendering`, retoma o mesmo `videoId` em vez de recriar. Se estiver `queued` (nunca chegou a renderizar) ou `failed`, tenta de novo preservando o histórico de audit em vez de recriar do zero. Essa decisão é pura e testada isoladamente em `src/reels/state.test.ts` (`planReelGeneration`).

## Reconciliação de estado entre execuções concorrentes

O pipeline roda como job de GitHub Actions por workspace, com `concurrency` por workspace mas sem exclusão entre uma execução agendada e uma manual na mesma janela, nem entre workflows disparados em branches diferentes que commitam nos mesmos arquivos. `src/scripts/mergeWorkspaceState.ts` (lógica pura em `src/scripts/workspaceStateMerge.ts`) reconcilia `content-calendar.json`, `content-registry.json`, `post-history.json`, `runs-history.json` e `reel-state.json` contra a ref remota mais recente antes de cada tentativa de push — nunca por `--ours`/`--theirs`, sempre preservando informação dos dois lados (união por chave estável de cada arquivo; para `reel-state.json`, o status nunca regride e os audit trails são fundidos). Ver `.github/workflows/daily-post.yml`.

## Riscos conhecidos (não corrigidos neste trabalho)

- **Mesmo slug pode ser reprocessado pelo blog.** `content-calendar.json` decide o próximo tópico por `publicado:false`; se esse flag for perdido (ex.: uma corrida de push antes da reconciliação acima existir) ou se o pipeline for reexecutado manualmente para o mesmo tópico, o LLM tende a gerar o mesmo `slug` de novo (título determinístico o suficiente — confirmado em smoke test real, `ordem-servico-online-assistencia-tecnica` saiu duas vezes). `publishPost`/`ctx.cms.createPost` chama a API externa do blog NextAssist; o comportamento dela num `slug` colidente (rejeita, ou sobrescreve o post publicado) não é verificado nem testado neste repositório — depende do backend, fora do escopo aqui. A reconciliação de `content-calendar.json`/`post-history.json` acima reduz a chance (para de perder o `publicado:true`), mas não elimina corrida genuína dentro da mesma janela de execução.
