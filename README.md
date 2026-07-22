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

**Nunca commite o `.env`** — ele já está coberto por `.gitignore`.

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
