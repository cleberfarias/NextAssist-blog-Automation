import test from "node:test";
import assert from "node:assert/strict";
import { createHeyGenApiClient } from "./heygenApi.js";

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
  assert.deepEqual(Object.keys(client).sort(), ["generate", "generateStudio", "getStatus"]);
});

const studioScenes = [
  {
    type: "avatar_video", input: {
      type: "avatar", avatar_id: "avatar", script: "Gancho", voice_id: "voice",
      voice_settings: { pitch: 0, speed: 1.05, volume: 1 }, engine: { type: "avatar_iv" },
      expressiveness: "high", motion_prompt: "abertura", background: { type: "color", color: "#F6F6FC" },
    },
  },
  { type: "video", source: { type: "asset_id", asset_id: "broll_1" }, script: "Narração 1", voice_id: "voice", playback: { mode: "fit_to_scene", volume: 0 } },
];

test("HeyGen API generateStudio envia type:studio com as cenas intactas e extrai video_id (endpoint v3/videos, mesmo do generate)", async () => {
  const client = createHeyGenApiClient({ secrets: { get: async () => "test-only-secret" } }, "nextassist", {
    fetch: async (url, init) => {
      assert.equal(url, "https://api.heygen.com/v3/videos");
      assert.equal(init?.method, "POST");
      assert.deepEqual(JSON.parse(String(init?.body)), {
        type: "studio", title: "Reel Studio", scenes: studioScenes, aspect_ratio: "9:16", resolution: "1080p",
      });
      return Response.json({ data: { video_id: "v_studio_1" } });
    },
  });
  assert.deepEqual(
    await client.generateStudio({ title: "Reel Studio", scenes: studioScenes, aspectRatio: "9:16" }),
    { videoId: "v_studio_1" },
  );
});

test("HeyGen API generateStudio rejeita cenas vazias e resposta sem video_id, sem vazar corpo bruto", async () => {
  await assert.rejects(
    createHeyGenApiClient(ctx, "nextassist", { fetch: async () => { throw new Error("must not call"); } })
      .generateStudio({ title: "t", scenes: [], aspectRatio: "9:16" }),
    /cena/,
  );
  const client = createHeyGenApiClient(ctx, "nextassist", { fetch: async () => Response.json({ data: { video_id: "test-only-secret".slice(0, 0) } }) });
  await assert.rejects(client.generateStudio({ title: "t", scenes: studioScenes, aspectRatio: "9:16" }), /video_id/);
});

test("HeyGen API status maps queued/rendering/completed/failed/cancelled and omits remote error text", async () => {
  for (const [remote, local] of [["waiting", "queued"], ["pending", "queued"], ["processing", "rendering"], ["completed", "completed"], ["failed", "failed"], ["cancelled", "cancelled"]]) {
    const client = createHeyGenApiClient(ctx, "nextassist", { fetch: async (url) => {
      assert.equal(url, "https://api.heygen.com/v3/videos/v_123");
      return Response.json({ data: { status: remote, video_url: "https://files.heygen.ai/video.mp4", failure_message: "test-only-secret" } });
    } });
    const result = await client.getStatus("v_123");
    assert.equal(result.status, local);
    assert.equal(JSON.stringify(result).includes("test-only-secret"), false);
  }
});

test("HeyGen API status maps HTTP 404 to a not_found value instead of throwing", async () => {
  const client = createHeyGenApiClient(ctx, "nextassist", {
    fetch: async () => new Response("test-only-secret", { status: 404 }),
  });
  const result = await client.getStatus("v_123");
  assert.deepEqual(result, { status: "not_found" });
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

test("HeyGen API a non-404 HTTP error still throws (never silently becomes not_found)", async () => {
  const client = createHeyGenApiClient(ctx, "nextassist", { fetch: async () => new Response("test-only-secret", { status: 500 }) });
  await assert.rejects(client.getStatus("v_123"), (error: Error) => error.message.includes("HeyGen") && !error.message.includes("test-only-secret"));
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
