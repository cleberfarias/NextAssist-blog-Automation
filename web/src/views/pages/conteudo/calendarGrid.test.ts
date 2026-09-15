import { describe, it, expect } from "vitest";
import { getWeekDays, getMonthGridDays, isSameDay } from "./calendarGrid";

describe("calendarGrid", () => {
  it("getWeekDays retorna segunda a domingo contendo a data de referência", () => {
    // 2026-09-16 é uma quarta-feira
    const days = getWeekDays(new Date(2026, 8, 16));
    expect(days).toHaveLength(7);
    expect(days[0].getDay()).toBe(1); // segunda
    expect(days[6].getDay()).toBe(0); // domingo
    expect(days[0].getDate()).toBe(14);
    expect(days[6].getDate()).toBe(20);
  });

  it("getWeekDays funciona quando a referência já é segunda-feira", () => {
    const days = getWeekDays(new Date(2026, 8, 14));
    expect(days[0].getDate()).toBe(14);
  });

  it("getMonthGridDays cobre o mês inteiro em semanas completas (segunda a domingo)", () => {
    // Setembro/2026: dia 1 é terça, dia 30 é quarta
    const days = getMonthGridDays(new Date(2026, 8, 15));
    expect(days[0].getDay()).toBe(1);
    expect(days[days.length - 1].getDay()).toBe(0);
    expect(days.length % 7).toBe(0);
    // A grade deve conter todos os dias do mês
    const daysInMonth = days.filter((d) => d.getMonth() === 8);
    expect(daysInMonth).toHaveLength(30);
  });

  it("isSameDay compara apenas ano/mês/dia, ignorando hora", () => {
    expect(isSameDay(new Date(2026, 8, 15, 3, 0), new Date(2026, 8, 15, 23, 59))).toBe(true);
    expect(isSameDay(new Date(2026, 8, 15), new Date(2026, 8, 16))).toBe(false);
  });
});
