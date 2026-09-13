import assert from "node:assert/strict";
import test from "node:test";
import {
  clearHeyGenMcpClient,
  configureHeyGenMcpClient,
  generateHeyGenMcpReel,
  isHeyGenMcpAvailable,
  type HeyGenMcpVideoRequest,
} from "./heygen.js";

const request: HeyGenMcpVideoRequest = {
  title: "NextAssist teste",
  prompt: "Crie um Reel de teste.",
  avatarId: "avatar-cleber",
  voiceId: "voz-dinamica",
  aspectRatio: "9:16",
  music: true,
  musicVolume: 0.12,
};

test("HeyGen MCP falha de forma segura quando o runtime OAuth não está configurado", async () => {
  clearHeyGenMcpClient();
  assert.equal(isHeyGenMcpAvailable(), false);
  await assert.rejects(
    () => generateHeyGenMcpReel(request),
    /MCP indisponível.*bloqueado.*não haverá fallback/s,
  );
});

test("HeyGen MCP usa o cliente injetado e preserva avatar/voz configurados", async () => {
  clearHeyGenMcpClient();
  const calls: HeyGenMcpVideoRequest[] = [];
  configureHeyGenMcpClient({
    async generateVideo(input) {
      calls.push(input);
      return { videoBuffer: Buffer.from("video-ok"), videoId: "video-123" };
    },
  });

  try {
    const result = await generateHeyGenMcpReel(request);
    assert.equal(result.toString(), "video-ok");
    assert.equal(isHeyGenMcpAvailable(), true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.avatarId, "avatar-cleber");
    assert.equal(calls[0]?.voiceId, "voz-dinamica");
    assert.equal(calls[0]?.aspectRatio, "9:16");
    assert.equal(calls[0]?.music, true);
  } finally {
    clearHeyGenMcpClient();
  }
});
