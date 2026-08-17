/** Resolve segredos (valores) por workspace. Nunca armazena, só lê. */
export interface SecretProvider {
  get(workspaceId: string, key: string): Promise<string | undefined>;
}

/**
 * Implementação inicial: variáveis de ambiente, prefixadas pelo id do
 * workspace (ex: `ACME_ANTHROPIC_API_KEY`), com fallback para a variável sem
 * prefixo — cobre o caso de um único workspace configurado localmente
 * (`.env`) sem precisar prefixar nada. Trocar por Secret Manager no futuro é
 * só uma nova implementação desta mesma interface.
 */
export class EnvSecretProvider implements SecretProvider {
  async get(workspaceId: string, key: string): Promise<string | undefined> {
    const prefix = workspaceId.toUpperCase().replace(/-/g, "_");
    return process.env[`${prefix}_${key}`] ?? process.env[key];
  }
}
