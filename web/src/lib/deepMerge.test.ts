import { describe, it, expect } from "vitest";
import { deepMerge } from "./deepMerge";

describe("deepMerge", () => {
  it("mescla uma atualização parcial de uma seção aninhada, preservando os campos irmãos", () => {
    const base = { brand: { name: "Acme", description: "old" }, goals: { primary: "leads" } };
    const result = deepMerge(base, { brand: { description: "new" } });
    expect(result).toEqual({ brand: { name: "Acme", description: "new" }, goals: { primary: "leads" } });
  });

  it("substitui arrays por inteiro em vez de mesclar item a item", () => {
    const base = { pillars: ["a", "b", "c"] };
    const result = deepMerge(base, { pillars: ["x"] });
    expect(result.pillars).toEqual(["x"]);
  });

  it("um patch primitivo substitui o valor base inteiro", () => {
    expect(deepMerge({ a: 1 }, { a: 2 })).toEqual({ a: 2 });
  });

  it("não modifica o objeto base original", () => {
    const base = { brand: { name: "Acme" } };
    deepMerge(base, { brand: { name: "Outro" } });
    expect(base.brand.name).toBe("Acme");
  });
});
