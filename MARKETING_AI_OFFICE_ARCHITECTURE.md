# Marketing AI Office — Evolução para Plataforma Autônoma

## Visão

Este documento descreve a evolução do projeto atual de automação de marketing para uma plataforma multiempresa, orientada por agentes de IA, capaz de planejar, executar, medir e otimizar ações de marketing com autonomia controlada.

O objetivo não é criar apenas um gerador de conteúdo, mas um **escritório autônomo de marketing com IA**, no qual agentes especializados trabalham coordenados por um agente diretor, utilizando integrações, memória operacional e métricas reais de negócio.

---

## Estado atual

Hoje o sistema já possui um pipeline funcional composto por agentes especializados:

```text
Pesquisa de mercado
        ↓
Planejamento de pauta
        ↓
Redação
        ↓
Editor / SEO
        ↓
Publicação no blog
        ↓
Instagram
        ↓
Indexação Google
```

O sistema também já possui:

- execução automática via GitHub Actions;
- painel visual de agentes;
- histórico de execuções;
- métricas de uso de LLM;
- integração com Search Console;
- geração de imagem;
- geração e publicação de Reels;
- publicação automática no blog;
- acompanhamento de conversões;
- fallback entre provedores de IA;
- execução manual via painel;
- controle de concorrência;
- autenticação do painel;
- ingestão de eventos em tempo real.

Essa arquitetura é uma boa base, mas hoje ainda funciona principalmente como um pipeline linear.

---

# Objetivo da próxima versão

Transformar o sistema em uma plataforma onde cada cliente possui seu próprio ambiente de marketing:

```text
Marketing AI Office
        │
        ├── Workspace NextAssist
        ├── Workspace ChatGuru
        ├── Workspace Cliente A
        └── Workspace Cliente B
```

Cada workspace terá:

- identidade da marca;
- objetivos;
- concorrentes;
- canais;
- integrações;
- credenciais próprias;
- memória;
- histórico;
- métricas;
- estratégia;
- regras de autonomia.

---

# Arquitetura alvo

```text
                    OBJETIVOS DO CLIENTE
                            ↓
                   MARKETING DIRECTOR
                            ↓
          ┌─────────────────┼─────────────────┐
          ↓                 ↓                 ↓
   Market Research      Analytics         SEO Agent
          ↓                 ↓                 ↓
   Concorrentes        Performance      Oportunidades
          └─────────────────┼─────────────────┘
                            ↓
                   MARKETING DIRECTOR
                            ↓
                     PLANO DE AÇÃO
                            ↓
         ┌──────────────────┼──────────────────┐
         ↓                  ↓                  ↓
      Writer            Social Agent       SEO Agent
         ↓                  ↓                  ↓
       Blog          LinkedIn/Instagram   Atualizações
         └──────────────────┼──────────────────┘
                            ↓
                        Analytics
                            ↓
                     Aprendizado
                            ↓
                   Marketing Director
                            ↺
```

---

# 1. Multi-workspace

A primeira mudança estrutural deve ser remover configurações específicas do NextAssist do núcleo da aplicação.

## Entidade sugerida

```ts
export interface MarketingWorkspace {
  id: string;
  name: string;

  brand: {
    name: string;
    description: string;
    toneOfVoice: string;
    targetAudience: string[];
    competitors: string[];
    forbiddenTerms?: string[];
    valuePropositions?: string[];
  };

  goals: {
    primary: "leads" | "traffic" | "brand" | "sales";
    monthlyLeadTarget?: number;
    monthlyTrafficTarget?: number;
  };

  channels: {
    blog: boolean;
    instagram: boolean;
    linkedin: boolean;
  };

  integrations: {
    siteUrl: string;
    searchConsole?: boolean;
    instagram?: boolean;
    linkedin?: boolean;
    cms?: string;
  };

  autonomy: {
    mode: "copilot" | "semi-autonomous" | "autonomous";
  };
}
```

## Estrutura sugerida

```text
src/
 ├── core/
 ├── workspaces/
 ├── agents/
 ├── skills/
 ├── memory/
 ├── integrations/
 ├── analytics/
 └── orchestration/
```

---

