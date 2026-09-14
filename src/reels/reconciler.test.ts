import assert from "node:assert/strict";
import test from "node:test";
import type { WorkspaceContext } from "../context.js";
import { createTempWorkspace } from "../testing/tempWorkspace.js";
import type { HeyGenApiClient, HeyGenApiStatus } from "../harness/heygenApi.js";
import { createQueuedReel, findReel, transitionStoredReel, upsertReel, type ReelRecord } from "./state.js";
import { reconcileReelWithRemote, reconcileWorkspaceReels } from "./reconciler.js";

async function fixtureCtx() {
  const temp = await createTempWorkspace("nextassist");
  const ctx = { workspace: { id: "nextassist" }, paths: { root: new URL("nextassist/", temp.root) } } as WorkspaceContext;
  return { temp, ctx };
}

function fakeClient(getStatus: HeyGenApiClient["getStatus"], generateCalls: { count: number } = { count: 0 }): HeyGenApiClient {
  return {
    async generate() { generateCalls.count++; throw new Error("must not call generate from the reconciler"); },
    async generateStudio() { generateCalls.count++; throw new Error("must not call generateStudio from the reconciler"); },
    getStatus,
  };
}

async function renderingReel(ctx: WorkspaceContext, overrides: Partial<ReelRecord> = {}): Promise<ReelRecord> {
  const created = await createQueuedReel(ctx, {
    id: "nextassist:teste", workspaceId: "nextassist", slug: "teste", title: "Teste",
    blogUrl: "https://example.com/teste", caption: "Legenda", provider: "heygen-api",
    avatarId: "avatar", voiceId: "voice",
  });
  return transitionStoredReel(ctx, created.id, "rendering", "system", "Renderização iniciada no HeyGen API.", { videoId: "hg_123", ...overrides });
}

async function failedReel(ctx: WorkspaceContext, overrides: Partial<ReelRecord> = {}): Promise<ReelRecord> {
  const rendering = await renderingReel(ctx, overrides);
  return transitionStoredReel(ctx, rendering.id, "failed", "system", "Falha na renderização do Reel.", {
    error: "HeyGen API: renderização excedeu o tempo máximo de 15 minutos.",
  });
}

// C, D — pending/processing remoto: continua rendering.
for (const remoteStatus of ["queued", "rendering"] as const) {
  test(`reconcileReelWithRemote: remoto ${remoteStatus} mantém rendering local`, async () => {
    const { temp, ctx } = await fixtureCtx();
    try {
      const record = await renderingReel(ctx);
      const client = fakeClient(async () => ({ status: remoteStatus }));
      const result = await reconcileReelWithRemote(ctx, client, record);
      assert.equal(result.outcome, "still-rendering");
      assert.equal(result.record.status, "rendering");
    } finally {
      await temp.cleanup();
    }
  });
}

// E — completed remoto: pending_approval, videoUrl salvo.
test("reconcileReelWithRemote: remoto completed vira pending_approval e salva videoUrl", async () => {
  const { temp, ctx } = await fixtureCtx();
  try {
    const record = await renderingReel(ctx);
    const client = fakeClient(async () => ({ status: "completed", videoUrl: "https://files.heygen.ai/v.mp4" }));
    const result = await reconcileReelWithRemote(ctx, client, record);
    assert.equal(result.outcome, "completed");
    assert.equal(result.record.status, "pending_approval");
    assert.equal(result.record.videoUrl, "https://files.heygen.ai/v.mp4");
    assert.equal(result.record.audit.at(-1)?.to, "pending_approval");
  } finally {
    await temp.cleanup();
  }
});

// F, G — failed/cancelled remoto: failed.
for (const remoteStatus of ["failed", "cancelled"] as const) {
  test(`reconcileReelWithRemote: remoto ${remoteStatus} vira failed`, async () => {
    const { temp, ctx } = await fixtureCtx();
    try {
      const record = await renderingReel(ctx);
      const client = fakeClient(async () => ({ status: remoteStatus }));
      const result = await reconcileReelWithRemote(ctx, client, record);
      assert.equal(result.outcome, "failed");
      assert.equal(result.record.status, "failed");
      assert.ok(result.record.error?.includes(remoteStatus));
    } finally {
      await temp.cleanup();
    }
  });
}

test("reconcileReelWithRemote: not_found remoto também vira failed", async () => {
  const { temp, ctx } = await fixtureCtx();
  try {
    const record = await renderingReel(ctx);
    const client = fakeClient(async () => ({ status: "not_found" }));
    const result = await reconcileReelWithRemote(ctx, client, record);
    assert.equal(result.outcome, "failed");
    assert.equal(result.record.status, "failed");
  } finally {
    await temp.cleanup();
  }
});

// H — failed local por timeout + remoto processing: volta pra rendering, sem generate.
test("reconcileReelWithRemote: failed local (timeout nosso) com remoto ainda processing volta para rendering", async () => {
  const { temp, ctx } = await fixtureCtx();
  try {
    const record = await failedReel(ctx);
    assert.equal(record.status, "failed");
    const generateCalls = { count: 0 };
    const client = fakeClient(async () => ({ status: "rendering" as HeyGenApiStatus }), generateCalls);
    const result = await reconcileReelWithRemote(ctx, client, record);
    assert.equal(result.outcome, "still-rendering");
    assert.equal(result.record.status, "rendering");
    assert.equal(result.record.error, undefined);
    assert.equal(generateCalls.count, 0);
    // audit preservado: contém o evento de failed original E o de recuperação.
    assert.ok(result.record.audit.some((e) => e.to === "failed"));
    assert.equal(result.record.audit.at(-1)?.to, "rendering");
  } finally {
    await temp.cleanup();
  }
});

