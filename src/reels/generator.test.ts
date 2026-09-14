import assert from "node:assert/strict";
import test from "node:test";
import type { WorkspaceContext } from "../context.js";
import type { FinalPost } from "../agents/editorSeo.js";
import { createTempWorkspace } from "../testing/tempWorkspace.js";
import { createQueuedReel, findReel, transitionStoredReel, upsertReel } from "./state.js";
import { generateInstagramReelDraft } from "./generator.js";

const strategy = {
  provider: "heygen-api" as const,
  avatarId: "avatar", voiceId: "voice", format: "9:16" as const, music: true,
  requiresApproval: true, fallback: "none" as const,
};

const post: FinalPost = {
  titulo: "Titulo", slug: "teste", resumo: "resumo", conteudo: "<p>x</p>",
  tags: ["tag"], metaTitle: "meta", metaDescription: "meta desc",
};

async function fixtureCtx() {
  const temp = await createTempWorkspace("nextassist");
  const ctx = {
    workspace: { id: "nextassist", videoStrategy: strategy },
    secrets: { get: async () => "test-only-secret" },
    paths: { root: new URL("nextassist/", temp.root) },
  } as unknown as WorkspaceContext;
  return { temp, ctx };
}

function withFetch<T>(impl: typeof fetch, run: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  return run().finally(() => { globalThis.fetch = original; });
}

// A — pipeline heygen-api recebe videoId e retorna logo, sem polling.
test("generateInstagramReelDraft (heygen-api): envia ao HeyGen, persiste rendering+videoId e retorna sem esperar conclusão", async () => {
  const { temp, ctx } = await fixtureCtx();
  try {
    let calls = 0;
    const record = await withFetch(async (url, init) => {
      calls++;
      assert.equal(url, "https://api.heygen.com/v3/videos");
      assert.equal(init?.method, "POST");
      return Response.json({ data: { video_id: "hg_new", status: "waiting" } });
    }, () => generateInstagramReelDraft(ctx, post, "https://x.test/teste", { caption: "c", prompt: "p", script: "roteiro falado" }));

    assert.equal(calls, 1); // só o POST de generate — nenhuma consulta de status
    assert.equal(record.status, "rendering");
    assert.equal(record.videoId, "hg_new");
    assert.equal(record.provider, "heygen-api");
  } finally {
    await temp.cleanup();
  }
});

// B — existing rendering + videoId => generate NÃO é chamado.
test("generateInstagramReelDraft (heygen-api): Reel já rendering com videoId nunca chama generate de novo", async () => {
  const { temp, ctx } = await fixtureCtx();
  try {
    const created = await createQueuedReel(ctx, {
      id: "nextassist:teste", workspaceId: "nextassist", slug: "teste", title: "Titulo",
      blogUrl: "https://x.test/teste", caption: "c", provider: "heygen-api", avatarId: "avatar", voiceId: "voice",
    });
    await transitionStoredReel(ctx, created.id, "rendering", "system", "Renderização iniciada no HeyGen API.", { videoId: "hg_existing" });

    const record = await withFetch(async (url, init) => {
      if (init?.method === "POST") throw new Error("must not call generate");
      assert.equal(url, "https://api.heygen.com/v3/videos/hg_existing");
      return Response.json({ data: { status: "processing" } });
    }, () => generateInstagramReelDraft(ctx, post, "https://x.test/teste", { caption: "c", prompt: "p", script: "roteiro falado" }));

    assert.equal(record.status, "rendering");
    assert.equal(record.videoId, "hg_existing");
  } finally {
    await temp.cleanup();
  }
});

// J — approved/published/rejected nunca regeneram.
for (const status of ["approved", "published", "rejected"] as const) {
  test(`generateInstagramReelDraft: Reel em ${status} nunca é regenerado — nenhuma chamada ao HeyGen`, async () => {
    const { temp, ctx } = await fixtureCtx();
    try {
      await upsertReel(ctx, {
        id: "nextassist:teste", workspaceId: "nextassist", slug: "teste", title: "Titulo",
        blogUrl: "https://x.test/teste", caption: "c", provider: "heygen-api", avatarId: "avatar", voiceId: "voice",
        status, videoId: "hg_done", videoUrl: "https://files.heygen.ai/v.mp4",
        createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", audit: [],
      });

      const record = await withFetch(async () => { throw new Error("must not call HeyGen at all"); },
        () => generateInstagramReelDraft(ctx, post, "https://x.test/teste", { caption: "c", prompt: "p", script: "roteiro falado" }));

      assert.equal(record.status, status);
      const stored = await findReel(ctx, "nextassist:teste");
      assert.equal(stored?.status, status); // nada foi alterado no storage também
    } finally {
      await temp.cleanup();
    }
  });
}
