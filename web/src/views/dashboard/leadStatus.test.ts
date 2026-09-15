import { describe, it, expect } from "vitest";
import { leadStatus, filterLeadsByTab, leadDisplayName, leadInterest, leadLastActivityAt } from "./leadStatus";
import type { SalesEntry } from "../../types/api";

function entry(overrides: Partial<SalesEntry>): SalesEntry {
  return {
    lead: { leadId: "l1", signals: [], ...(overrides.lead ?? {}) },
    assessment: { leadId: "l1", score: 50, intent: "low", nextAction: "wait", reasons: [], ...(overrides.assessment ?? {}) },
    ...overrides,
  };
}

describe("leadStatus", () => {
  it("intent customer sempre vira 'convertido', mesmo com outreach", () => {
    expect(leadStatus(entry({ assessment: { leadId: "l1", score: 100, intent: "customer", nextAction: "x", reasons: [] } }))).toBe("convertido");
  });

  it("intent high vira 'quente'", () => {
    expect(leadStatus(entry({ assessment: { leadId: "l1", score: 90, intent: "high", nextAction: "x", reasons: [] } }))).toBe("quente");
  });

  it("sem outreach e intenção não-alta/cliente vira 'novo'", () => {
    expect(leadStatus(entry({ assessment: { leadId: "l1", score: 30, intent: "medium", nextAction: "x", reasons: [] } }))).toBe("novo");
  });

  it("com outreach real registrado e intenção medium/low vira 'em_contato'", () => {
    const e = entry({
      assessment: { leadId: "l1", score: 30, intent: "medium", nextAction: "x", reasons: [] },
      outreach: { leadId: "l1", channel: "email", message: "oi", rationale: "r", requiresHumanApproval: true },
    });
    expect(leadStatus(e)).toBe("em_contato");
  });
});

describe("filterLeadsByTab", () => {
  const entries = [
    entry({ lead: { leadId: "novo", signals: [] }, assessment: { leadId: "novo", score: 10, intent: "low", nextAction: "x", reasons: [] } }),
    entry({
      lead: { leadId: "contato", signals: [] },
      assessment: { leadId: "contato", score: 20, intent: "medium", nextAction: "x", reasons: [] },
      outreach: { leadId: "contato", channel: "email", message: "oi", rationale: "r", requiresHumanApproval: true },
    }),
    entry({ lead: { leadId: "quente", signals: [] }, assessment: { leadId: "quente", score: 90, intent: "high", nextAction: "x", reasons: [] } }),
    entry({ lead: { leadId: "cliente", signals: [] }, assessment: { leadId: "cliente", score: 100, intent: "customer", nextAction: "x", reasons: [] } }),
  ];

  it("'todos' retorna todos os leads", () => {
    expect(filterLeadsByTab(entries, "todos")).toHaveLength(4);
  });

  it("cada aba filtra pelo status real correspondente", () => {
    expect(filterLeadsByTab(entries, "novos").map((e) => e.lead.leadId)).toEqual(["novo"]);
    expect(filterLeadsByTab(entries, "em_contato").map((e) => e.lead.leadId)).toEqual(["contato"]);
    expect(filterLeadsByTab(entries, "quentes").map((e) => e.lead.leadId)).toEqual(["quente"]);
    expect(filterLeadsByTab(entries, "convertidos").map((e) => e.lead.leadId)).toEqual(["cliente"]);
  });
});

describe("leadDisplayName", () => {
  it("prioriza userId, depois anonymousId, depois leadId — nunca inventa um nome", () => {
    expect(leadDisplayName(entry({ lead: { leadId: "l1", userId: "user@real.com", signals: [] } }))).toBe("user@real.com");
    expect(leadDisplayName(entry({ lead: { leadId: "l1", anonymousId: "anon-123", signals: [] } }))).toBe("anon-123");
    expect(leadDisplayName(entry({ lead: { leadId: "l1", signals: [] } }))).toBe("l1");
  });
});

describe("leadInterest", () => {
  it("usa o sinal real mais recente, traduzido para um rótulo de interesse", () => {
    const e = entry({ lead: { leadId: "l1", signals: [{ name: "site_visit", createdAt: "t1" }, { name: "pricing_view", createdAt: "t2" }] } });
    expect(leadInterest(e)).toBe("Preços");
  });

  it("sem nenhum sinal, retorna null (não inventa interesse)", () => {
    expect(leadInterest(entry({ lead: { leadId: "l1", signals: [] } }))).toBeNull();
  });
});

describe("leadLastActivityAt", () => {
  it("retorna o createdAt real do sinal mais recente", () => {
    const e = entry({ lead: { leadId: "l1", signals: [{ name: "site_visit", createdAt: "2026-09-01T00:00:00.000Z" }, { name: "pricing_view", createdAt: "2026-09-10T00:00:00.000Z" }] } });
    expect(leadLastActivityAt(e)).toBe("2026-09-10T00:00:00.000Z");
  });

  it("sem sinais, retorna null", () => {
    expect(leadLastActivityAt(entry({ lead: { leadId: "l1", signals: [] } }))).toBeNull();
  });
});
