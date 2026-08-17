/** Resolve segredos (valores) por workspace. Nunca armazena, só lê. */
export interface SecretProvider {
  get(workspaceId: string, key: string): Promise<string | undefined>;
}

export interface EnvSecretProviderOptions {
  /**
   * Quando `true`, uma variável de ambiente sem prefixo (ex: `OPENAI_API_KEY`)
   * é usada como fallback se a versão prefixada pelo workspace não existir —
   * conveniente para dev local com um único workspace configurado no `.env`.
   * Com mais de um workspace no mesmo processo/ambiente, esse fallback pode
   * fazer um workspace mal configurado silenciosamente herdar a credencial
   * de outro. Padrão: `true` fora de produção (`NODE_ENV !== "production"`),
   * `false` em produção — onde cada workspace deve ter seus próprios
   * segredos prefixados.
   */
  allowGlobalFallback?: boolean;
}

/**
 * Implementação inicial: variáveis de ambiente, prefixadas pelo id do
 * workspace (ex: `ACME_ANTHROPIC_API_KEY`). Trocar por Secret Manager no
 * futuro é só uma nova implementação desta mesma interface.
 */
export class EnvSecretProvider implements SecretProvider {
  private readonly allowGlobalFallback: boolean;

  constructor(options: EnvSecretProviderOptions = {}) {
    this.allowGlobalFallback = options.allowGlobalFallback ?? process.env.NODE_ENV !== "production";
  }

  async get(workspaceId: string, key: string): Promise<string | undefined> {
    const prefix = workspaceId.toUpperCase().replace(/-/g, "_");
    const prefixed = process.env[`${prefix}_${key}`];
    if (prefixed !== undefined) return prefixed;
    return this.allowGlobalFallback ? process.env[key] : undefined;
  }
}
