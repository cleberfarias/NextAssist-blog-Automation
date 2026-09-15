import assert from "node:assert/strict";
import test from "node:test";
import { getSecretsStatus } from "./secretsStatus.js";
import type { SecretProvider } from "./lib/secrets.js";

function fakeSecrets(configured: Record<string, string>): SecretProvider {
  return {
    async get(_workspaceId: string, key: string) {
      return configured[key];
    },
  };
}

test("marca cada segredo required/optional como configurado ou não, sem nunca devolver o valor", async () => {
  const workspace = { id: "acme", secrets: { required: ["OPENAI_API_KEY", "FIREBASE_WEB_API_KEY"], optional: ["HEYGEN_API_KEY"] } };
  const secrets = fakeSecrets({ OPENAI_API_KEY: "sk-real-value-not-exposed" });
  const status = await getSecretsStatus(workspace, secrets);

  assert.deepEqual(status, [
    { key: "OPENAI_API_KEY", required: true, configured: true },
    { key: "FIREBASE_WEB_API_KEY", required: true, configured: false },
    { key: "HEYGEN_API_KEY", required: false, configured: false },
  ]);
  // Garantia extra: nenhum item carrega um campo "value" ou similar.
  for (const item of status) {
    assert.deepEqual(Object.keys(item).sort(), ["configured", "key", "required"]);
  }
});

test("workspace sem segredos opcionais declarados não quebra", async () => {
  const workspace = { id: "acme", secrets: { required: ["OPENAI_API_KEY"] } };
  const status = await getSecretsStatus(workspace, fakeSecrets({}));
  assert.deepEqual(status, [{ key: "OPENAI_API_KEY", required: true, configured: false }]);
});
