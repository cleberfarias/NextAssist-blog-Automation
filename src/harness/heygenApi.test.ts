import test from "node:test";
import assert from "node:assert/strict";
import { createHeyGenApiClient, pollHeyGenApiVideo, resolveHeyGenApiVideoId, type HeyGenApiClient } from "./heygenApi.js";

function fakeClock(startMs = 0) {
  let time = startMs;
  return { now: () => time, sleep: async (ms: number) => { time += ms; } };
}

const input = { title: "Reel", script: "Olá", avatarId: "avatar", voiceId: "voice", aspectRatio: "9:16" as const };
const ctx = { secrets: { get: async () => "test-only-secret" } };

test("HeyGen API refuses missing secret without a network call", async () => {
  const client = createHeyGenApiClient({ secrets: { get: async () => undefined } }, "nextassist", {
    fetch: async () => { throw new Error("must not call"); },
  });
  await assert.rejects(client.generate(input), /HEYGEN_API_KEY.*ausente/);
});

test("HeyGen API generates using workspace runtime secret and official v3 payload only", async () => {
  const calls: unknown[] = [];
  const client = createHeyGenApiClient({ secrets: { get: async (workspaceId, key) => {
    calls.push([workspaceId, key]); return "test-only-secret";
  } } }, "nextassist", { fetch: async (url, init) => {
    assert.equal(url, "https://api.heygen.com/v3/videos");
    assert.equal(init?.method, "POST");
    assert.equal(new Headers(init?.headers).get("X-Api-Key"), "test-only-secret");
    assert.equal(init?.redirect, "error");
    assert.deepEqual(JSON.parse(String(init?.body)), {
      type: "avatar", title: "Reel", script: "Olá", avatar_id: "avatar", voice_id: "voice", aspect_ratio: "9:16", output_format: "mp4",
    });
    return Response.json({ data: { video_id: "v_123", status: "waiting" } });
  } });
  assert.deepEqual(await client.generate(input), { videoId: "v_123" });
  assert.deepEqual(calls, [["nextassist", "HEYGEN_API_KEY"]]);
  assert.deepEqual(Object.keys(client).sort(), ["generate", "getStatus"]);
});

test("HeyGen API status maps queued/rendering/completed/failed and omits remote error text", async () => {
  for (const [remote, local] of [["waiting", "queued"], ["pending", "queued"], ["processing", "rendering"], ["completed", "completed"], ["failed", "failed"]]) {
    const client = createHeyGenApiClient(ctx, "nextassist", { fetch: async (url) => {
      assert.equal(url, "https://api.heygen.com/v3/videos/v_123");
      return Response.json({ data: { status: remote, video_url: "https://files.heygen.ai/video.mp4", failure_message: "test-only-secret" } });
    } });
    const result = await client.getStatus("v_123");
    assert.equal(result.status, local);
    assert.equal(JSON.stringify(result).includes("test-only-secret"), false);
  }
});

test("HeyGen API sanitizes HTTP, network, invalid JSON and remote errors", async () => {
  for (const fetcher of [
    async () => new Response("test-only-secret", { status: 401 }),
    async () => { throw new Error("test-only-secret"); },
    async () => new Response("test-only-secret"),
    async () => Response.json({ error: { message: "test-only-secret" } }),
  ]) {
    const client = createHeyGenApiClient(ctx, "nextassist", { fetch: fetcher });
    await assert.rejects(client.generate(input), (error: Error) => error.message.includes("HeyGen") && !error.message.includes("test-only-secret"));
  }
});

test("HeyGen API timeout aborts request and reports sanitized error", async () => {
  const client = createHeyGenApiClient(ctx, "nextassist", { timeoutMs: 5, fetch: async (_url, init) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(new Error("test-only-secret")));
  }) });
  await assert.rejects(client.generate(input), /HeyGen.*timeout/);
});

test("HeyGen API rejects malformed input and unexpected response state", async () => {
  const client = createHeyGenApiClient(ctx, "nextassist", { fetch: async () => Response.json({ data: { status: "unknown" } }) });
  await assert.rejects(client.generate({ ...input, script: " " }), /script/);
  await assert.rejects(client.getStatus("../evil"), /videoId/);
  await assert.rejects(client.getStatus("v_123"), /resposta/);
});

test("HeyGen API polling waits through a slow render and resolves on completed", async () => {
  const statuses = ["queued", "rendering", "rendering", "completed"] as const;
  let call = 0;
  const client: HeyGenApiClient = {
    generate: async () => { throw new Error("must not call"); },
    getStatus: async () => {
      const status = statuses[call++];
      return status === "completed" ? { status, videoUrl: "https://files.heygen.ai/v.mp4" } : { status };
    },
  };
  const sleeps: number[] = [];
  const result = await pollHeyGenApiVideo(client, "v_123", { sleep: async (ms) => { sleeps.push(ms); } });
  assert.deepEqual(result, { videoUrl: "https://files.heygen.ai/v.mp4" });
  assert.deepEqual(sleeps, [10_000, 10_000, 10_000]);
});