// I — failed local por timeout + remoto completed: pending_approval.
test("reconcileReelWithRemote: failed local (timeout nosso) com remoto completed vira pending_approval direto", async () => {
  const { temp, ctx } = await fixtureCtx();
  try {
    const record = await failedReel(ctx);
    const client = fakeClient(async () => ({ status: "completed" as HeyGenApiStatus, videoUrl: "https://files.heygen.ai/v.mp4" }));
    const result = await reconcileReelWithRemote(ctx, client, record);
    assert.equal(result.outcome, "completed");
    assert.equal(result.record.status, "pending_approval");
    assert.equal(result.record.videoUrl, "https://files.heygen.ai/v.mp4");
  } finally {
    await temp.cleanup();
  }
});

test("reconcileReelWithRemote: erro de rede/timeout ao consultar nunca é tratado como falha terminal", async () => {
  const { temp, ctx } = await fixtureCtx();
  try {
    const record = await renderingReel(ctx);
    const client = fakeClient(async () => { throw new Error("HeyGen API: falha de rede ao chamar a API."); });
    const result = await reconcileReelWithRemote(ctx, client, record);
    assert.equal(result.outcome, "inconclusive");
    assert.equal(result.record.status, "rendering");
  } finally {
    await temp.cleanup();
  }
});

test("reconcileReelWithRemote: já failed e remoto confirma failed de novo — não duplica audit", async () => {
  const { temp, ctx } = await fixtureCtx();
  try {
    const record = await failedReel(ctx);
    const client = fakeClient(async () => ({ status: "failed" as HeyGenApiStatus }));
    const result = await reconcileReelWithRemote(ctx, client, record);
    assert.equal(result.outcome, "failed");
    assert.deepEqual(result.record.audit, record.audit); // nenhum evento novo adicionado
  } finally {
    await temp.cleanup();
  }
});

// L — rodar duas vezes com processing não duplica audit (nada muda, nada é adicionado).
test("reconcileReelWithRemote: rodar duas vezes seguidas com processing não adiciona audit novo", async () => {
  const { temp, ctx } = await fixtureCtx();
  try {
    const record = await renderingReel(ctx);
    const client = fakeClient(async () => ({ status: "rendering" as HeyGenApiStatus }));
    const first = await reconcileReelWithRemote(ctx, client, record);
    const second = await reconcileReelWithRemote(ctx, client, first.record);
    assert.deepEqual(second.record.audit, record.audit);
  } finally {
    await temp.cleanup();
  }
});

// K — batch nunca chama Instagram (por construção: reconciler.ts não importa nada de instagram/publisher).
test("reconcileWorkspaceReels processa rendering E failed (com videoId) do heygen-api, ignora o resto, nunca chama generate", async () => {
  const { temp, ctx } = await fixtureCtx();
  try {
    await renderingReel(ctx); // nextassist:teste — rendering, heygen-api, videoId
    await upsertReel(ctx, {
      id: "nextassist:failed-com-id", workspaceId: "nextassist", slug: "failed-com-id", title: "Recuperável",
      blogUrl: "https://example.com/failed-com-id", caption: "c", provider: "heygen-api", avatarId: "a", voiceId: "v",
      status: "failed", videoId: "hg_555", error: "HeyGen API: renderização excedeu o tempo máximo de 15 minutos.",
      createdAt: "x", updatedAt: "x", audit: [],
    });
    await upsertReel(ctx, {
      id: "nextassist:failed-sem-id", workspaceId: "nextassist", slug: "failed-sem-id", title: "Sem job pra checar",
      blogUrl: "https://example.com/failed-sem-id", caption: "c", provider: "heygen-api", avatarId: "a", voiceId: "v",
      status: "failed", createdAt: "x", updatedAt: "x", audit: [],
    });
    await upsertReel(ctx, {
      id: "nextassist:mcp-em-andamento", workspaceId: "nextassist", slug: "mcp-em-andamento", title: "MCP",
      blogUrl: "https://example.com/mcp", caption: "c", provider: "heygen-mcp", avatarId: "a", voiceId: "v",
      status: "rendering", createdAt: "x", updatedAt: "x", audit: [],
    });
    await upsertReel(ctx, {
      id: "nextassist:aprovado", workspaceId: "nextassist", slug: "aprovado", title: "Aprovado",
      blogUrl: "https://example.com/aprovado", caption: "c", provider: "heygen-api", avatarId: "a", voiceId: "v",
      status: "approved", videoId: "hg_999", createdAt: "x", updatedAt: "x", audit: [],
    });

    const generateCalls = { count: 0 };
    const client = fakeClient(async () => ({ status: "completed" as HeyGenApiStatus, videoUrl: "https://files.heygen.ai/v.mp4" }), generateCalls);
    const result = await reconcileWorkspaceReels(ctx, { client });
    assert.equal(result.checked, 2); // rendering+videoId E failed+videoId — nada mais
    assert.equal(result.completed, 2);
    assert.equal(generateCalls.count, 0);

    const recovered = await findReel(ctx, "nextassist:failed-com-id");
    assert.equal(recovered?.status, "pending_approval");
    const untouchedApproved = await findReel(ctx, "nextassist:aprovado");
    assert.equal(untouchedApproved?.status, "approved");
    const untouchedFailedSemId = await findReel(ctx, "nextassist:failed-sem-id");
    assert.equal(untouchedFailedSemId?.status, "failed"); // sem videoId, nada pra consultar — reconciler não mexe
  } finally {
    await temp.cleanup();
  }
});
