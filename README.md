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
5. **Publicador** (`src/agents/publisher.ts`) — gera a imagem de capa,
   sobe pro Firebase Storage, autentica no Firebase Auth e publica via
   `POST /blog/admin/posts`
6. **Indexador** (`src/agents/indexer.ts`) — notifica a Google Indexing
   API sobre a nova URL e reenvia o sitemap ao Search Console, para
   acelerar o rastreamento (melhor esforço; não derruba o pipeline se
   falhar, já que o post já foi publicado)

Os temas vêm de `content-calendar.json`. Cada execução consome o
próximo tema não publicado e marca como `publicado: true` ao final.
Quando a lista acabar, adicione novos tópicos nesse arquivo.

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
| `ANTHROPIC_API_KEY` | console.anthropic.com |
| `FIREBASE_WEB_API_KEY` | Console Firebase → Configurações do projeto → Geral |
| `FIREBASE_ADMIN_EMAIL` / `FIREBASE_ADMIN_PASSWORD` | Usuário admin já usado no painel `/admin/blog` |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | Console Firebase → Contas de serviço → Gerar nova chave privada (colar o JSON inteiro em uma linha) |
| `FIREBASE_STORAGE_BUCKET` | Console Firebase → Storage (ex: `nextassist-app.appspot.com`) |
| `IMAGE_GEN_API_KEY` | Chave da API de geração de imagem (padrão: OpenAI) |
| `SITE_BASE_URL` | Domínio público do blog (ex: `https://www.nextassist-app.com.br`) |
| `SEARCH_CONSOLE_SITE_URL` | Propriedade no Search Console (prefixo de URL ou `sc-domain:...`) |
| `SITEMAP_URL` | URL do sitemap reenviado ao Google |

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
  `panel-state/post-performance.json`, sobrevivendo ao encerramento ou à
  recriação da instância.

Cada execução do pipeline grava um registro detalhado em
`runs-history.json`, que a Action commita de volta (inclusive quando
falha) — é assim que o painel confirma o que a automação realmente fez.

### Hospedando o painel sempre online

Se rodar o painel num serviço (Cloud Run, Render etc.), ele não recebe os
commits da Action diretamente. Defina `DATA_SOURCE=github` no ambiente do
servidor para que ele leia os arquivos de estado (`runs-history.json`,
`post-history.json`) via API do GitHub — assim o painel reflete as
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
- **Execução manual desligada no ar:** no modo hospedado o botão "Rodar
  pipeline agora" some. A publicação roda só pela GitHub Action (fonte
  única da verdade) — rodar manualmente no host geraria post duplicado,
  já que o estado atualizado não é commitado de volta.
- **Seções "Execuções" e "Posts publicados":** só populam se o
  `PANEL_GITHUB_TOKEN` estiver configurado (repo privado). O "Desempenho no
  Google" funciona sem token (usa a API do blog + Search Console).

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

Edite `content-calendar.json` e adicione objetos no formato:

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
