import assert from "node:assert/strict";
import test from "node:test";
import { buildWorkspaceContext } from "./context.js";
import type { MarketingWorkspace } from "./workspace.js";
import type { SecretProvider } from "./lib/secrets.js";

const workspace: MarketingWorkspace = {
  id: "acme", name: "Acme", active: true,
  brand: { name: "Acme", description: "d", toneOfVoice: "t", targetAudience: [], competitors: [] },
  goals: { primary: "leads" },
  channels: { blog: true, instagram: false, linkedin: false },
  integrations: { siteUrl: "https://acme.test", cms: { provider: "nextassist", apiUrl: "https://api.acme.test" } },
  autonomy: { mode: "copilot" },
  secrets: { required: ["OPENAI_API_KEY"] },
};

function fakeSecrets(values: Record<string, string>): SecretProvider {
  return { async get(_workspaceId, key) { return values[key]; } };
}

test("monta clientes de IA só para os providers com chave disponível", async () => {
  const ctx = await buildWorkspaceContext(workspace, fakeSecrets({ OPENAI_API_KEY: "sk-openai" }));
  assert.ok(ctx.ai.openai);
  assert.equal(ctx.ai.anthropic, undefined);
  assert.equal(ctx.aiPrimaryProvider, "openai");
});

test("paths ficam sob workspaces/<id>/", async () => {
  const ctx = await buildWorkspaceContext(workspace, fakeSecrets({ OPENAI_API_KEY: "sk" }));
  assert.ok(ctx.paths.calendar.pathname.endsWith("/workspaces/acme/content-calendar.json"));
  assert.ok(ctx.paths.performance.pathname.endsWith("/workspaces/acme/post-performance.json"));
});

test("usage tracker acumula tokens e calcula estimatedUsd", async () => {
  const ctx = await buildWorkspaceContext(workspace, fakeSecrets({ OPENAI_API_KEY: "sk" }));
  ctx.usage.addOpenAi({ inputTokens: 1000, outputTokens: 500 });
  const usage = ctx.usage.get();
  assert.equal(usage.inputTokens, 1000);
  assert.equal(usage.outputTokens, 500);
  assert.equal(usage.provider, "openai");
});

test("models expõe os nomes de modelo resolvidos para cada provider", async () => {
  const ctx = await buildWorkspaceContext(workspace, fakeSecrets({ OPENAI_API_KEY: "sk" }));
  assert.equal(ctx.models.openai, "gpt-5.6");
  assert.equal(ctx.models.anthropic, "claude-sonnet-5");
});

test("lança erro claro quando nenhum provider de IA tem chave configurada", async () => {
  await assert.rejects(
    () => buildWorkspaceContext(workspace, fakeSecrets({})),
    /nenhum provider de IA configurado/i,
  );
});

test("falha rápido nomeando os segredos obrigatórios ausentes", async () => {
  const strictWorkspace: MarketingWorkspace = {
    ...workspace,
    secrets: { required: ["OPENAI_API_KEY", "FIREBASE_STORAGE_BUCKET"] },
  };
  await assert.rejects(
    () => buildWorkspaceContext(strictWorkspace, fakeSecrets({ OPENAI_API_KEY: "sk" })),
    /segredos obrigatórios ausentes: FIREBASE_STORAGE_BUCKET/,
  );
});

test("não exige chave de IA quando requireAiProvider é false", async () => {
  const ctx = await buildWorkspaceContext(workspace, fakeSecrets({}), { requireAiProvider: false });
  assert.equal(ctx.ai.openai, undefined);
  assert.equal(ctx.ai.anthropic, undefined);
});

test("requireAiProvider: false também pula a checagem de segredos obrigatórios (rotas somente-leitura do painel)", async () => {
  const strictWorkspace: MarketingWorkspace = {
    ...workspace,
    secrets: { required: ["OPENAI_API_KEY", "FIREBASE_STORAGE_BUCKET"] },
  };
  await assert.doesNotReject(() =>
    buildWorkspaceContext(strictWorkspace, fakeSecrets({}), { requireAiProvider: false }),
  );
});
