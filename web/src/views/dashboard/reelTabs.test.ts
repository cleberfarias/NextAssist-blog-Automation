import { describe, it, expect } from "vitest";
import { filterReelsByTab } from "./reelTabs";
import type { ReelListEntry, ReelStatus } from "../../types/api";

function entry(id: string, status: ReelStatus): ReelListEntry {
  return { id, slug: id, title: id, blogUrl: "", caption: "", status, updatedAt: "2026-09-01T00:00:00.000Z", audit: [] };
}

const ALL: ReelListEntry[] = [
  entry("queued", "queued"),
  entry("rendering", "rendering"),
  entry("pending", "pending_approval"),
  entry("approved", "approved"),
  entry("rejected", "rejected"),
  entry("publishing", "publishing"),
  entry("published", "published"),
  entry("failed", "failed"),
];

describe("filterReelsByTab", () => {
  it("'todos' retorna todos os Reels, sem esconder nenhum", () => {
    expect(filterReelsByTab(ALL, "todos")).toHaveLength(ALL.length);
  });

  it("'em_producao' inclui na fila, renderizando, aprovado (aguardando publicar) e publicando", () => {
    const ids = filterReelsByTab(ALL, "em_producao").map((e) => e.id);
    expect(ids).toEqual(["queued", "rendering", "approved", "publishing"]);
  });

  it("'aguardando_aprovacao' inclui só pending_approval", () => {
    expect(filterReelsByTab(ALL, "aguardando_aprovacao").map((e) => e.id)).toEqual(["pending"]);
  });

  it("'publicados' inclui só published", () => {
    expect(filterReelsByTab(ALL, "publicados").map((e) => e.id)).toEqual(["published"]);
  });

  it("'rejeitados' inclui rejeitados e falhos", () => {
    expect(filterReelsByTab(ALL, "rejeitados").map((e) => e.id)).toEqual(["rejected", "failed"]);
  });
});