# 2. Marketing Director Agent

O Marketing Director será responsável por decidir quais ações devem ser executadas.

Ele não deve produzir conteúdo diretamente.

## Responsabilidades

- analisar objetivos do cliente;
- analisar métricas;
- analisar Search Console;
- analisar conversões;
- identificar oportunidades;
- priorizar ações;
- distribuir trabalho para outros agentes;
- avaliar resultados;
- ajustar próximas decisões.

## Exemplo de entrada

```json
{
  "objective": "increase_leads",
  "metrics": {
    "impressions": 125000,
    "clicks": 4700,
    "conversions": 86
  },
  "publishedPosts": 32,
  "pendingTasks": 4
}
```

## Exemplo de resposta

```json
{
  "diagnosis": "High impressions and low CTR in WhatsApp automation content.",
  "priorities": [
    {
      "action": "update_article",
      "slug": "automacao-whatsapp",
      "reason": "18k impressions and 0.9% CTR"
    },
    {
      "action": "create_article",
      "keyword": "agente de ia para whatsapp"
    },
    {
      "action": "create_linkedin_post",
      "topic": "IA aplicada ao atendimento comercial"
    }
  ]
}
```

---

# 3. Skills

Os agentes não devem ter liberdade irrestrita.

Eles devem operar através de Skills explícitas e controladas.

## Skills iniciais

```text
researchCompetitors
searchKeywords
analyzeSearchConsole
analyzeConversions
createArticle
updateArticle
createInstagramReel
createLinkedinPost
publishBlog
publishInstagram
publishLinkedin
refreshSearchMetrics
generateContentBacklog
```

## Exemplo

```ts
export type MarketingAction =
  | "create_article"
  | "update_article"
  | "create_instagram_post"
  | "create_linkedin_post"
  | "research_competitor"
  | "analyze_performance";
```

O Director escolhe apenas ações permitidas.

---

# 4. Agentes

## Marketing Director

Coordena o escritório.

## Market Research Agent

Responsável por:

- concorrentes;
- tendências;
- posicionamento;
- oportunidades de pauta.

## SEO Agent

Responsável por:

- Search Console;
- CTR;
- palavras-chave;
- conteúdo decadente;
- links internos;
- atualização de artigos.

## Writer Agent

Responsável por:

- artigos;
- landing pages;
- textos longos;
- reaproveitamento de conteúdo.

## Social Agent

Responsável por:

- Instagram;
- LinkedIn;
- Reels;
- carrosséis;
- legendas;
- conteúdo derivado.

## Analytics Agent

Responsável por:

- impressões;
- cliques;
- CTR;
- conversões;
- custo de IA;
- desempenho por canal.

## Conversion Agent

Responsável por:

- CTAs;
- demos;
- contatos;
- WhatsApp;
- páginas de conversão.

---

# 5. Memória

A plataforma deve possuir memória por workspace.

## Brand Memory

Armazena:

- produto;
- ICP;
- público-alvo;
- tom de voz;
- diferenciais;
- concorrentes;
- palavras proibidas;
- cases;
- CTAs;
- posicionamento.

## Operational Memory

Armazena:

- o que foi publicado;
- quando;
- onde;
- qual agente executou;
- custo;
- status;
- erro;
- histórico.

## Learning Memory

Armazena aprendizado baseado em resultado.

Exemplo:

```text
Conteúdo A
→ 15 leads

Conteúdo B
→ 0 leads

CTA A
→ 3.2% conversão

CTA B
→ 0.7% conversão

Conteúdo sobre automação
→ 3.4x mais demos
```

Essa memória deve influenciar novas decisões do Marketing Director.

---

# 6. Estratégia automática de conteúdo

O `content-calendar.json` não deve continuar sendo o ponto único de entrada.

O sistema deve gerar seu próprio backlog.

## Fluxo

```text
Backlog < limite
        ↓
Marketing Director
        ↓
Research Agent
        ↓
SEO Agent
        ↓
Analytics Agent
        ↓
generateContentBacklog()
        ↓
15-30 novas oportunidades
```

O calendário passa a ser consequência da estratégia, não entrada manual obrigatória.

---

# 7. LinkedIn

