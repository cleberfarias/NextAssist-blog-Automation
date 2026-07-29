import assert from "node:assert/strict";
import test from "node:test";
import { summarizeConversions, type ConversionEvent } from "./conversions.js";

const events: ConversionEvent[] = [
  { name: "demo_view", campaign: "post-a", content: "cta-inline", createdAt: "2026-07-01T00:00:00Z" },
  { name: "demo_submit", campaign: "post-a", content: "cta-inline", createdAt: "2026-07-01T00:01:00Z" },
  { name: "demo_view", campaign: "post-b", content: "cta-final", createdAt: "2026-07-02T00:00:00Z" },
];

test("resume conversões por artigo e CTA", () => {
  const summary = summarizeConversions(events);
  assert.equal(summary.demoRate, 0.5);
  assert.deepEqual(summary.byCampaign[0], {
    campaign: "post-a",
    demoViews: 1,
    demoSubmits: 1,
    contactSubmits: 0,
    whatsappClicks: 0,
    leads: 1,
    demoRate: 1,
  });
  assert.deepEqual(summary.byContent[0], {
    content: "cta-inline",
    demoViews: 1,
    demoSubmits: 1,
    contactSubmits: 0,
    whatsappClicks: 0,
    leads: 1,
    demoRate: 1,
  });
});

test("agrega chaves especiais sem corromper contadores", () => {
  const summary = summarizeConversions([
    { name: "demo_view", campaign: "__proto__", content: "constructor", createdAt: "2026-07-01T00:00:00Z" },
  ]);
  assert.equal(summary.byCampaign[0].campaign, "__proto__");
  assert.equal(summary.byCampaign[0].demoViews, 1);
  assert.equal(summary.byContent[0].content, "constructor");
  assert.equal(summary.byContent[0].demoViews, 1);
});
