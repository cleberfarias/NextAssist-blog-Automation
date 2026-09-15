import assert from "node:assert/strict";
import test from "node:test";
import { AgentHarnessRuntime } from "./runtime.js";
import { SkillRegistry } from "./registry.js";

function request(overrides: Record<string, unknown> = {}) {
  return {
    workspaceId: "nextassist",
    agent: "marketing-director" as const,
    goal: "test",
    context: {},
    allowedSkills: ["echo"],
    budget: { maxSteps: 2, maxCostUsd: 1 },
    ...overrides,
  };
}

test("executa apenas skills registradas e autorizadas", async () => {
  const registry = new SkillRegistry().register({
    name: "echo",
    async execute(input: { value: string }) {
      return input.value.toUpperCase();
    },
  });
  const runtime = new AgentHarnessRuntime({ registry });

  const result = await runtime.run(request(), async ({ invoke }) => invoke<{ value: string }, string>("echo", { value: "next" }));

  assert.equal(result.status, "completed");
  assert.equal(result.output, "NEXT");
  assert.equal(result.steps, 1);
  assert.equal(result.trace.steps[0]?.skill, "echo");
});

test("bloqueia skill fora da allowlist", async () => {
  const registry = new SkillRegistry().register({ name: "danger", async execute() { return true; } });
  const runtime = new AgentHarnessRuntime({ registry });

  const result = await runtime.run(request({ allowedSkills: [] }), async ({ invoke }) => invoke("danger", {}));

  assert.equal(result.status, "blocked");
  assert.match(result.trace.error ?? "", /não autorizada/);
});

test("bloqueia quando excede o limite de steps", async () => {
  const registry = new SkillRegistry().register({ name: "echo", async execute() { return true; } });
  const runtime = new AgentHarnessRuntime({ registry });

  const result = await runtime.run(request({ budget: { maxSteps: 1, maxCostUsd: 1 } }), async ({ invoke }) => {
    await invoke("echo", {});
    return invoke("echo", {});
  });

  assert.equal(result.status, "blocked");
  assert.equal(result.steps, 1);
  assert.match(result.trace.error ?? "", /Budget de steps/);
});

test("skill crítica exige aprovação", async () => {
  const registry = new SkillRegistry().register({ name: "send-message", requiresApproval: true, async execute() { return true; } });
  const runtime = new AgentHarnessRuntime({
    registry,
    approvalProvider: { async approve() { return false; } },
  });

  const result = await runtime.run(request({ allowedSkills: ["send-message"] }), async ({ invoke }) => invoke("send-message", {}));

  assert.equal(result.status, "blocked");
  assert.match(result.trace.error ?? "", /aprovação/);
});
