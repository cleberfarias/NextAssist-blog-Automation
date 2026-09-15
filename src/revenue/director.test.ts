import test from "node:test";
import assert from "node:assert/strict";
import { decideRevenueAction } from "./director.js";
import type { RevenueSnapshot } from "./types.js";

function snapshot(overrides: Partial<RevenueSnapshot> = {}): RevenueSnapshot {
  return {
    visits: 100,
    trials: 10,
    activated: 6,
    customers: 2,
    hotLeads: 0,
    pendingSalesApprovals: 0,
    visitToTrialRate: 0.1,
    trialToActivationRate: 0.6,
    activationToCustomerRate: 0.333,
    ...overrides,
  };
}

test("prioriza aprovações comerciais pendentes antes de gerar mais demanda", () => {
  const decision = decideRevenueAction(snapshot({ pendingSalesApprovals: 3, hotLeads: 4 }));
  assert.equal(decision.bottleneck, "sales_followup");
  assert.equal(decision.action, "prioritize_hot_leads");
  assert.equal(decision.priority, "high");
});

test("prioriza ativação quando há trials suficientes mas baixa ativação", () => {
  const decision = decideRevenueAction(snapshot({ trials: 10, activated: 2, trialToActivationRate: 0.2, customers: 1 }));
  assert.equal(decision.bottleneck, "activation");
  assert.equal(decision.action, "improve_activation");
});

test("recomenda melhorar CTA quando há tráfego e pouca conversão para trial", () => {
  const decision = decideRevenueAction(snapshot({ visits: 200, trials: 4, activated: 3, customers: 1, visitToTrialRate: 0.02 }));
  assert.equal(decision.bottleneck, "trial_conversion");
  assert.equal(decision.action, "improve_cta");
});

test("gera conteúdo apenas quando ainda não há volume suficiente", () => {
  const decision = decideRevenueAction(snapshot({ visits: 12, trials: 1, activated: 0, customers: 0, visitToTrialRate: 1 / 12, trialToActivationRate: 0, activationToCustomerRate: 0 }));
  assert.equal(decision.bottleneck, "traffic");
  assert.equal(decision.action, "create_content");
});
