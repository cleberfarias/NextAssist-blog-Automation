import assert from "node:assert/strict";
import test from "node:test";
import type { WorkspaceContext } from "../context.js";
import { createTempWorkspace } from "../testing/tempWorkspace.js";
import {
  appendTimelineStep, canTransitionReel, createQueuedReel, findReel, patchStoredReel, planReelGeneration,
  transitionStoredReel, type ReelRecord, type ReelStatus,
} from "./state.js";

test("reel state machine requires approval before publishing", () => {
  assert.equal(canTransitionReel("pending_approval", "approved"), true);
  assert.equal(canTransitionReel("pending_approval", "publishing"), false);
  assert.equal(canTransitionReel("approved", "publishing"), true);
});

test("failed pode se recuperar para rendering (falha era nossa, não do HeyGen) ou tentar de novo via queued", () => {
  assert.equal(canTransitionReel("failed", "rendering"), true);
  assert.equal(canTransitionReel("failed", "queued"), true);
  assert.equal(canTransitionReel("failed", "pending_approval"), false);
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

test("planReelGeneration: rendering com videoId consulta o remoto em vez de gerar de novo", () => {
  const record = reelRecord("rendering", { videoId: "hg_123" });
  assert.deepEqual(planReelGeneration(record), { action: "check-remote", record });
});

test("planReelGeneration: failed com videoId também consulta o remoto antes de decidir (pode ter sido timeout nosso, não falha do HeyGen)", () => {
  const record = reelRecord("failed", { videoId: "hg_123", error: "HeyGen API: renderização excedeu o tempo máximo de 15 minutos." });
  assert.deepEqual(planReelGeneration(record), { action: "check-remote", record });
});

test("planReelGeneration: rendering SEM videoId (ex: MCP) pede retry — nada pra consultar", () => {
  const record = reelRecord("rendering");
  assert.deepEqual(planReelGeneration(record), { action: "retry", record });
});

test("planReelGeneration: queued e failed sem videoId pedem retry explícito", () => {
  const queued = reelRecord("queued");
  const failed = reelRecord("failed", { error: "boom" });
  assert.deepEqual(planReelGeneration(queued), { action: "retry", record: queued });
  assert.deepEqual(planReelGeneration(failed), { action: "retry", record: failed });
});

test("appendTimelineStep: adiciona o step com timestamp e é idempotente (não duplica)", async () => {
  const { temp, ctx } = await fixtureCtx();
  try {
    const created = await createQueuedReel(ctx, {
      id: "nextassist:teste", workspaceId: "nextassist", slug: "teste", title: "Teste",
      blogUrl: "https://example.com/teste", caption: "Legenda", provider: "heygen-api",
      avatarId: "avatar", voiceId: "voice",
    });
    await transitionStoredReel(ctx, created.id, "rendering", "system", "Renderização iniciada.");

    const once = await appendTimelineStep(ctx, created.id, "enviado_heygen");
    assert.equal(once.timelineSteps?.length, 1);
    assert.equal(once.timelineSteps?.[0].step, "enviado_heygen");

    const twice = await appendTimelineStep(ctx, created.id, "enviado_heygen");
    assert.equal(twice.timelineSteps?.length, 1); // não duplicou
  } finally {
    await temp.cleanup();
  }
});
