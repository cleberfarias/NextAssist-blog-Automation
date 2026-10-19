import assert from "node:assert/strict";
import test from "node:test";
import { writeFile } from "node:fs/promises";
import { buildWorkspaceContext } from "../context.js";
import type { MarketingWorkspace } from "../workspace.js";
import type { SecretProvider } from "../lib/secrets.js";
import { createTempWorkspace } from "../testing/tempWorkspace.js";
import { getSalesStateStrict } from "./state.js";

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

test("getSalesStateStrict retorna null quando sales-state.json ainda não existe (ENOENT)", async () => {
  const temp = await createTempWorkspace("acme");
  try {
    const ctx = await buildWorkspaceContext(baseWorkspace(), fakeSecrets(), { workspacesRoot: temp.root, requireAiProvider: false });
    const result = await getSalesStateStrict(ctx);
    assert.equal(result, null);
  } finally {
    await temp.cleanup();
  }
});

test("getSalesStateStrict relança o erro quando sales-state.json existe mas está corrompido — não trata como 'nada existe ainda'", async () => {
  const temp = await createTempWorkspace("acme");
  try {
    const ctx = await buildWorkspaceContext(baseWorkspace(), fakeSecrets(), { workspacesRoot: temp.root, requireAiProvider: false });
    await writeFile(new URL("sales-state.json", ctx.paths.root), "{ isto não é json válido");

    await assert.rejects(() => getSalesStateStrict(ctx), (err) => {
      // Precisa ser o erro real de parse propagado, não um null silencioso —
      // um `getSalesState` comum devolveria null aqui, escondendo a falha.
      assert.ok(err instanceof Error);
      return true;
    });
  } finally {
    await temp.cleanup();
  }
});
