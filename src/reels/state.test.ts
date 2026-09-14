import assert from "node:assert/strict";
import test from "node:test";
import type { WorkspaceContext } from "../context.js";
import { createTempWorkspace } from "../testing/tempWorkspace.js";
import {
  canTransitionReel, createQueuedReel, findReel, patchStoredReel, planReelGeneration,
  transitionStoredReel, type ReelRecord, type ReelStatus,
} from "./state.js";

test("reel state machine requires approval before publishing", () => {
  assert.equal(canTransitionReel("pending_approval", "approved"), true);
  assert.equal(canTransitionReel("pending_approval", "publishing"), false);
  assert.equal(canTransitionReel("approved", "publishing"), true);
});

test("rejected reels cannot publish", () => {
  assert.equal(canTransitionReel("rejected", "publishing"), false);
});

async function fixtureCtx() {
  const temp = await createTempWorkspace("nextassist");
  const ctx = { paths: { root: new URL("nextassist/", temp.root) } } as WorkspaceContext;
  return { temp, ctx };
}

test("findReel devolve undefined quando o id não existe", async () => {
  const { temp, ctx } = await fixtureCtx();
  try {
    assert.equal(await findReel(ctx, "nextassist:inexistente"), undefined);
  } finally {
    await temp.cleanup();
  }
});

test("findReel devolve o registro quando o id existe", async () => {
  const { temp, ctx } = await fixtureCtx();
  try {
    await createQueuedReel(ctx, {
      id: "nextassist:teste", workspaceId: "nextassist", slug: "teste", title: "Teste",
      blogUrl: "https://example.com/teste", caption: "Legenda", provider: "heygen-api",
      avatarId: "avatar", voiceId: "voice",
    });
    const found = await findReel(ctx, "nextassist:teste");
    assert.equal(found?.id, "nextassist:teste");
    assert.equal(found?.status, "queued");
  } finally {
    await temp.cleanup();
  }
});

test("patchStoredReel atualiza campos sem mudar status nem registrar transição de audit", async () => {
  const { temp, ctx } = await fixtureCtx();
  try {
    const created = await createQueuedReel(ctx, {
      id: "nextassist:teste", workspaceId: "nextassist", slug: "teste", title: "Teste",
      blogUrl: "https://example.com/teste", caption: "Legenda", provider: "heygen-api",
      avatarId: "avatar", voiceId: "voice",
    });
    await transitionStoredReel(ctx, created.id, "rendering", "system", "Renderização iniciada.");
    const patched = await patchStoredReel(ctx, created.id, { videoId: "hg_123" });
    assert.equal(patched.videoId, "hg_123");
    assert.equal(patched.status, "rendering");
    assert.equal(patched.audit.length, 2);
    assert.equal(patched.audit.at(-1)?.to, "rendering");
  } finally {
    await temp.cleanup();
  }
});

function reelRecord(status: ReelStatus, extra: Partial<ReelRecord> = {}): ReelRecord {
  const now = new Date().toISOString();
  return {
    id: "nextassist:teste", workspaceId: "nextassist", slug: "teste", title: "Teste",
    blogUrl: "https://example.com/teste", caption: "Legenda", provider: "heygen-api",
    avatarId: "avatar", voiceId: "voice", status, createdAt: now, updatedAt: now, audit: [],
    ...extra,
  };
}

test("planReelGeneration: sem registro existente, plano é 'fresh'", () => {
  assert.deepEqual(planReelGeneration(undefined), { action: "fresh" });
});

for (const status of ["pending_approval", "approved", "publishing", "published", "rejected"] as const) {
  test(`planReelGeneration: ${status} é protegido — nunca reseta`, () => {
    const record = reelRecord(status);
    assert.deepEqual(planReelGeneration(record), { action: "protected", record });
  });
}

test("planReelGeneration: rendering retoma o polling em vez de recriar", () => {
  const record = reelRecord("rendering", { videoId: "hg_123" });
  assert.deepEqual(planReelGeneration(record), { action: "resume-rendering", record });
});

test("planReelGeneration: queued e failed pedem retry explícito", () => {
  const queued = reelRecord("queued");
  const failed = reelRecord("failed", { error: "boom" });
  assert.deepEqual(planReelGeneration(queued), { action: "retry", record: queued });
  assert.deepEqual(planReelGeneration(failed), { action: "retry", record: failed });
});
