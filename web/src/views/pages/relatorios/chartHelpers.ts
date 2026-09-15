/** Escolhe até `maxLabels` índices igualmente espaçados de um array de tamanho `length`, sempre incluindo o primeiro e o último. */
export function pickEvenIndices(length: number, maxLabels: number): number[] {
  if (length <= 0) return [];
  if (length <= maxLabels) return Array.from({ length }, (_, i) => i);
  const step = (length - 1) / (maxLabels - 1);
  const indices = Array.from({ length: maxLabels }, (_, i) => Math.round(i * step));
  return [...new Set(indices)];
}

/** "2026-09-14" -> "14/09" */
export function formatShortDate(isoDate: string): string {
  const [, month, day] = isoDate.split("-");
  return `${day}/${month}`;
}

/** Formata um número no padrão pt-BR (vírgula decimal), com sinal opcional pra variações. */
export function formatSignedPct(value: number, digits = 1): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toLocaleString("pt-BR", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}
