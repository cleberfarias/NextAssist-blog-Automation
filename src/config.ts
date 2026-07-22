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

  firebaseWebApiKey: required("FIREBASE_WEB_API_KEY"),
  firebaseAdminEmail: required("FIREBASE_ADMIN_EMAIL"),
  firebaseAdminPassword: required("FIREBASE_ADMIN_PASSWORD"),

  firebaseServiceAccountJson: required("FIREBASE_SERVICE_ACCOUNT_JSON"),
  firebaseStorageBucket: required("FIREBASE_STORAGE_BUCKET"),

  imageGenProvider: process.env.IMAGE_GEN_PROVIDER ?? "openai",
  imageGenApiKey: process.env.IMAGE_GEN_API_KEY ?? "",
};
