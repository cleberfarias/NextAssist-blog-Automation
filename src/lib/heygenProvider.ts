export type HeyGenProviderName = "heygen-mcp" | "heygen-api";
export type HeyGenRuntimeMode = "interactive" | "headless";

export interface HeyGenProviderStrategy {
  provider: HeyGenProviderName;
  runtimeProviders?: Partial<Record<HeyGenRuntimeMode, HeyGenProviderName>>;
}

const KNOWN_HEYGEN_PROVIDERS = new Set<HeyGenProviderName>(["heygen-mcp", "heygen-api"]);

/**
 * Seleção explícita de provider por modo de runtime. Sem `runtimeProviders`
 * configurado, o modo herda sempre `provider` — nunca troca MCP por API (ou
 * vice-versa) por conta própria. Modo padrão é `headless`, já que é o caso de
 * uso do pipeline automatizado (GitHub Actions).
 */
export function selectHeyGenProvider(
  strategy: HeyGenProviderStrategy | undefined,
  mode: HeyGenRuntimeMode = "headless",
): HeyGenProviderName | undefined {
  if (!strategy) return undefined;
  const configured = strategy.runtimeProviders?.[mode] ?? strategy.provider;
  if (!KNOWN_HEYGEN_PROVIDERS.has(configured as HeyGenProviderName)) {
    throw new Error(`Provider HeyGen desconhecido: "${configured}". Configure runtimeProviders.${mode} ou provider explicitamente.`);
  }
  return configured as HeyGenProviderName;
}
