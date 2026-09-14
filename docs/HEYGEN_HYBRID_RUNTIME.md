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
- Endpoint: `POST https://api.heygen.com/v3/videos` para gerar, `GET https://api.heygen.com/v3/videos/{id}` para status — com timeout configurável (padrão 30s) e `redirect: "error"`.
- O `brandKitId` do workspace é mantido na configuração para referência, mas **não é enviado** no payload do `/v3/videos` — o endpoint de vídeo não aceita brand kit diretamente.
- Toda falha (secret ausente, HTTP, rede, timeout, JSON inválido, erro remoto, status inesperado) vira uma mensagem genérica. O corpo da resposta, headers e mensagens de erro originais nunca são propagados — evita vazar o valor do secret ou dados do payload em logs.
- Geração via API só produz o rascunho do vídeo (`pending_approval`). Nunca publica no Instagram — publicação é uma ação humana separada, feita só a partir de `approved` (`src/reels/publisher.ts`).

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
