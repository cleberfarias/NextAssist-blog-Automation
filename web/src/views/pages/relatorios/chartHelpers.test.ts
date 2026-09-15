import { describe, it, expect } from "vitest";
import { pickEvenIndices, formatShortDate, formatSignedPct } from "./chartHelpers";

describe("pickEvenIndices", () => {
  it("com poucos pontos, retorna todos os índices", () => {
    expect(pickEvenIndices(5, 7)).toEqual([0, 1, 2, 3, 4]);
  });

  it("com muitos pontos, retorna um subconjunto espaçado incluindo o primeiro e o último", () => {
    const result = pickEvenIndices(30, 7);
    expect(result[0]).toBe(0);
    expect(result[result.length - 1]).toBe(29);
    expect(result.length).toBeLessThanOrEqual(7);
  });

  it("array vazio retorna vazio", () => {
    expect(pickEvenIndices(0, 7)).toEqual([]);
  });
});

describe("formatShortDate", () => {
  it("converte uma data ISO (YYYY-MM-DD) pra DD/MM", () => {
    expect(formatShortDate("2026-09-14")).toBe("14/09");
  });
});

describe("formatSignedPct", () => {
  it("valores positivos ganham um sinal de mais", () => {
    expect(formatSignedPct(12)).toBe("+12,0");
  });

  it("valores negativos já têm o sinal de menos, sem duplicar", () => {
    expect(formatSignedPct(-5.4)).toBe("-5,4");
  });

  it("usa vírgula decimal (padrão pt-BR), não ponto", () => {
    expect(formatSignedPct(0.6)).toBe("+0,6");
  });
});
