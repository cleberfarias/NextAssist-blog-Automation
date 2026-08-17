// src/lib/text.ts

/** Remove acentos, baixa a caixa e normaliza espaços — base para comparação de texto tolerante a variação. */
export function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

function tokenize(value: string): Set<string> {
  return new Set(normalizeText(value).split(/[^a-z0-9]+/).filter(Boolean));
}

/**
 * Similaridade de Jaccard (interseção / união) sobre o conjunto de palavras
 * normalizadas de cada texto. Usado para detectar pautas "muito parecidas"
 * sem precisar de embeddings/banco vetorial (fora de escopo desta fase).
 */
export function jaccardSimilarity(a: string, b: string): number {
  const tokensA = tokenize(a);
  const tokensB = tokenize(b);
  if (tokensA.size === 0 || tokensB.size === 0) return 0;

  let intersection = 0;
  for (const token of tokensA) if (tokensB.has(token)) intersection++;
  const union = tokensA.size + tokensB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}
