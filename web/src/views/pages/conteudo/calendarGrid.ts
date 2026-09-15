export function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function mondayOffset(date: Date): number {
  return (date.getDay() + 6) % 7; // segunda-feira = 0 ... domingo = 6
}

/** Segunda a domingo da semana que contém `reference`. */
export function getWeekDays(reference: Date): Date[] {
  const monday = new Date(reference.getFullYear(), reference.getMonth(), reference.getDate() - mondayOffset(reference));
  return Array.from({ length: 7 }, (_, i) => new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i));
}

/** Todas as semanas completas (segunda a domingo) que cobrem o mês de `reference`. */
export function getMonthGridDays(reference: Date): Date[] {
  const firstOfMonth = new Date(reference.getFullYear(), reference.getMonth(), 1);
  const lastOfMonth = new Date(reference.getFullYear(), reference.getMonth() + 1, 0);
  const gridStart = new Date(firstOfMonth.getFullYear(), firstOfMonth.getMonth(), firstOfMonth.getDate() - mondayOffset(firstOfMonth));
  const gridEnd = new Date(lastOfMonth.getFullYear(), lastOfMonth.getMonth(), lastOfMonth.getDate() + (6 - mondayOffset(lastOfMonth)));

  const days: Date[] = [];
  const cursor = new Date(gridStart);
  while (cursor.getTime() <= gridEnd.getTime()) {
    days.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}
