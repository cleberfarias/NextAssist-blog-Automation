import "dotenv/config";

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Variável de ambiente obrigatória ausente: ${name}`);
  }
  return value;
}

export const config = {
  anthropicApiKey: required("ANTHROPIC_API_KEY"),

  blogApiUrl: process.env.BLOG_API_URL ??
    "https://rr-infocell-api-91248386036.southamerica-east1.run.app",
  blogAutor: process.env.BLOG_AUTOR ?? "NextAssist",

  // Domínio público onde os posts são acessados (para indexação e métricas).
  siteBaseUrl: (process.env.SITE_BASE_URL ?? "https://www.nextassist-app.com.br")
    .replace(/\/$/, ""),
  // Propriedade cadastrada no Google Search Console. Prefixo de URL
  // (ex: "https://www.nextassist-app.com.br/") ou domínio ("sc-domain:...").
  searchConsoleSiteUrl:
    process.env.SEARCH_CONSOLE_SITE_URL ?? "https://www.nextassist-app.com.br/",
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
};
