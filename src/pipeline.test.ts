// src/pipeline.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import { buildWorkspaceContext } from "./context.js";
import type { MarketingWorkspace } from "./workspace.js";
import type { SecretProvider } from "./lib/secrets.js";
import { createTempWorkspace } from "./testing/tempWorkspace.js";
import { runPipeline } from "./pipeline.js";
import type { PipelineEvent } from "./pipelineEvents.js";

const workspace: MarketingWorkspace = {
  id: "acme", name: "Acme", active: true,
  brand: { name: "Acme", description: "d", toneOfVoice: "t", targetAudience: [], competitors: [] },
  goals: { primary: "leads" },
  channels: { blog: true, instagram: false, linkedin: false },
  integrations: { siteUrl: "https://acme.test", cms: { provider: "nextassist", apiUrl: "https://api.acme.test" } },
  autonomy: { mode: "copilot" },
  secrets: { required: [] },
  contentStrategy: { minimumPendingTopics: 1, replenishAmount: 5 },
};

function fakeSecrets(): SecretProvider {
  return { async get() { return undefined; } };
}

test("runPipeline com calendário vazio e sem provider de IA: reabastecimento falha, retorna resultado vazio com backlog.error", async () => {
  const temp = await createTempWorkspace("acme", { "content-calendar.json": { topicos: [] }, "post-history.json": [] });
  try {
    const ctx = await buildWorkspaceContext(workspace, fakeSecrets(), {
      workspacesRoot: temp.root,
      requireAiProvider: false,
    });
    const events: PipelineEvent[] = [];
    const result = await runPipeline(ctx, (event) => events.push(event));

    assert.equal(result.tema, null);
    assert.equal(result.slugPublicado, null);
    assert.equal(result.backlog.pendingBefore, 0);
    assert.ok(result.backlog.error);
    assert.ok(events.some((e) => e.agent === "marketing-director" && e.status === "error"));
    assert.ok(events.some((e) => e.agent === "pesquisa-pauta" && e.status === "error" && /Nenhum tópico pendente/.test(e.message ?? "")));
  } finally {
    await temp.cleanup();
  }
});
