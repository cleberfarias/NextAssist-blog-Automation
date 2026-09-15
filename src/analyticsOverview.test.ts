import assert from "node:assert/strict";
import test from "node:test";
import { summarizeOverview } from "./analyticsOverview.js";
import type { ConversionEvent } from "./conversions.js";

const NOW = new Date("2026-09-15T12:00:00.000Z");

function daysAgo(n: number, hour = 12): string {
  const d = new Date(NOW);
  d.setUTCDate(d.getUTCDate() - n);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
}

test("sem nenhum evento, tudo fica zerado e as variações ficam null (nunca inventa uma tendência)", () => {
  const overview = summarizeOverview([], 30, NOW);
  assert.equal(overview.visits.value, 0);
  assert.equal(overview.visits.changePct, null);
  assert.equal(overview.leads.value, 0);
  assert.equal(overview.customers.value, 0);
  assert.equal(overview.conversionRate.value, 0);
  assert.equal(overview.conversionRate.changePoints, null);
  assert.equal(overview.series.length, 30);
  assert.ok(overview.series.every((d) => d.visits === 0 && d.leads === 0));
  assert.deepEqual(overview.leadSources, []);
});

test("conta visitas (page_view) e leads (demo_submit + contact_submit + whatsapp_click) só do período atual", () => {
  const events: ConversionEvent[] = [
    { name: "page_view", createdAt: daysAgo(5) },
    { name: "page_view", createdAt: daysAgo(10) },
    { name: "demo_submit", createdAt: daysAgo(5) },
    { name: "contact_submit", createdAt: daysAgo(2) },
    { name: "whatsapp_click", createdAt: daysAgo(1) },
    { name: "cta_click", createdAt: daysAgo(1) }, // não conta como visita nem lead
    { name: "page_view", createdAt: daysAgo(40) }, // fora do período de 30 dias — não conta
  ];
  const overview = summarizeOverview(events, 30, NOW);
  assert.equal(overview.visits.value, 2);
  assert.equal(overview.leads.value, 3);
});

test("taxa de conversão é leads/visitas do período atual", () => {
  const events: ConversionEvent[] = [
    { name: "page_view", createdAt: daysAgo(1) },
    { name: "page_view", createdAt: daysAgo(2) },
    { name: "demo_submit", createdAt: daysAgo(1) },
  ];
  const overview = summarizeOverview(events, 30, NOW);
  assert.equal(overview.conversionRate.value, 0.5);
});

test("variação percentual real compara com o período anterior de mesmo tamanho", () => {
  const events: ConversionEvent[] = [
    // período atual (0-30 dias atrás): 2 visitas
    { name: "page_view", createdAt: daysAgo(1) },
    { name: "page_view", createdAt: daysAgo(2) },
    // período anterior (30-60 dias atrás): 1 visita
    { name: "page_view", createdAt: daysAgo(35) },
  ];
  const overview = summarizeOverview(events, 30, NOW);
  assert.equal(overview.visits.value, 2);
  assert.equal(overview.visits.changePct, 100); // de 1 pra 2 = +100%
});

test("sem dado real no período anterior, a variação fica null em vez de inventar um número", () => {
  const events: ConversionEvent[] = [{ name: "page_view", createdAt: daysAgo(1) }];
  const overview = summarizeOverview(events, 30, NOW);
  assert.equal(overview.visits.value, 1);
  assert.equal(overview.visits.changePct, null);
});

test("a variação da taxa de conversão é em pontos percentuais, não percentual relativo", () => {
  const events: ConversionEvent[] = [
    // atual: 1 lead / 2 visitas = 50%
    { name: "page_view", createdAt: daysAgo(1) },
    { name: "page_view", createdAt: daysAgo(2) },
    { name: "demo_submit", createdAt: daysAgo(1) },
    // anterior: 1 lead / 4 visitas = 25%
    { name: "page_view", createdAt: daysAgo(35) },
    { name: "page_view", createdAt: daysAgo(36) },
    { name: "page_view", createdAt: daysAgo(37) },
    { name: "page_view", createdAt: daysAgo(38) },
    { name: "demo_submit", createdAt: daysAgo(35) },
  ];
  const overview = summarizeOverview(events, 30, NOW);
  assert.equal(Math.round(overview.conversionRate.changePoints! * 10) / 10, 25); // 50% - 25% = 25 p.p.
});

test("série diária tem um ponto por dia do período, com contagens reais em cada balde", () => {
  const events: ConversionEvent[] = [
    { name: "page_view", createdAt: daysAgo(0) },
    { name: "page_view", createdAt: daysAgo(0) },
    { name: "demo_submit", createdAt: daysAgo(3) },
  ];
  const overview = summarizeOverview(events, 7, NOW);
  assert.equal(overview.series.length, 7);
  const today = overview.series[overview.series.length - 1];
  assert.equal(today.visits, 2);
  const threeDaysAgo = overview.series[overview.series.length - 1 - 3];
  assert.equal(threeDaysAgo.leads, 1);
});

test("origem dos leads é agrupada pelo campo source real, com 'Outros' só quando source realmente falta", () => {
  const events: ConversionEvent[] = [
    { name: "demo_submit", source: "instagram", createdAt: daysAgo(1) },
    { name: "contact_submit", source: "instagram", createdAt: daysAgo(1) },
    { name: "whatsapp_click", source: "site", createdAt: daysAgo(1) },
    { name: "demo_submit", createdAt: daysAgo(1) }, // sem source
  ];
  const overview = summarizeOverview(events, 30, NOW);
  const bySource = Object.fromEntries(overview.leadSources.map((s) => [s.source, s]));
  assert.equal(bySource.instagram.count, 2);
  assert.equal(bySource.instagram.pct, 50);
  assert.equal(bySource.site.count, 1);
  assert.equal(bySource.Outros.count, 1);
});
