export const nf = new Intl.NumberFormat("pt-BR");
export const usd = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "USD" });

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR");
}

export function formatTime(date: Date): string {
  return date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

/** Duração decorrida desde `fromIso` até `now`, em texto curto ("12 min", "3 h", "2 d"). */
export function formatElapsed(fromIso: string, now: Date = new Date()): string {
  const ms = Math.max(0, now.getTime() - new Date(fromIso).getTime());
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h`;
  const days = Math.round(hours / 24);
  return `${days} d`;
}
