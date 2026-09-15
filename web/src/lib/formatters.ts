export const nf = new Intl.NumberFormat("pt-BR");
export const usd = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "USD" });

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR");
}

export function formatTime(date: Date): string {
  return date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}
