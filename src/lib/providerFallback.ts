type ProviderError = Error & {
  status?: number;
  code?: string;
};

const RECOVERABLE_CODES = new Set([
  "ECONNABORTED",
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
]);

const CREDIT_MESSAGES = [
  "credit balance",
  "insufficient_quota",
  "billing",
  "quota exceeded",
];

export function isRecoverableProviderError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;

  const providerError = error as ProviderError;
  if (providerError.status === 408 || providerError.status === 409 || providerError.status === 429) {
    return true;
  }
  if (providerError.status && providerError.status >= 500) return true;
  if (providerError.code && RECOVERABLE_CODES.has(providerError.code)) return true;

  const message = providerError.message.toLowerCase();
  return CREDIT_MESSAGES.some((part) => message.includes(part));
}

export async function executeWithFallback<T>(params: {
  primary: () => Promise<T>;
  fallback?: () => Promise<T>;
}): Promise<{ value: T; usedFallback: boolean }> {
  try {
    return { value: await params.primary(), usedFallback: false };
  } catch (error) {
    if (!params.fallback || !isRecoverableProviderError(error)) throw error;
    return { value: await params.fallback(), usedFallback: true };
  }
}
