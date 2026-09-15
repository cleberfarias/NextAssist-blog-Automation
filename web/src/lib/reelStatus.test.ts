import { describe, it, expect } from "vitest";
import { pickFeaturedReel, extractHttpCode, currentStepLabel, reelCardStatusLabel } from "./reelStatus";
import type { ReelListEntry } from "../types/api";

function entry(overrides: Partial<ReelListEntry>): ReelListEntry {
  return { id: "id", slug: "slug", title: "title", blogUrl: "", caption: "", status: "queued", updatedAt: "2026-09-01T00:00:00.000Z", audit: [], ...overrides };
}

describe("pickFeaturedReel", () => {
  it("retorna null quando não há Reels", () => {
    expect(pickFeaturedReel([])).toBeNull();
  });

  it("prioriza um Reel com falha sobre qualquer outro estado", () => {
    const entries = [entry({ id: "a", status: "published" }), entry({ id: "b", status: "failed" }), entry({ id: "c", status: "rendering" })];
    expect(pickFeaturedReel(entries)?.id).toBe("b");
  });

  it("na ausência de falha, prioriza um Reel em renderização", () => {
    const entries = [entry({ id: "a", status: "published" }), entry({ id: "b", status: "rendering" })];
    expect(pickFeaturedReel(entries)?.id).toBe("b");
  });

  it("na ausência de falha/renderização, prioriza aguardando aprovação", () => {
    const entries = [entry({ id: "a", status: "published" }), entry({ id: "b", status: "pending_approval" })];
    expect(pickFeaturedReel(entries)?.id).toBe("b");
  });

  it("sem nenhum caso prioritário, cai para o mais recentemente atualizado", () => {
    const entries = [
      entry({ id: "a", status: "published", updatedAt: "2026-09-01T00:00:00.000Z" }),
      entry({ id: "b", status: "published", updatedAt: "2026-09-10T00:00:00.000Z" }),
    ];
    expect(pickFeaturedReel(entries)?.id).toBe("b");
  });
});

describe("extractHttpCode", () => {
  it("extrai o código HTTP real de uma mensagem de erro", () => {
    expect(extractHttpCode("HeyGen API: resposta HTTP 402.")).toBe("402");
  });

  it("retorna null quando a mensagem não tem um código HTTP", () => {
    expect(extractHttpCode("Falha de rede desconhecida.")).toBeNull();
  });

  it("retorna null quando não há mensagem de erro", () => {
    expect(extractHttpCode(undefined)).toBeNull();
  });
});

describe("currentStepLabel", () => {
  it("usa o rótulo do último passo real da timeline quando disponível", () => {
    const e = entry({ status: "rendering", timelineSteps: [{ step: "roteiro_gerado", at: "t1" }, { step: "processando", at: "t2" }] });
    expect(currentStepLabel(e)).toBe("Processando na HeyGen");
  });

  it("sem timeline registrada, cai para o rótulo do status bruto", () => {
    const e = entry({ status: "queued" });
    expect(currentStepLabel(e)).toBe("Na fila");
  });
});

describe("reelCardStatusLabel", () => {
  it("Reel com falha mostra o código HTTP real extraído do erro", () => {
    const e = entry({ status: "failed", error: "HeyGen API: resposta HTTP 402." });
    expect(reelCardStatusLabel(e)).toBe("Falhou (402)");
  });

  it("Reel com falha sem código HTTP na mensagem mostra só 'Falhou'", () => {
    const e = entry({ status: "failed", error: "Erro desconhecido." });
    expect(reelCardStatusLabel(e)).toBe("Falhou");
  });

  it("para os demais status, usa o passo atual da timeline (ou o status bruto)", () => {
    const e = entry({ status: "pending_approval" });
    expect(reelCardStatusLabel(e)).toBe("Aguardando aprovação");
  });
});
