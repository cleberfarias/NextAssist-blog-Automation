// src/growthLoop.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import { buildWorkspaceContext } from "./context.js";
import type { MarketingWorkspace } from "./workspace.js";
import type { SecretProvider } from "./lib/secrets.js";
import { createTempWorkspace } from "./testing/tempWorkspace.js";
import { getGrowthLoopState, saveGrowthLoopState, type GrowthLoopState } from "./growthLoop.js";

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

const sampleState: GrowthLoopState = {
  runId: "run-1",
  startedAt: "2026-09-16T12:00:00.000Z",
  completedAt: "2026-09-16T12:00:05.000Z",
  updatedAt: "2026-09-16T12:00:05.000Z",
  snapshot: { visits: 10, trials: 2, activated: 1, customers: 0, hotLeads: 1, pendingSalesApprovals: 0, visitToTrialRate: 0.2, trialToActivationRate: 0.5, activationToCustomerRate: 0 },
  decision: { objective: "increase_paying_customers", bottleneck: "traffic", action: "create_content", priority: "medium", reason: "pouco tráfego", evidence: [], requiresHumanApproval: false },
  outcome: { type: "no_action" },
};

test("getGrowthLoopState devolve null quando nunca foi salvo", async () => {
  const temp = await createTempWorkspace("acme");
  try {
    const ctx = await buildWorkspaceContext(baseWorkspace(), fakeSecrets(), { workspacesRoot: temp.root, requireAiProvider: false });
    assert.equal(await getGrowthLoopState(ctx), null);
  } finally {
    await temp.cleanup();
  }
});

test("saveGrowthLoopState + getGrowthLoopState fazem round-trip", async () => {
  const temp = await createTempWorkspace("acme");
  try {
    const ctx = await buildWorkspaceContext(baseWorkspace(), fakeSecrets(), { workspacesRoot: temp.root, requireAiProvider: false });
    await saveGrowthLoopState(ctx, sampleState);
    assert.deepEqual(await getGrowthLoopState(ctx), sampleState);
  } finally {
    await temp.cleanup();
  }
});
