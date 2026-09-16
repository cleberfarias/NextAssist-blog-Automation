// src/harness/growthLoopRuntime.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import { buildWorkspaceContext } from "../context.js";
import type { WorkspaceContext } from "../context.js";
import type { MarketingWorkspace } from "../workspace.js";
import type { SecretProvider } from "../lib/secrets.js";
import { createTempWorkspace } from "../testing/tempWorkspace.js";
import { routeDecision, runGrowthLoop } from "./growthLoopRuntime.js";
import { getAllTopics } from "../contentCalendar.js";
import type { RevenueDecision } from "../revenue/types.js";
import type { SalesPipelineOptions, SalesPipelineRunResult } from "../sales/pipeline.js";
import type { ContentOpportunity } from "../lib/marketingDirector.js";
import type { BacklogResult, ReplenishContentBacklogOptions } from "../backlog.js";

function baseWorkspace(): MarketingWorkspace {
  return {
    id: "acme", name: "Acme", active: true,
    brand: { name: "Acme", description: "d", toneOfVoice: "t", targetAudience: [], competitors: [] },
    goals: { primary: "leads" },
    channels: { blog: true, instagram: false, linkedin: false },
    integrations: { siteUrl: "https://acme.test", cms: { provider: "nextassist", apiUrl: "https://api.acme.test" } },
    autonomy: { mode: "copilot" },
    secrets: { required: [] },
  };
}

function fakeSecrets(): SecretProvider {
  return { async get() { return undefined; } };
}

function decision(overrides: Partial<RevenueDecision> = {}): RevenueDecision {
  return {
    objective: "increase_paying_customers", bottleneck: "none", action: "do_nothing",
    priority: "low", reason: "sem gargalo", evidence: [], requiresHumanApproval: false,
    ...overrides,
  };
}

test("routeDecision: create_content e improve_cta vão para marketing", () => {
  assert.equal(routeDecision(decision({ bottleneck: "traffic", action: "create_content" })).owner, "marketing");
  assert.equal(routeDecision(decision({ bottleneck: "trial_conversion", action: "improve_cta" })).owner, "marketing");
});

test("routeDecision: prioritize_hot_leads e improve_sales_conversion vão para sales", () => {
  assert.equal(routeDecision(decision({ bottleneck: "sales_followup", action: "prioritize_hot_leads" })).owner, "sales");
  assert.equal(routeDecision(decision({ bottleneck: "sales_conversion", action: "improve_sales_conversion" })).owner, "sales");
});

test("routeDecision: improve_activation e do_nothing não têm dono", () => {
  const activation = routeDecision(decision({ bottleneck: "activation", action: "improve_activation" }));
  const none = routeDecision(decision({ bottleneck: "none", action: "do_nothing" }));
  assert.equal(activation.owner, "none");
  assert.equal(none.owner, "none");
});

test("routeDecision: steering inclui o motivo e a evidência da decisão", () => {
  const route = routeDecision(decision({ bottleneck: "traffic", action: "create_content", reason: "pouco tráfego orgânico", evidence: ["10 visitas"] }));
  assert.equal(route.owner, "marketing");
  if (route.owner === "marketing") {
    assert.match(route.steering, /pouco tráfego orgânico/);
    assert.match(route.steering, /10 visitas/);
  }
});

test("runGrowthLoop roteia para marketing, estampa growthLoop e persiste o estado", async () => {
  const temp = await createTempWorkspace("acme", { "content-calendar.json": { topicos: [] } });
  try {
    const ctx = await buildWorkspaceContext(baseWorkspace(), fakeSecrets(), { workspacesRoot: temp.root, requireAiProvider: false });
    const fakeGenerate = async (): Promise<ContentOpportunity[]> => [
      { tema: "Pauta do loop", palavraChaveAlvo: "loop", reason: "r", priority: "high", source: "other" },
    ];

    const state = await runGrowthLoop(ctx, undefined, {
      revenueDecision: decision({ bottleneck: "traffic", action: "create_content" }),
      revenueSnapshot: { visits: 5, trials: 0, activated: 0, customers: 0, hotLeads: 0, pendingSalesApprovals: 0, visitToTrialRate: 0, trialToActivationRate: 0, activationToCustomerRate: 0 },
      generate: fakeGenerate,
    });

    assert.equal(state.outcome.type, "marketing");
    if (state.outcome.type === "marketing") assert.equal(state.outcome.generated, 1);
    assert.ok(state.runId);

    const topics = await getAllTopics(ctx);
    assert.equal(topics[0]?.growthLoop?.runId, state.runId);
    assert.equal(topics[0]?.growthLoop?.bottleneck, "traffic");
  } finally {
    await temp.cleanup();
  }
});

