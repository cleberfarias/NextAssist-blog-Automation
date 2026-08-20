import assert from "node:assert/strict";
import test from "node:test";
import { computeAttributionFromData, MIN_TRIALS_FOR_RATE } from "./attribution.js";
import type { ContentRegistryEntry } from "./contentRegistry.js";
import type { ConversionEvent } from "./conversions.js";

const registry: ContentRegistryEntry[] = [
  {
    contentId: "post-a", campaignId: null, tema: "Precificação", formato: "blog",
    channel: "blog", funnelStage: "fundo", publicadoEm: "2026-08-01T00:00:00Z",
    status: "published", url: "https://acme.test/blog/post-a",
  },
];

test("visitas: usa post-performance quando disponível, ignora page_view", () => {
  const events: ConversionEvent[] = [
    { name: "page_view", anonymousId: "a1", content: "post-a", createdAt: "2026-08-01T00:00:00Z" },
  ];
  const performance = { posts: [{ slug: "post-a", clicks: 240 }] };
  const [row] = computeAttributionFromData(registry, events, performance);
  assert.equal(row.visits, 240);
});

test("visitas: sem post-performance, usa page_view atribuível; demo_view nunca conta", () => {
  const events: ConversionEvent[] = [
    { name: "page_view", anonymousId: "a1", content: "post-a", createdAt: "2026-08-01T00:00:00Z" },
    { name: "page_view", anonymousId: "a2", content: "post-a", createdAt: "2026-08-01T00:01:00Z" },
    { name: "demo_view", anonymousId: "a3", content: "post-a", createdAt: "2026-08-01T00:02:00Z" },
  ];
  const [row] = computeAttributionFromData(registry, events, null);
  assert.equal(row.visits, 2);
});

test("trials/ativação/clientes contam entidades únicas, não eventos brutos", () => {
  const events: ConversionEvent[] = [
    { name: "trial_started", anonymousId: "a1", content: "post-a", createdAt: "2026-08-01T00:00:00Z" },
    { name: "trial_started", anonymousId: "a1", content: "post-a", createdAt: "2026-08-01T00:00:30Z" }, // retry duplicado
    { name: "trial_started", anonymousId: "a2", content: "post-a", createdAt: "2026-08-01T00:01:00Z" },
  ];
  const [row] = computeAttributionFromData(registry, events, null);
  assert.equal(row.trials, 2);
});

test("first-touch: evento sem content herda o conteúdo de origem via anonymousId, propagado ao userId no signup", () => {
  const events: ConversionEvent[] = [
    { name: "page_view", anonymousId: "a1", content: "post-a", createdAt: "2026-08-01T00:00:00Z" },
    { name: "signup_completed", anonymousId: "a1", userId: "u1", createdAt: "2026-08-01T00:05:00Z" },
    { name: "first_order_created", userId: "u1", createdAt: "2026-08-02T00:00:00Z" }, // sem content nem anonymousId
  ];
  const [row] = computeAttributionFromData(registry, events, null);
  assert.equal(row.activated, 1);
});

test("eventos sem content nem identidade resolvível viram unattributedEvents, não inflam nenhuma linha", () => {
  const events: ConversionEvent[] = [
    { name: "trial_started", createdAt: "2026-08-01T00:00:00Z" }, // sem anonymousId, sem content
  ];
  const result = { rows: computeAttributionFromData(registry, events, null), unattributedEvents: 0 };
  assert.equal(result.rows[0].trials, 0);
});

test("rateReliable é false abaixo de MIN_TRIALS_FOR_RATE e as taxas não dividem por zero", () => {
  const events: ConversionEvent[] = [
    { name: "trial_started", anonymousId: "a1", content: "post-a", createdAt: "2026-08-01T00:00:00Z" },
  ];
  const [row] = computeAttributionFromData(registry, events, null);
  assert.equal(row.trials, 1);
  assert.ok(row.trials < MIN_TRIALS_FOR_RATE);
  assert.equal(row.rateReliable, false);
  assert.equal(row.visitToTrialRate, 0); // visits = 0, sem divisão por zero
  assert.equal(row.activationToCustomerRate, 0); // activated = 0
});
