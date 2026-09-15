import { describe, it, expect } from "vitest";
import { buildContentCalendarEvents } from "./contentCalendarEvents";
import type { CalendarTopic, ReelListEntry } from "../../../types/api";

describe("buildContentCalendarEvents", () => {
  it("inclui posts de blog publicados, usando a data real de publicação", () => {
    const topics: CalendarTopic[] = [
      { tema: "Post publicado", palavraChaveAlvo: "kw", publicado: true, publicadoEm: "2026-09-14T10:00:00.000Z" },
      { tema: "Pauta pendente (sem data)", palavraChaveAlvo: "kw2", publicado: false },
    ];
    const events = buildContentCalendarEvents(topics, []);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "blog", title: "Post publicado", statusLabel: "Publicado" });
    expect(events[0].date.toISOString()).toBe("2026-09-14T10:00:00.000Z");
  });

  it("nunca inventa uma data para pautas pendentes sem publicadoEm", () => {
    const topics: CalendarTopic[] = [{ tema: "Sem data", palavraChaveAlvo: "kw", publicado: false }];
    expect(buildContentCalendarEvents(topics, [])).toHaveLength(0);
  });

  it("inclui Reels usando a data real de updatedAt e o status traduzido", () => {
    const reels: ReelListEntry[] = [{
      id: "r1", slug: "r1-slug", title: "Reel de teste", blogUrl: "https://x", caption: "legenda",
      status: "pending_approval", updatedAt: "2026-09-15T18:00:00.000Z", audit: [],
    }];
    const events = buildContentCalendarEvents([], reels);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "reel", title: "Reel de teste", statusLabel: "Aguardando aprovação", href: "/reels/r1",
    });
  });

  it("ordena blog e reels juntos por data crescente", () => {
    const topics: CalendarTopic[] = [
      { tema: "Depois", palavraChaveAlvo: "kw", publicado: true, publicadoEm: "2026-09-16T00:00:00.000Z" },
    ];
    const reels: ReelListEntry[] = [{
      id: "r1", slug: "r1", title: "Antes", blogUrl: "https://x", caption: "c",
      status: "published", updatedAt: "2026-09-10T00:00:00.000Z", audit: [],
    }];
    const events = buildContentCalendarEvents(topics, reels);
    expect(events.map((e) => e.title)).toEqual(["Antes", "Depois"]);
  });
});
