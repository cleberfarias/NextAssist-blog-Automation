import type { MarketingWorkspace } from "./workspace.js";
import type { SecretProvider } from "./lib/secrets.js";

export interface SecretStatus {
  key: string;
  required: boolean;
  configured: boolean;
}

/**
 * Confere quais segredos declarados pelo workspace (required/optional) estão
 * de fato configurados no ambiente do servidor — nunca lê nem devolve o
 * valor, só um booleano. Segredos são geridos por variável de ambiente
 * (`EnvSecretProvider`); esta tela nunca aceita nem grava um valor de chave.
 */
export async function getSecretsStatus(workspace: Pick<MarketingWorkspace, "id" | "secrets">, secrets: SecretProvider): Promise<SecretStatus[]> {
  const entries: { key: string; required: boolean }[] = [
    ...workspace.secrets.required.map((key) => ({ key, required: true })),
    ...(workspace.secrets.optional ?? []).map((key) => ({ key, required: false })),
  ];
  return Promise.all(
    entries.map(async ({ key, required }) => ({
      key,
      required,
      configured: Boolean(await secrets.get(workspace.id, key)),
    })),
  );
}
