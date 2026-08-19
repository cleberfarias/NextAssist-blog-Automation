import assert from "node:assert/strict";
import test from "node:test";
import { buildWorkspaceContext } from "./context.js";
import type { MarketingWorkspace } from "./workspace.js";
import { createTempWorkspace } from "./testing/tempWorkspace.js";
import { registerContent, getContentRegistry, type ContentRegistryEntry } from "./contentRegistry.js";

const workspace: MarketingWorkspace = {
  id: "acme", name: "Acme", active: true,
  brand: { name: "Acme", description: "d", toneOfVoice: "t", targetAudience: [], competitors: [] },
  goals: { primary: "leads" },
  channels: { blog: true, instagram: false, linkedin: false },
  integrations: { siteUrl: "https://acme.test", cms: { provider: "nextassist", apiUrl: "https://api.acme.test" } },
  autonomy: { mode: "copilot" },
  secrets: { required: [] },
};

async function ctxWithTemp() {
  const temp = await createTempWorkspace("acme");
  const ctx = await buildWorkspaceContext(workspace, { async get() { return undefined; } }, {
    workspacesRoot: temp.root, requireAiProvider: false,
  });
  return { ctx, cleanup: temp.cleanup };
}

function entry(overrides: Partial<ContentRegistryEntry> = {}): ContentRegistryEntry {
  return {
    contentId: "post-a", campaignId: null, tema: "Precificação",
    formato: "blog", channel: "blog", funnelStage: "meio",
    publicadoEm: "2026-08-01T00:00:00Z", status: "published",
    url: "https://acme.test/blog/post-a",
    ...overrides,
  };
}

test("registerContent insere uma entrada nova", async () => {
  const { ctx, cleanup } = await ctxWithTemp();
  try {
    await registerContent(ctx, entry());
    const registry = await getContentRegistry(ctx);
    assert.equal(registry.length, 1);
    assert.equal(registry[0].contentId, "post-a");
  } finally {
    await cleanup();
  }
});

test("registerContent faz upsert por contentId — reexecução não duplica", async () => {
  const { ctx, cleanup } = await ctxWithTemp();
  try {
    await registerContent(ctx, entry({ status: "draft-pending-approval" }));
    await registerContent(ctx, entry({ status: "published" }));
    const registry = await getContentRegistry(ctx);
    assert.equal(registry.length, 1);
    assert.equal(registry[0].status, "published");
  } finally {
    await cleanup();
  }
});

test("registerContent preserva entradas de outros contentIds", async () => {
  const { ctx, cleanup } = await ctxWithTemp();
  try {
    await registerContent(ctx, entry({ contentId: "post-a" }));
    await registerContent(ctx, entry({ contentId: "post-b" }));
    const registry = await getContentRegistry(ctx);
    assert.equal(registry.length, 2);
    assert.deepEqual(registry.map((e) => e.contentId).sort(), ["post-a", "post-b"]);
  } finally {
    await cleanup();
  }
});
