// src/contentCalendar.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import { buildWorkspaceContext } from "./context.js";
import type { MarketingWorkspace } from "./workspace.js";
import type { SecretProvider } from "./lib/secrets.js";
import { createTempWorkspace } from "./testing/tempWorkspace.js";
import { addTopics, getAllTopics } from "./contentCalendar.js";

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

test("addTopics propaga growthLoop quando informado, e não exige o campo quando ausente", async () => {
  const temp = await createTempWorkspace("acme", { "content-calendar.json": { topicos: [] } });
  try {
    const ctx = await buildWorkspaceContext(baseWorkspace(), fakeSecrets(), { workspacesRoot: temp.root, requireAiProvider: false });

    await addTopics(ctx, [
      { tema: "Tema com proveniência", palavraChaveAlvo: "k1", growthLoop: { bottleneck: "traffic", action: "create_content", runId: "run-1" } },
      { tema: "Tema sem proveniência", palavraChaveAlvo: "k2" },
    ]);

    const all = await getAllTopics(ctx);
    const withProvenance = all.find((t) => t.tema === "Tema com proveniência");
    const withoutProvenance = all.find((t) => t.tema === "Tema sem proveniência");

    assert.deepEqual(withProvenance?.growthLoop, { bottleneck: "traffic", action: "create_content", runId: "run-1" });
    assert.equal(withoutProvenance?.growthLoop, undefined);
  } finally {
    await temp.cleanup();
  }
});
