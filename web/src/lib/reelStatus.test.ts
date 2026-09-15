import { describe, it, expect } from "vitest";
import { pickFeaturedReel } from "./reelStatus";
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
