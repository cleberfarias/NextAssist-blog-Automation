import assert from "node:assert/strict";
import test from "node:test";
import { shouldComposeOutreach } from "./pipeline.js";

test("gera abordagem apenas para lead de alta intenção que pede contato humano", () => {
  assert.equal(shouldComposeOutreach({
    leadId: "lead-1",
    score: 80,
    intent: "high",
    nextAction: "request_human_contact",
    reasons: [],
  }), true);

  assert.equal(shouldComposeOutreach({
    leadId: "lead-2",
    score: 45,
    intent: "medium",
    nextAction: "offer_help",
    reasons: [],
  }), false);

  assert.equal(shouldComposeOutreach({
    leadId: "lead-3",
    score: 100,
    intent: "customer",
    nextAction: "customer_success",
    reasons: [],
  }), false);
});
