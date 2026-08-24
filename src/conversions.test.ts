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

test("inclui trials e cadastros no resumo do escritório", () => {
  const summary = summarizeConversions([
    { name: "trial_started", anonymousId: "anon-1", createdAt: "2026-08-01T00:00:00Z" },
    { name: "signup_completed", anonymousId: "anon-1", userId: "user-1", createdAt: "2026-08-01T00:01:00Z" },
  ]);
  assert.equal(summary.trials, 1);
  assert.equal(summary.signups, 1);
});

test("getConversionEvents lê o array bruto de eventos, incluindo os campos de identidade novos", async () => {
  const { getConversionEvents } = await import("./conversions.js");
  const { buildWorkspaceContext } = await import("./context.js");
  const { createTempWorkspace } = await import("./testing/tempWorkspace.js");

  const temp = await createTempWorkspace("acme", {
    "conversion-events.json": [
      { name: "trial_started", anonymousId: "anon-1", content: "post-a", createdAt: "2026-08-01T00:00:00Z" },
      { name: "signup_completed", anonymousId: "anon-1", userId: "user-1", createdAt: "2026-08-01T00:05:00Z" },
    ],
  });
  try {
    const ctx = await buildWorkspaceContext(
      {
        id: "acme", name: "Acme", active: true,
        brand: { name: "Acme", description: "d", toneOfVoice: "t", targetAudience: [], competitors: [] },
        goals: { primary: "leads" },
        channels: { blog: true, instagram: false, linkedin: false },
        integrations: { siteUrl: "https://acme.test", cms: { provider: "nextassist", apiUrl: "https://api.acme.test" } },
        autonomy: { mode: "copilot" },
        secrets: { required: [] },
      },
      { async get() { return undefined; } },
      { workspacesRoot: temp.root, requireAiProvider: false },
    );
    const events = await getConversionEvents(ctx);
    assert.equal(events.length, 2);
    assert.equal(events[1].userId, "user-1");
    assert.equal(events[1].anonymousId, "anon-1");
  } finally {
    await temp.cleanup();
  }
});
