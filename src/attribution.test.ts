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
  const { rows } = computeAttributionFromData(registry, events, performance);
  const [row] = rows;
  assert.equal(row.visits, 240);
});

test("visitas: sem post-performance, usa page_view atribuível; demo_view nunca conta", () => {
  const events: ConversionEvent[] = [
    { name: "page_view", anonymousId: "a1", content: "post-a", createdAt: "2026-08-01T00:00:00Z" },
    { name: "page_view", anonymousId: "a2", content: "post-a", createdAt: "2026-08-01T00:01:00Z" },
    { name: "demo_view", anonymousId: "a3", content: "post-a", createdAt: "2026-08-01T00:02:00Z" },
  ];
  const { rows } = computeAttributionFromData(registry, events, null);
  const [row] = rows;
  assert.equal(row.visits, 2);
});

test("visitas: clicks: 0 no post-performance nao suprime o fallback de page_view", () => {
  const events: ConversionEvent[] = [
    { name: "page_view", anonymousId: "a1", content: "post-a", createdAt: "2026-08-01T00:00:00Z" },
    { name: "page_view", anonymousId: "a2", content: "post-a", createdAt: "2026-08-01T00:01:00Z" },
  ];
  const performance = { posts: [{ slug: "post-a", clicks: 0 }] };
  const { rows } = computeAttributionFromData(registry, events, performance);
  const [row] = rows;
  assert.equal(row.visits, 2);
});

test("trials/ativação/clientes contam entidades únicas, não eventos brutos", () => {
  const events: ConversionEvent[] = [
    { name: "trial_started", anonymousId: "a1", content: "post-a", createdAt: "2026-08-01T00:00:00Z" },
    { name: "trial_started", anonymousId: "a1", content: "post-a", createdAt: "2026-08-01T00:00:30Z" }, // retry duplicado
    { name: "trial_started", anonymousId: "a2", content: "post-a", createdAt: "2026-08-01T00:01:00Z" },
  ];
  const { rows } = computeAttributionFromData(registry, events, null);
  const [row] = rows;
  assert.equal(row.trials, 2);
});

test("first-touch: evento sem content herda o conteúdo de origem via anonymousId, propagado ao userId no signup", () => {
  const events: ConversionEvent[] = [
    { name: "page_view", anonymousId: "a1", content: "post-a", createdAt: "2026-08-01T00:00:00Z" },
    { name: "signup_completed", anonymousId: "a1", userId: "u1", createdAt: "2026-08-01T00:05:00Z" },
    { name: "first_order_created", userId: "u1", createdAt: "2026-08-02T00:00:00Z" }, // sem content nem anonymousId
  ];
  const { rows } = computeAttributionFromData(registry, events, null);
  const [row] = rows;
  assert.equal(row.activated, 1);
});

test("evento com content mas sem identidade some das linhas e vira unattributedEvents (nao fica em nenhum lugar E nos dois)", () => {
  const events: ConversionEvent[] = [
    { name: "trial_started", content: "post-a", createdAt: "2026-08-01T00:00:00Z" }, // sem anonymousId, sem userId
  ];
  const { rows, unattributedEvents } = computeAttributionFromData(registry, events, null);
  assert.equal(rows[0].trials, 0);
  assert.equal(unattributedEvents, 1);
});

test("rateReliable é false abaixo de MIN_TRIALS_FOR_RATE e as taxas não dividem por zero", () => {
  const events: ConversionEvent[] = [
    { name: "trial_started", anonymousId: "a1", content: "post-a", createdAt: "2026-08-01T00:00:00Z" },
  ];
  const { rows } = computeAttributionFromData(registry, events, null);
  const [row] = rows;
  assert.equal(row.trials, 1);
  assert.ok(row.trials < MIN_TRIALS_FOR_RATE);
  assert.equal(row.rateReliable, false);
  assert.equal(row.visitToTrialRate, 0); // visits = 0, sem divisão por zero
  assert.equal(row.activationToCustomerRate, 0); // activated = 0
});

test("evento atribuido a um contentId fora do registry vira unattributedEvents, nao aparece em nenhuma linha", () => {
  const events: ConversionEvent[] = [
    { name: "trial_started", anonymousId: "a1", content: "post-does-not-exist", createdAt: "2026-08-01T00:00:00Z" },
  ];
  const { rows, unattributedEvents } = computeAttributionFromData(registry, events, null);
  assert.equal(rows[0].trials, 0); // post-a (the only registered content) unaffected
  assert.equal(unattributedEvents, 1);
});

test("um visitante que faz signup NAO e contado duas vezes (uma como anonymousId, outra como userId)", () => {
  const events: ConversionEvent[] = [
    { name: "page_view", anonymousId: "a1", content: "post-a", createdAt: "2026-08-01T00:00:00Z" },
    { name: "trial_started", anonymousId: "a1", createdAt: "2026-08-01T00:01:00Z" },
    { name: "signup_completed", anonymousId: "a1", userId: "u1", createdAt: "2026-08-01T00:02:00Z" },
    { name: "trial_started", userId: "u1", createdAt: "2026-08-01T00:03:00Z" }, // retry pos-signup, mesma pessoa
    { name: "page_view", userId: "u1", createdAt: "2026-08-01T00:04:00Z" },
  ];
  const { rows } = computeAttributionFromData(registry, events, null);
  const [row] = rows;
  assert.equal(row.trials, 1, "mesma pessoa, um trial, nao dois");
});

test("first-touch credita o PRIMEIRO conteudo tocado, nao o ultimo", () => {
  const twoContentRegistry: ContentRegistryEntry[] = [
    ...registry,
    { contentId: "post-b", campaignId: null, tema: "Outro tema", formato: "blog", channel: "blog", funnelStage: "topo", publicadoEm: "2026-08-01T00:00:00Z", status: "published", url: "https://acme.test/blog/post-b" },
  ];
  const events: ConversionEvent[] = [
    { name: "page_view", anonymousId: "a1", content: "post-a", createdAt: "2026-08-01T00:00:00Z" }, // primeiro toque
    { name: "page_view", anonymousId: "a1", content: "post-b", createdAt: "2026-08-01T01:00:00Z" }, // segundo toque, uma hora depois
    { name: "trial_started", anonymousId: "a1", createdAt: "2026-08-01T02:00:00Z" }, // sem content — deve herdar o PRIMEIRO
  ];
  const { rows } = computeAttributionFromData(twoContentRegistry, events, null);
  const postA = rows.find((r) => r.contentId === "post-a")!;
  const postB = rows.find((r) => r.contentId === "post-b")!;
  assert.equal(postA.trials, 1, "post-a foi o primeiro toque, deve receber o credito");
  assert.equal(postB.trials, 0, "post-b foi o segundo toque, nao deve receber credito");
});
