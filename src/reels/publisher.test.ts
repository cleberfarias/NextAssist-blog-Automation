import assert from "node:assert/strict";
import test from "node:test";
import type { WorkspaceContext } from "../context.js";
import { createTempWorkspace } from "../testing/tempWorkspace.js";
import { createQueuedReel, transitionStoredReel } from "./state.js";
import { publishApprovedInstagramReel, reviewInstagramReel } from "./publisher.js";

async function fixture(provider: "heygen-mcp" | "heygen-api" = "heygen-mcp") {
  const temp = await createTempWorkspace("nextassist");
  const ctx = { paths: { root: new URL("nextassist/", temp.root) } } as WorkspaceContext;
  const reel = await createQueuedReel(ctx, {
    id: "nextassist:teste",
    workspaceId: "nextassist",
    slug: "teste",
    title: "Teste",
    blogUrl: "https://example.com/blog/teste",
    caption: "Legenda",
    provider,
    avatarId: "avatar",
    voiceId: "voice",
    videoUrl: "https://example.com/reel.mp4",
  });
  await transitionStoredReel(ctx, reel.id, "rendering", "system");
  await transitionStoredReel(ctx, reel.id, "pending_approval", "system");
  return { temp, ctx, reelId: reel.id };
}

test("publisher never calls Instagram before human approval", async () => {
  const { temp, ctx, reelId } = await fixture();
  let calls = 0;
  try {
    await assert.rejects(
      () => publishApprovedInstagramReel(ctx, reelId, {
        async publish() {
          calls += 1;
          return { mediaId: "media-1", permalink: null };
        },
      }),
      /precisa estar approved/,
    );
    assert.equal(calls, 0);
  } finally {
    await temp.cleanup();
  }
});

test("publisher never calls Instagram before human approval — also for heygen-api drafts", async () => {
  const { temp, ctx, reelId } = await fixture("heygen-api");
  let calls = 0;
  try {
    await assert.rejects(
      () => publishApprovedInstagramReel(ctx, reelId, {
        async publish() {
          calls += 1;
          return { mediaId: "media-1", permalink: null };
        },
      }),
      /precisa estar approved/,
    );
    assert.equal(calls, 0);
  } finally {
    await temp.cleanup();
  }
});

test("approved reel can publish once and persists published state", async () => {
  const { temp, ctx, reelId } = await fixture();
  let calls = 0;
  try {
    await reviewInstagramReel(ctx, reelId, "approved", "Aprovado no painel");
    const result = await publishApprovedInstagramReel(ctx, reelId, {
      async publish(input) {
        calls += 1;
        assert.equal(input.videoUrl, "https://example.com/reel.mp4");
        assert.equal(input.caption, "Legenda");
        return { mediaId: "media-1", permalink: "https://instagram.com/reel/teste" };
      },
    });
    assert.equal(calls, 1);
    assert.equal(result.status, "published");
    assert.equal(result.mediaId, "media-1");
    assert.equal(result.audit.some((event) => event.to === "approved" && event.actor === "human"), true);
    assert.equal(result.audit.at(-1)?.to, "published");
  } finally {
    await temp.cleanup();
  }
});
