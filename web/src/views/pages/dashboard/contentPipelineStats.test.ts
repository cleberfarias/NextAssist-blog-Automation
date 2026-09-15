import { describe, it, expect } from "vitest";
import { computePipelineStats } from "./contentPipelineStats";
import type { RunRecord, CalendarTopic } from "../../../types/api";

const NOW = new Date("2026-09-15T12:00:00.000Z");

function run(overrides: Partial<RunRecord>): RunRecord {
  return {
    id: "r", origem: "action", iniciadoEm: "2026-09-14T10:00:00.000Z", finalizadoEm: "2026-09-14T10:20:00.000Z",
    tema: "Tema", status: "publicado", slug: "tema", erro: null, eventos: [],
    ...overrides,
  };
}

describe("computePipelineStats", () => {
  it("sem runs nem tópicos, tudo fica zerado/null — nada inventado", () => {
    const stats = computePipelineStats([], [], NOW);
    expect(stats.pendingContent).toBe(0);
    expect(stats.completedLast7Days).toBe(0);
    expect(stats.avgDurationMinutes).toBeNull();
    expect(stats.publishRate).toBeNull();
  });

  it("pendingContent conta só tópicos não publicados", () => {
    const topics: CalendarTopic[] = [
      { tema: "A", palavraChaveAlvo: "a", publicado: false },
      { tema: "B", palavraChaveAlvo: "b", publicado: true },
      { tema: "C", palavraChaveAlvo: "c", publicado: false },
    ];
    expect(computePipelineStats([], topics, NOW).pendingContent).toBe(2);
  });

  it("completedLast7Days conta só runs publicados finalizados nos últimos 7 dias", () => {
    const runs = [
      run({ status: "publicado", finalizadoEm: "2026-09-14T10:20:00.000Z" }), // dentro
      run({ status: "publicado", finalizadoEm: "2026-08-01T10:20:00.000Z" }), // fora (mais de 7 dias)
      run({ status: "falhou", finalizadoEm: "2026-09-14T10:20:00.000Z" }),    // dentro, mas não publicado
    ];
    expect(computePipelineStats(runs, [], NOW).completedLast7Days).toBe(1);
  });

  it("avgDurationMinutes é a média real de finalizadoEm-iniciadoEm dos runs recentes", () => {
    const runs = [
      run({ iniciadoEm: "2026-09-14T10:00:00.000Z", finalizadoEm: "2026-09-14T10:20:00.000Z" }), // 20 min
      run({ iniciadoEm: "2026-09-14T11:00:00.000Z", finalizadoEm: "2026-09-14T11:40:00.000Z" }), // 40 min
    ];
    expect(computePipelineStats(runs, [], NOW).avgDurationMinutes).toBe(30);
  });

  it("publishRate é a razão real publicado/total dos runs recentes, em %", () => {
    const runs = [
      run({ status: "publicado" }),
      run({ status: "publicado" }),
      run({ status: "falhou" }),
      run({ status: "sem-tema" }),
    ];
    expect(computePipelineStats(runs, [], NOW).publishRate).toBe(50);
  });

  it("stageCounts conta, por estágio, quantos runs recentes concluíram aquele evento com status done", () => {
    const runs = [
      run({ eventos: [{ agent: "redator", status: "done", timestamp: "2026-09-14T10:10:00.000Z" }] }),
      run({ eventos: [{ agent: "redator", status: "done", timestamp: "2026-09-14T10:10:00.000Z" }, { agent: "instagram", status: "error", timestamp: "2026-09-14T10:15:00.000Z" }] }),
    ];
    const stats = computePipelineStats(runs, [], NOW);
    expect(stats.stageCounts.redator).toBe(2);
    expect(stats.stageCounts.instagram).toBe(0);
    expect(stats.stageCounts["marketing-director"]).toBe(0);
  });
});
