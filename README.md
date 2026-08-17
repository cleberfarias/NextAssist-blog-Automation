# NextAssist — automação diária do blog

Pipeline multi-agente que gera e publica um post por dia no blog do
NextAssist, sem intervenção manual.

## Como funciona

1. **Pesquisa de mercado** (`src/agents/marketResearch.ts`) — busca na
   web o que concorrentes publicaram sobre o tema do dia
2. **Pesquisa de pauta** (`src/agents/topicPlanner.ts`) — define título,
   meta description e estrutura de H2s
3. **Redator** (`src/agents/writer.ts`) — escreve o artigo em HTML
4. **Editor/SEO** (`src/agents/editorSeo.ts`) — adiciona FAQ schema,
   links internos, tags, slug e finaliza os campos
5. **Publicador** (`src/agents/publisher.ts`) — gera a imagem de capa
   (JPEG), sobe pro Firebase Storage, autentica no Firebase Auth e publica
   via `POST /blog/admin/posts`
6. **Instagram** (`src/agents/instagramPublisher.ts`) — gera um Reel (vídeo
   vertical 9:16, ~7s, efeito de zoom/pan sobre a capa) a partir da mesma
   imagem de capa e publica no Instagram via Graph API da Meta (título +
   resumo + link + hashtags a partir das tags na legenda). É melhor esforço:
   se falhar ou não estiver configurado, não derruba o pipeline (o post do
   blog já saiu). Só roda se `IG_USER_ID` e `IG_ACCESS_TOKEN` estiverem
   definidos.
7. **Indexador** (`src/agents/indexer.ts`) — notifica a Google Indexing
   API sobre a nova URL e reenvia o sitemap ao Search Console, para
   acelerar o rastreamento (melhor esforço; não derruba o pipeline se
   falhar, já que o post já foi publicado)

Os temas vêm de `workspaces/<id>/content-calendar.json`. Cada execução consome o
próximo tema não publicado e marca como `publicado: true` ao final.
Quando a lista acabar, adicione novos tópicos nesse arquivo.

## Workspaces

Tudo é organizado por workspace (uma marca / um cliente). Cada um vive em
`workspaces/<id>/`:

| Arquivo | Conteúdo |
|---|---|
| `workspace.json` | marca, metas, canais, integrações e segredos obrigatórios |
| `content-calendar.json` | fila de temas a publicar |
| `post-history.json` | posts já publicados |
| `runs-history.json` | registro de cada execução do pipeline |
| `post-performance.json` | último relatório do Search Console (gerado local, não versionado) |

O CLI escolhe o workspace pela variável `WORKSPACE_ID` (padrão: `nextassist`):

```bash
WORKSPACE_ID=nextassist npm run run
WORKSPACE_ID=nextassist npm run update:seo
```

O painel exige o workspace na URL — `http://localhost:4173/?workspace=nextassist`
— e o seletor no topo da página troca entre os workspaces ativos (todas as
chamadas de API recebem `?workspace=<id>`). A GitHub Action roda um job por
workspace ativo via matrix, e o `workflow_dispatch` aceita o input
`workspace_id` para rodar apenas um.

## Setup

```bash
npm install
cp .env.example .env
# preencha o .env com as chaves (ver comentários no próprio arquivo)
npm run run
```

### Variáveis de ambiente necessárias