LinkedIn deve ser tratado como canal prioritário para clientes B2B.

## Reaproveitamento

```text
Artigo SEO
    ↓
 ┌──┴─────────────┐
 ↓                ↓
LinkedIn       Instagram
 ↓                ↓
Post            Reel
 ↓
Carrossel
```

Um único tema pode gerar vários ativos.

---

# 8. Níveis de autonomia

## Copilot

```text
IA recomenda
     ↓
Humano aprova
     ↓
Executa
```

Indicado para novos clientes.

## Semi-autônomo

```text
Conteúdo orgânico → automático
Campanhas críticas → aprovação
```

Recomendado para primeiros clientes B2B.

## Autônomo

```text
Director
   ↓
Decide
   ↓
Executa
   ↓
Mede
   ↓
Aprende
   ↺
```

Só deve ser habilitado após confiança e histórico suficientes.

---

# 9. Dashboard

O painel deve evoluir de visualização de agentes para central de comando.

## Objetivos

```text
OBJETIVO DO MÊS

Leads
81 / 100

Tráfego orgânico
+18%

Conversão
2.7%

Custo IA
R$ 46,30
```

## Recomendações

```text
MARKETING DIRECTOR

⚠ Artigo com 13.400 impressões e CTR 0,8%

💡 Recomendo alterar título e meta description.

🚀 Palavra-chave "agente IA atendimento"
apresentando crescimento.

📊 Conteúdos sobre automação geram
3.4x mais demos.
```

## Escritório

O painel atual dos agentes pode continuar existindo abaixo dos indicadores.

---

# 10. Integrações

Cada workspace deve poder configurar suas próprias integrações.

## LLM

- OpenAI;
- Anthropic;
- Gemini;
- outros providers futuros.

Preferencialmente em modelo BYOK:

```text
Bring Your Own Key
```

O cliente paga diretamente o consumo do provedor.

## Google

- Search Console;
- Analytics;
- Indexing;
- sitemap.

## Social

- Instagram Graph API;
- LinkedIn API.

## CMS

Criar uma abstração:

```ts
interface CmsProvider {
  createPost(input: CreatePostInput): Promise<PostResult>;
  updatePost(id: string, input: UpdatePostInput): Promise<PostResult>;
}
```

Depois implementar:

```text
NextAssist CMS
WordPress
Webflow
Ghost
HubSpot
Custom API
```

---

# 11. Segurança

## Requisitos

- nunca armazenar chaves de clientes em arquivos versionados;
- usar Secret Manager ou solução equivalente;
- separar credenciais por workspace;
- validar todas as ações propostas pelo LLM;
- registrar auditoria;
- adicionar rate limit;
- adicionar timeout por agente;
- adicionar retry controlado;
- adicionar circuit breaker por integração;
- evitar execução duplicada;
- controlar permissões por cliente;
- nunca permitir que texto retornado pelo LLM execute código arbitrário.

---

# 12. Observabilidade

Cada execução deve gerar um trace.

## Estrutura

```json
{
  "workspace": "chatguru",
  "runId": "uuid",
  "startedAt": "...",
  "goal": "increase_leads",
  "actions": [],
  "tokens": {},
  "cost": {},
  "results": {},
  "status": "completed"
}
```

Métricas importantes:

- tokens;
- custo;
- tempo;
- erro;
- retry;
- fallback;
- conversão;
- canal;
- receita atribuída;
- conteúdo produzido.

---

# 13. Primeira implementação comercial

## Cliente piloto

Usar um cliente real como design partner.

Workspace:

```text
workspace-chatguru
```

## Configuração

```text
Brand Memory
+
Blog / CMS
+
Search Console
+
Instagram
+
LinkedIn
+
LLM do cliente
+
Analytics
```

## Inicialmente

Usar modo:

```text
semi-autonomous
```

## Medir

- conteúdos produzidos;
- horas humanas economizadas;
- tráfego;
- CTR;
- leads;
- conversões;
- custo de IA;
- ações executadas;
- taxa de erro.

Esses dados devem formar o primeiro case comercial.

---

# 14. Modelo de produto

A plataforma fornece:

```text
Marketing Director
Agents
Skills
Memória
Orquestração
Dashboard
Observabilidade
Segurança
Integrações
```

O cliente fornece:

```text
Identidade
Objetivos
LLM/API Keys
CMS
Google
Redes sociais
Dados
```

---

# Roadmap

## P0 — Base multiempresa

- [ ] Criar entidade `Workspace`
- [ ] Remover configurações NextAssist hardcoded
- [ ] Isolar credenciais por workspace
- [ ] Criar configuração de marca
- [ ] Criar configuração de objetivos
- [ ] Criar configuração de canais
- [ ] Criar abstração de CMS

## P0 — Marketing Director

- [ ] Criar `MarketingDirectorAgent`
- [ ] Definir schema de decisões
- [ ] Criar enum de ações permitidas
- [ ] Validar ações retornadas pelo LLM
- [ ] Criar executor de plano
- [ ] Registrar decisões no histórico

## P0 — Memória

- [ ] Brand Memory
- [ ] Operational Memory
- [ ] Learning Memory
- [ ] Persistência por workspace

## P1 — Estratégia automática

- [ ] Remover dependência exclusiva do `content-calendar.json`
- [ ] Criar geração automática de backlog
- [ ] Integrar Search Console na decisão
- [ ] Integrar conversões na decisão
- [ ] Integrar concorrentes na decisão
- [ ] Priorizar ações por potencial de impacto

## P1 — LinkedIn

- [ ] Criar `LinkedInAgent`
- [ ] Criar Skill `createLinkedinPost`
- [ ] Criar Skill `publishLinkedin`
- [ ] Reaproveitar artigos em conteúdo social
- [ ] Suportar post, carrossel e conteúdo executivo

## P1 — Dashboard

- [ ] Objetivos mensais
- [ ] KPIs
- [ ] Recomendações do Director
- [ ] Histórico de decisões
- [ ] Custos
- [ ] Conversões
- [ ] Performance por canal

## P1 — Segurança

- [ ] Rate limiting
- [ ] Auditoria
- [ ] Timeout
- [ ] Retry
- [ ] Circuit breaker
- [ ] RBAC
- [ ] Secret Manager por workspace

## P2 — Escala

- [ ] Banco de dados central
- [ ] Filas
- [ ] Workers independentes
- [ ] Scheduler por workspace
- [ ] Event bus
- [ ] isolamento de execução
- [ ] limites por plano
- [ ] billing

## P2 — Produto SaaS

- [ ] onboarding do cliente;
- [ ] wizard de integrações;
- [ ] gestão de API keys;
- [ ] gestão de canais;
- [ ] gestão de usuários;
- [ ] planos;
- [ ] cobrança;
- [ ] trial;
- [ ] logs;
- [ ] alertas.

---

# Ordem recomendada de implementação

```text
1. Multi-workspace
        ↓
2. Marketing Director
        ↓
3. Memória
        ↓
4. Analytics + decisão
        ↓
5. Backlog automático
        ↓
6. LinkedIn
        ↓
7. Dashboard estratégico
        ↓
8. Segurança / observabilidade
        ↓
9. Piloto B2B
        ↓
10. SaaS multi-tenant
```

---

# Princípios do projeto

1. O LLM sugere; o sistema valida.
2. Nenhum agente executa ações fora de suas Skills.
3. Toda ação precisa ser auditável.
4. Toda decisão deve ter contexto e motivo.
5. Toda execução deve gerar métricas.
6. O sistema deve aprender com resultados.
7. Cada cliente deve estar isolado.
8. Custos de IA devem ser transparentes.
9. O cliente pode usar suas próprias API keys.
10. Autonomia deve ser configurável.

---

# Definição do produto

> **Marketing AI Office é uma plataforma de operação autônoma de marketing baseada em agentes especializados, capaz de planejar, executar, medir e otimizar ações de marketing utilizando dados reais de cada empresa.**

O diferencial não é apenas gerar conteúdo com IA.

O diferencial é:

```text
Objetivo
   ↓
Decisão
   ↓
Execução
   ↓
Medição
   ↓
Aprendizado
   ↺
```

Esse loop é o núcleo do produto.