test("HeyGen API polling always queries the same videoId, never starts a second render", async () => {
  const queried: string[] = [];
  let call = 0;
  const client: HeyGenApiClient = {
    generate: async () => { throw new Error("must not call"); },
    getStatus: async (videoId) => {
      queried.push(videoId);
      call++;
      return call < 3 ? { status: "rendering" } : { status: "completed", videoUrl: "https://files.heygen.ai/v.mp4" };
    },
  };
  await pollHeyGenApiVideo(client, "v_123", { sleep: async () => {} });
  assert.deepEqual(queried, ["v_123", "v_123", "v_123"]);
});

test("HeyGen API polling succeeds even when completion arrives right at the timeout boundary", async () => {
  const clock = fakeClock();
  let call = 0;
  const client: HeyGenApiClient = {
    generate: async () => { throw new Error("must not call"); },
    getStatus: async () => {
      call++;
      return call < 3 ? { status: "rendering" } : { status: "completed", videoUrl: "https://files.heygen.ai/v.mp4" };
    },
  };
  const result = await pollHeyGenApiVideo(client, "v_123", {
    totalTimeoutMs: 20_000, pollIntervalMs: 10_000, now: clock.now, sleep: clock.sleep,
  });
  assert.deepEqual(result, { videoUrl: "https://files.heygen.ai/v.mp4" });
});

test("HeyGen API polling gives up after the total timeout, not after a fixed attempt count", async () => {
  const clock = fakeClock();
  const client: HeyGenApiClient = {
    generate: async () => { throw new Error("must not call"); },
    getStatus: async () => ({ status: "rendering" }),
  };
  await assert.rejects(
    pollHeyGenApiVideo(client, "v_123", { totalTimeoutMs: 30_000, pollIntervalMs: 10_000, now: clock.now, sleep: clock.sleep }),
    /excedeu o tempo máximo/,
  );
});

test("HeyGen API polling stops immediately on failed status without retrying", async () => {
  let calls = 0;
  const client: HeyGenApiClient = {
    generate: async () => { throw new Error("must not call"); },
    getStatus: async () => { calls++; return { status: "failed" }; },
  };
  await assert.rejects(pollHeyGenApiVideo(client, "v_123", { sleep: async () => { throw new Error("must not sleep"); } }), /falhou/);
  assert.equal(calls, 1);
});

test("HeyGen API polling stops immediately on cancelled status without retrying", async () => {
  let calls = 0;
  const client: HeyGenApiClient = {
    generate: async () => { throw new Error("must not call"); },
    getStatus: async () => { calls++; return { status: "cancelled" }; },
  };
  await assert.rejects(pollHeyGenApiVideo(client, "v_123", { sleep: async () => { throw new Error("must not sleep"); } }), /cancelad/);
  assert.equal(calls, 1);
});

test("HeyGen API polling propagates a sanitized HTTP error from getStatus without swallowing it", async () => {
  const client: HeyGenApiClient = {
    generate: async () => { throw new Error("must not call"); },
    getStatus: async () => { throw new Error("HeyGen API: resposta HTTP 500."); },
  };
  await assert.rejects(
    pollHeyGenApiVideo(client, "v_123", { sleep: async () => { throw new Error("must not sleep"); } }),
    /HeyGen API: resposta HTTP 500\./,
  );
});

test("resolveHeyGenApiVideoId reuses an existing id and never generates a second video", async () => {
  let generateCalls = 0;
  const client: HeyGenApiClient = {
    generate: async () => { generateCalls++; return { videoId: "should-not-be-used" }; },
    getStatus: async () => { throw new Error("must not call"); },
  };
  const videoId = await resolveHeyGenApiVideoId(client, input, "existing-id");
  assert.equal(videoId, "existing-id");
  assert.equal(generateCalls, 0);
});

test("resolveHeyGenApiVideoId generates once and persists the new id when none exists", async () => {
  let generateCalls = 0;
  const persisted: string[] = [];
  const client: HeyGenApiClient = {
    generate: async () => { generateCalls++; return { videoId: "new-id" }; },
    getStatus: async () => { throw new Error("must not call"); },
  };
  const videoId = await resolveHeyGenApiVideoId(client, input, undefined, async (id) => { persisted.push(id); });
  assert.equal(videoId, "new-id");
  assert.equal(generateCalls, 1);
  assert.deepEqual(persisted, ["new-id"]);
});
