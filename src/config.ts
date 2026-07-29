import "dotenv/config";

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Variável de ambiente obrigatória ausente: ${name}`);
  }
  return value;
}

function aiProvider(): "openai" | "anthropic" {
  const value = process.env.AI_PROVIDER_PRIMARY ?? "openai";
  if (value !== "openai" && value !== "anthropic") {
    throw new Error("AI_PROVIDER_PRIMARY deve ser 'openai' ou 'anthropic'");
  }
  return value;
}

export const config = {
  aiPrimaryProvider: aiProvider(),
  openaiApiKey: process.env.OPENAI_API_KEY ?? "",
  openaiModel: process.env.OPENAI_MODEL ?? "gpt-5.6",
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? "",
  anthropicModel: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5",

  blogApiUrl: process.env.BLOG_API_URL ??
    "https://rr-infocell-api-91248386036.southamerica-east1.run.app",
  blogAutor: process.env.BLOG_AUTOR ?? "NextAssist",

  // Domínio público onde os posts são acessados (para indexação e métricas).
  siteBaseUrl: (process.env.SITE_BASE_URL ?? "https://www.nextassist-app.com.br")
    .replace(/\/$/, ""),
  // Propriedade cadastrada no Google Search Console. Prefixo de URL
  // (ex: "https://www.nextassist-app.com.br/") ou domínio ("sc-domain:...").
  searchConsoleSiteUrl:
    process.env.SEARCH_CONSOLE_SITE_URL ?? "sc-domain:nextassist-app.com.br",
  // URL do sitemap (reenviado ao Search Console após cada publicação).
  sitemapUrl:
    process.env.SITEMAP_URL ?? "https://www.nextassist-app.com.br/sitemap.xml",

  firebaseWebApiKey: required("FIREBASE_WEB_API_KEY"),
  firebaseAdminEmail: required("FIREBASE_ADMIN_EMAIL"),
  firebaseAdminPassword: required("FIREBASE_ADMIN_PASSWORD"),

  firebaseServiceAccountJson: required("FIREBASE_SERVICE_ACCOUNT_JSON"),
  firebaseStorageBucket: required("FIREBASE_STORAGE_BUCKET"),

  imageGenProvider: process.env.IMAGE_GEN_PROVIDER ?? "openai",
  imageGenApiKey: process.env.IMAGE_GEN_API_KEY ?? "",

  // Instagram (Graph API da Meta). Requer conta Business/Creator conectada a
  // uma Página do Facebook. Se userId ou accessToken estiverem vazios, o passo
  // do Instagram é ignorado (melhor esforço — não derruba o post do blog).
  instagram: {
    // ID da conta do Instagram (IG Business Account ID), não o @usuário.
    userId: process.env.IG_USER_ID ?? "",
    // Token de acesso de longa duração da Página/app da Meta.
    accessToken: process.env.IG_ACCESS_TOKEN ?? "",
    apiVersion: process.env.IG_API_VERSION ?? "v21.0",
  },

  // De onde o painel lê os arquivos de estado (histórico, execuções):
  //  - "local": lê do disco (rodando na sua máquina após um git pull)
  //  - "github": busca os arquivos crus do repositório (painel hospedado,
  //    que não recebe os commits da Action diretamente)
  dataSource: (process.env.DATA_SOURCE ?? "local") as "local" | "github",
  githubRepo: process.env.GITHUB_REPO ?? "cleberfarias/NextAssist-blog-Automation",
  githubBranch: process.env.GITHUB_BRANCH ?? "main",
  // Token de leitura (contents:read). Necessário se o repositório for
  // privado; opcional (só evita rate limit) se for público.
  githubToken: process.env.PANEL_GITHUB_TOKEN ?? process.env.GITHUB_TOKEN ?? "",
  // Senha do painel (Basic Auth). Vazio = sem proteção (ok localmente).
  // Defina ao hospedar publicamente.
  panelPassword: process.env.PANEL_PASSWORD ?? "",
  requireApproval: process.env.REQUIRE_APPROVAL === "true",
  demoPath: process.env.DEMO_PATH ?? "/demo",
};
