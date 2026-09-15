function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Mescla recursivamente objetos simples; arrays e valores primitivos do patch substituem o valor base inteiro. */
export function deepMerge<T>(base: T, patch: unknown): T {
  if (!isPlainObject(base) || !isPlainObject(patch)) return patch as T;
  const result: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    result[key] = deepMerge((base as Record<string, unknown>)[key], value);
  }
  return result as T;
}
