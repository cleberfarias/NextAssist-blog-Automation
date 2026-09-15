import { describe, it, expect } from "vitest";
import { formatElapsed } from "./formatters";

describe("formatElapsed", () => {
  const now = new Date("2026-09-15T14:00:00.000Z");

  it("mostra minutos quando a duração é menor que 1 hora", () => {
    expect(formatElapsed("2026-09-15T13:37:00.000Z", now)).toBe("23 min");
  });

  it("mostra horas quando a duração é de 1 a 24 horas", () => {
    expect(formatElapsed("2026-09-15T11:00:00.000Z", now)).toBe("3 h");
  });

  it("mostra dias quando a duração passa de 24 horas", () => {
    expect(formatElapsed("2026-09-13T14:00:00.000Z", now)).toBe("2 d");
  });

  it("nunca retorna um valor negativo mesmo com datas futuras", () => {
    expect(formatElapsed("2026-09-15T15:00:00.000Z", now)).toBe("0 min");
  });
});
