import assert from "node:assert/strict";
import test from "node:test";
import { configureHeyGenMcpClient, type HeyGenOAuthSessionStore } from "./heygenMcp.js";
import { createHeyGenCreateVideoSkill, runHeyGenVideoWorker } from "./heygenVideoWorker.js";
import { AgentHarnessRuntime } from "./runtime.js";
import { SkillRegistry } from "./registry.js";

const workspaceId = "nextassist";

test("não conecta ao MCP sem sessão OAuth", async () => {
  let called = false;
  const store: HeyGenOAuthSessionStore = { async read() { return undefined; } };
  const client = await configureHeyGenMcpClient({
    workspaceId,
    sessionStore: store,
    connector: { async connect() { called = true; throw new Error("não deveria conectar"); } },
  });
  assert.deepEqual(client, { available: false, reason: "missing-session" });
  assert.equal(called, false);
});

test("não conecta ao MCP com sessão expirada", async () => {
  const store: HeyGenOAuthSessionStore = { async read() { return { accessToken: "secret", expiresAt: "2000-01-01T00:00:00.000Z" }; } };
  const client = await configureHeyGenMcpClient({
    workspaceId,
    sessionStore: store,
    connector: { async connect() { throw new Error("não deveria conectar"); } },
  });
  assert.deepEqual(client, { available: false, reason: "expired-session" });
});

test("persiste rotação de sessão somente através do armazenamento injetado", async () => {
  let savedToken: string | undefined;
  const store: HeyGenOAuthSessionStore = {
    async read() { return { accessToken: "initial" }; },
    async write(_workspaceId, session) { savedToken = session.accessToken; },
  };
  const client = await configureHeyGenMcpClient({
    workspaceId,
    sessionStore: store,
    connector: {
      async connect({ onSessionUpdated }) {
        await onSessionUpdated?.({ accessToken: "rotated" });
        return { async callTool() { return "ok"; } };
      },
    },
  });
  assert.equal(client.available, true);
  assert.equal(savedToken, "rotated");
});

test("o worker exige aprovação antes de criar vídeo", async () => {
  let toolCalled = false;
  const client = { available: true as const, async callTool() { toolCalled = true; return { id: "video-1" }; } };
  const runtime = new AgentHarnessRuntime({
    registry: new SkillRegistry().register(createHeyGenCreateVideoSkill()),
    approvalProvider: { async approve() { return false; } },
  });
  const result = await runHeyGenVideoWorker(runtime, client, {
    workspaceId,
    prompt: "Demonstração do NextAssist",
    createVideoTool: "server-supplied-tool-name",
    toolInput: { prompt: "Demonstração do NextAssist" },
  });
  assert.equal(result.status, "blocked");
  assert.equal(toolCalled, false);
});