| Variável | Onde conseguir |
|---|---|
| `OPENAI_API_KEY` | OpenAI Platform — provedor principal dos agentes de texto |
| `ANTHROPIC_API_KEY` | Anthropic Console — fallback para falhas recuperáveis |
| `AI_PROVIDER_PRIMARY` | `openai` (padrão) ou `anthropic` |
| `OPENAI_MODEL` | Modelo de texto da OpenAI (padrão: `gpt-5.6`) |
| `ANTHROPIC_MODEL` | Modelo de texto da Anthropic (padrão: `claude-sonnet-5`) |
| `FIREBASE_WEB_API_KEY` | Console Firebase → Configurações do projeto → Geral |
| `FIREBASE_ADMIN_EMAIL` / `FIREBASE_ADMIN_PASSWORD` | Usuário admin já usado no painel `/admin/blog` |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | Console Firebase → Contas de serviço → Gerar nova chave privada (colar o JSON inteiro em uma linha) |
| `FIREBASE_STORAGE_BUCKET` | Console Firebase → Storage (ex: `nextassist-app.appspot.com`) |
| `IMAGE_GEN_API_KEY` | Chave da API de geração de imagem (padrão: OpenAI) |
| `SITE_BASE_URL` | Domínio público do blog (ex: `https://www.nextassist-app.com.br`) |
| `SEARCH_CONSOLE_SITE_URL` | Propriedade no Search Console (prefixo de URL ou `sc-domain:...`) |
| `SITEMAP_URL` | URL do sitemap reenviado ao Google |
| `IG_USER_ID` *(opcional)* | ID da conta Instagram Business/Creator (ver seção Instagram) |
| `IG_ACCESS_TOKEN` *(opcional)* | Token de longa duração da Graph API da Meta |
| `GEMINI_API_KEY` *(opcional)* | Google AI Studio — gera o vídeo do Reel com o Veo em vez do fallback local |
| `GEMINI_API_KEY_FALLBACK` *(opcional)* | Segunda chave/conta, usada se a primeira estourar cota |

**Nunca commite o `.env`** — ele já está coberto por `.gitignore`.

### Indexação no Google e métricas (Search Console)

O agente indexador e o painel de desempenho reutilizam a **mesma service
account do Firebase** (`FIREBASE_SERVICE_ACCOUNT_JSON`). Antes de usar,
faça uma vez no Google Cloud / Search Console:

1. No [Cloud Console](https://console.cloud.google.com) → APIs e Serviços,
   habilite a **Indexing API** e a **Google Search Console API** no projeto
   da service account.
2. No [Search Console](https://search.google.com/search-console), em
   Configurações → Usuários e permissões, adicione o e-mail da service
   account (`...@<projeto>.iam.gserviceaccount.com`) como **Proprietário**
   (necessário para a Indexing API; também cobre a leitura de métricas).

> Nota honesta: oficialmente a Indexing API só é suportada para
> `JobPosting`/`BroadcastEvent`. Para posts de blog ela costuma funcionar
> como um empurrão no rastreamento, mas não é garantida — o caminho
> confiável continua sendo o sitemap. Métricas via Search Analytics API
> aparecem com 2-3 dias de atraso.

### Publicação no Instagram

O passo do Instagram publica um **Reel** (não um post de feed) usando a
**Graph API da Meta** (caminho oficial). A API de Reels exige vídeo — o
vídeo em si vem de duas fontes possíveis:

- **Veo** (`src/lib/veo.ts`, via Gemini API) — se `GEMINI_API_KEY` estiver
  configurada, gera um vídeo criativo a partir da imagem de capa, com
  narração nativa (câmera cinematográfica, ambiente de assistência técnica).
  Tem custo por vídeo (chave separada da assinatura do app Gemini — ver
  tabela de variáveis).
- **Fallback local** (`src/lib/video.ts`, via `ffmpeg-static`, sem custo) —
  usado quando `GEMINI_API_KEY` não está configurada ou quando o Veo falha:
  efeito de zoom/pan lento sobre a imagem, formato vertical 1080×1920, com
  narração gerada por TTS (`src/lib/tts.ts`, mesma credencial da OpenAI)
  dizendo o título do post e convidando a conferir o link na bio (duração
  se ajusta à narração, 5-20s). Se a narração falhar, o Reel sai mudo em vez
  de derrubar a publicação.

Pré-requisitos que só se resolvem no lado da Meta (uma vez):

1. A conta do Instagram precisa ser **Business** ou **Creator** e estar
   conectada a uma **Página do Facebook**.
2. Crie um app em [developers.facebook.com](https://developers.facebook.com)
   e adicione o produto **Instagram Graph API**.
3. Gere um **token de acesso de longa duração** com as permissões
   `instagram_basic`, `instagram_content_publish` e `pages_read_engagement`.
4. Descubra o **IG Business Account ID** (não é o @usuário):
   - `GET /me/accounts` → pegue o `id` da Página
   - `GET /{page-id}?fields=instagram_business_account` → o `id` retornado é o
     `IG_USER_ID`.

Preencha `IG_USER_ID` e `IG_ACCESS_TOKEN` no `.env` (ou nos secrets da Action).
Se qualquer um faltar, o passo é simplesmente ignorado.

> Notas honestas:
> - Vídeos de Reel demoram mais para processar que imagens — o passo espera
>   até ~5 minutos pelo container ficar pronto antes de publicar.
> - Só é possível publicar de contas **Business/Creator**. Contas pessoais não
>   têm API; bibliotecas não-oficiais violam os termos e arriscam banir a conta.
> - O token de longa duração **expira** (tipicamente ~60 dias). Quando expirar,
>   gere um novo e atualize o secret — o passo é melhor esforço, então uma
>   falha aqui não impede a publicação do blog, mas o post não vai ao Instagram.

## Painel visual — o "escritório"

```bash
npm run office
```

Abre um servidor local em `http://localhost:4173` com uma interface
tipo simulador: cada agente aparece numa mesa, muda de "ocioso" pra
"trabalhando" pra "concluído" em tempo real (via Server-Sent Events),
mostra um resumo do que produziu em uma bolha de fala, e a lateral
lista os posts publicados. O botão "Rodar pipeline agora" dispara uma
execução manual — dá pra acompanhar o trabalho de verdade dos agentes,
não é só decoração.

Abaixo do escritório há duas seções de acompanhamento:

- **Execuções recentes** — cada rodada do pipeline (automática da Action
  ou manual) vira um cartão com status (publicado / falhou), origem, data,
  link pro post e o resultado de cada agente. As mesas do escritório também
  são hidratadas com o estado da última execução real ao abrir a página.
- **Desempenho no Google** — tabela por post (indexado ou não, cliques,
  impressões, CTR e posição média) com botão "Atualizar métricas" que
  consulta o Search Console na hora. No painel hospedado, o último relatório
  fica persistido no Firebase Storage em
  `panel-state/<workspace-id>/post-performance.json`, sobrevivendo ao encerramento ou à
  recriação da instância.
- **Conversões do blog** — mostra visitas à demonstração, testes iniciados,
  contatos e cliques no WhatsApp. Os novos artigos identificam o slug e a
  posição de cada CTA nos parâmetros `utm_campaign` e `utm_content`, permitindo
  comparar quais pautas e chamadas realmente geram leads.

Cada execução do pipeline grava um registro detalhado em
`workspaces/<id>/runs-history.json`, que a Action commita de volta (inclusive quando
falha) — é assim que o painel confirma o que a automação realmente fez.

### Hospedando o painel sempre online

Se rodar o painel num serviço (Cloud Run, Render etc.), ele não recebe os
commits da Action diretamente. Defina `DATA_SOURCE=github` no ambiente do
servidor para que ele leia os arquivos de estado
(`workspaces/<id>/runs-history.json`, `workspaces/<id>/post-history.json`) via API do GitHub — assim o painel reflete as
publicações diárias sem precisar de `git pull`. Localmente, deixe
`DATA_SOURCE=local` (padrão).

Como o repositório é público, `PANEL_GITHUB_TOKEN` é opcional. Ele só é
necessário para evitar limites baixos da API do GitHub ou se o repositório
voltar a ser privado.

### Deploy no Cloud Run

Há um `Dockerfile` e um script PowerShell prontos. O script atualiza o serviço
existente `nextassist-blog-panel`, grava somente `PANEL_PASSWORD` no Secret
Manager e preserva os demais segredos já vinculados ao Cloud Run. Pré-requisitos:
`gcloud` autenticado no projeto, billing ativo e as APIs Cloud Run, Cloud
Build, Artifact Registry e Secret Manager habilitadas.

```powershell
.\deploy-cloudrun.ps1
```

O workflow `.github/workflows/deploy-panel.yml` também publica o painel
automaticamente quando código relevante chega à branch `main`. Configure no
environment `production` do GitHub os secrets:

- `GCP_WORKLOAD_IDENTITY_PROVIDER`: nome completo do provider do Workload
  Identity Federation.
- `GCP_DEPLOY_SERVICE_ACCOUNT`: e-mail da service account usada no deploy.

O workflow valida o build antes de publicar e também pode ser executado
manualmente pela aba Actions. Alterações feitas apenas nos arquivos de
histórico não disparam um novo deploy.

Notas:

- **Senha:** defina `PANEL_PASSWORD` no `.env` antes de subir — a URL do
  Cloud Run é pública e o painel exige Basic Auth (qualquer usuário + essa
  senha). Sem ela, o painel fica aberto.
- **Execução manual no ar:** o host não commita o estado de volta, então
  rodar o pipeline direto nele geraria post duplicado. Por isso, no modo
  hospedado o botão "Rodar pipeline agora" não roda o pipeline no próprio
  servidor — em vez disso, se `GITHUB_DISPATCH_TOKEN` estiver configurada,
  ele **dispara a GitHub Action manualmente** (`workflow_dispatch`), que
  publica e commita o estado normalmente, só que sob demanda em vez de
  esperar o cron. Sem essa variável, o botão fica escondido (comportamento
  anterior). `GITHUB_DISPATCH_TOKEN` precisa de um token com permissão de
  disparar Actions (`actions:write`) — diferente do `PANEL_GITHUB_TOKEN`
  abaixo, que é só leitura.
- **Seções "Execuções" e "Posts publicados":** só populam se o
  `PANEL_GITHUB_TOKEN` estiver configurado (repo privado). O "Desempenho no
  Google" funciona sem token (usa a API do blog + Search Console).
- **Escritório ao vivo mesmo publicando pela Action:** como o pipeline
  automático (cron) e o disparo manual sempre rodam numa GitHub Action —
  nunca dentro deste servidor —, ele normalmente só saberia do resultado
  depois do commit final. Configurando `PANEL_INGEST_TOKEN` (mesmo valor
  aqui e no secret da Action) e `PANEL_INGEST_URL` (só na Action, apontando
  pra `.../api/events/ingest` deste painel), a Action empurra cada evento
  do pipeline pro painel em tempo real — as mesas mudam de "ocioso" pra
  "trabalhando" ao vivo, igual ao modo local. Sem isso, o painel só reflete
  o resultado depois que a Action termina e commita o estado.

Esse servidor roda a mesma lógica do `npm run run` (`src/pipeline.ts`),
só que via HTTP em vez de CLI. Bom para rodar localmente enquanto você
testa, ou hospedar num serviço simples (Cloud Run, Render etc.) se
quiser deixar o painel sempre disponível — o cron do GitHub Actions
continua sendo o que garante a publicação diária mesmo com o painel
fechado.

## Rodando automaticamente todo dia

O workflow em `.github/workflows/daily-post.yml` roda às 9h (horário de
Brasília) via GitHub Actions. Para ativar:

1. Suba este projeto para um repositório no GitHub
2. Em Settings → Secrets and variables → Actions, cadastre cada
   variável da tabela acima como secret
3. O workflow já dispara sozinho no cron configurado — pode também
   rodar manualmente pela aba Actions ("Run workflow")

## Adicionando mais temas

Edite `workspaces/<id>/content-calendar.json` (ex:
`workspaces/nextassist/content-calendar.json`) e adicione objetos no formato:

```json
{ "tema": "...", "palavraChaveAlvo": "...", "publicado": false }
```

## Limitações conhecidas / próximos passos

- O agente de editor/SEO confia no modelo para produzir JSON válido —
  se a resposta vier malformada, o pipeline falha naquele dia (sem
  publicar conteúdo quebrado). Vale adicionar retry.
- Não há revisão humana antes da publicação (`publicado: true` direto).
  Se preferir revisar antes, troque para `publicado: false` em
  `publisher.ts` e publique manualmente pelo painel.
- A geração de imagem está implementada só para OpenAI — troque o
  provider em `src/lib/imageGen.ts` se preferir outro serviço.
