import test from "node:test";
import assert from "node:assert/strict";
import { runSalesCopilot } from "./salesAgentRuntime.js";

const now = "2026-09-12T12:00:00.000Z";

test("Sales Agent classifica lead frio como nurture", async () => {
  const result = await runSalesCopilot("nextassist", {
    leadId: "lead-cold",
    signals: [{ name: "site_visit", createdAt: now }],
  });

  assert.equal(result.intent, "low");
  assert.equal(result.nextAction, "nurture");
  assert.equal(result.score, 5);
});

test("Sales Agent prioriza lead com trial + pricing + contato", async () => {
  const result = await runSalesCopilot("nextassist", {
    leadId: "lead-hot",
    signals: [
      { name: "site_visit", createdAt: now },
      { name: "pricing_view", createdAt: now },
      { name: "trial_started", createdAt: now },
      { name: "contact_submit", createdAt: now },
    ],
  });

  assert.equal(result.intent, "high");
  assert.equal(result.nextAction, "request_human_contact");
  assert.equal(result.score, 75);
});

test("Sales Agent reconhece cliente convertido", async () => {
  const result = await runSalesCopilot("nextassist", {
    leadId: "customer-1",
    signals: [{ name: "subscription_started", createdAt: now }],
  });

  assert.equal(result.intent, "customer");
  assert.equal(result.nextAction, "customer_success");
  assert.equal(result.score, 100);
});