test("runGrowthLoop repassa seu próprio runId como causedBy para replenishContentBacklog (branch marketing)", async () => {
  const temp = await createTempWorkspace("acme", { "content-calendar.json": { topicos: [] } });
  try {
    const ctx = await buildWorkspaceContext(baseWorkspace(), fakeSecrets(), { workspacesRoot: temp.root, requireAiProvider: false });
    let capturedCausedBy: string | undefined;
    const fakeReplenish = async (
      _ctx: WorkspaceContext,
      options: ReplenishContentBacklogOptions,
    ): Promise<BacklogResult> => {
      capturedCausedBy = options.causedBy;
      return { skipped: false, pendingBefore: 0, generated: 1, discardedDuplicates: 0, discardedForbidden: 0, discardedInvalid: 0, pendingAfter: 1, error: null };
    };

    const state = await runGrowthLoop(ctx, undefined, {
      revenueDecision: decision({ bottleneck: "traffic", action: "create_content" }),
      revenueSnapshot: { visits: 5, trials: 0, activated: 0, customers: 0, hotLeads: 0, pendingSalesApprovals: 0, visitToTrialRate: 0, trialToActivationRate: 0, activationToCustomerRate: 0 },
      replenish: fakeReplenish,
    });

    // Um typo como `causedBy: options.steering` na chamada real de
    // `replenish` passaria despercebido sem isto — os outros testes deste
    // arquivo injetam `generate`, cuja assinatura nem recebe `causedBy`.
    assert.equal(capturedCausedBy, state.runId);
  } finally {
    await temp.cleanup();
  }
});

test("runGrowthLoop não gera de novo quando já existe pauta pendente pro mesmo bottleneck/action", async () => {
  const temp = await createTempWorkspace("acme", {
    "content-calendar.json": { topicos: [{ tema: "Já gerada", palavraChaveAlvo: "k", publicado: false, growthLoop: { bottleneck: "traffic", action: "create_content", runId: "run-antigo" } }] },
  });
  try {
    const ctx = await buildWorkspaceContext(baseWorkspace(), fakeSecrets(), { workspacesRoot: temp.root, requireAiProvider: false });
    let generateCalls = 0;
    const fakeGenerate = async (): Promise<ContentOpportunity[]> => { generateCalls++; return []; };

    const state = await runGrowthLoop(ctx, undefined, {
      revenueDecision: decision({ bottleneck: "traffic", action: "create_content" }),
      revenueSnapshot: { visits: 5, trials: 0, activated: 0, customers: 0, hotLeads: 0, pendingSalesApprovals: 0, visitToTrialRate: 0, trialToActivationRate: 0, activationToCustomerRate: 0 },
      generate: fakeGenerate,
    });

    assert.equal(generateCalls, 0);
    assert.equal(state.outcome.type, "marketing_skipped");
  } finally {
    await temp.cleanup();
  }
});

test("runGrowthLoop roteia para sales", async () => {
  const temp = await createTempWorkspace("acme");
  try {
    const ctx = await buildWorkspaceContext(baseWorkspace(), fakeSecrets(), { workspacesRoot: temp.root, requireAiProvider: false });
    let capturedCausedBy: string | undefined;
    const fakeComposeSales = async (
      _ctx: WorkspaceContext,
      options: SalesPipelineOptions | undefined,
    ): Promise<SalesPipelineRunResult> => {
      capturedCausedBy = options?.causedBy;
      return { entries: [], outreachCreated: 2, outreachReused: 1 };
    };

    const state = await runGrowthLoop(ctx, undefined, {
      revenueDecision: decision({ bottleneck: "sales_followup", action: "prioritize_hot_leads" }),
      revenueSnapshot: { visits: 5, trials: 0, activated: 0, customers: 0, hotLeads: 3, pendingSalesApprovals: 1, visitToTrialRate: 0, trialToActivationRate: 0, activationToCustomerRate: 0 },
      composeSales: fakeComposeSales,
    });

    assert.deepEqual(state.outcome, { type: "sales", leadsAssessed: 0, outreachCreated: 2, outreachReused: 1 });
    // Mesma proteção contra typo do teste da branch marketing acima, agora
    // para o hand-off `composeSales` → `runWorkspaceSalesCopilot`.
    assert.equal(capturedCausedBy, state.runId);
  } finally {
    await temp.cleanup();
  }
});

test("runGrowthLoop não aciona ninguém para activation/do_nothing", async () => {
  const temp = await createTempWorkspace("acme");
  try {
    const ctx = await buildWorkspaceContext(baseWorkspace(), fakeSecrets(), { workspacesRoot: temp.root, requireAiProvider: false });

    const stateActivation = await runGrowthLoop(ctx, undefined, {
      revenueDecision: decision({ bottleneck: "activation", action: "improve_activation" }),
      revenueSnapshot: { visits: 5, trials: 0, activated: 0, customers: 0, hotLeads: 0, pendingSalesApprovals: 0, visitToTrialRate: 0, trialToActivationRate: 0, activationToCustomerRate: 0 },
    });
    assert.equal(stateActivation.outcome.type, "no_owner");

    const stateNone = await runGrowthLoop(ctx, undefined, {
      revenueDecision: decision({ bottleneck: "none", action: "do_nothing" }),
      revenueSnapshot: { visits: 5, trials: 0, activated: 0, customers: 0, hotLeads: 0, pendingSalesApprovals: 0, visitToTrialRate: 0, trialToActivationRate: 0, activationToCustomerRate: 0 },
    });
    assert.equal(stateNone.outcome.type, "no_action");
  } finally {
    await temp.cleanup();
  }
});
