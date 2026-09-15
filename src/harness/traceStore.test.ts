import test from "node:test";
import assert from "node:assert/strict";
import { appendBoundedTrace } from "./traceStore.js";
import type { AgentTrace } from "./types.js";

function trace(runId: string): AgentTrace {
  return {
    runId,
    workspaceId: "nextassist",
    agent: "revenue-director",
    goal: "test",
    startedAt: "2026-09-12T00:00:00.000Z",
    finishedAt: "2026-09-12T00:00:01.000Z",
    status: "completed",
    steps: [],
    costUsd: 0,
  };
}

test("trace store mantém apenas os registros mais recentes dentro do limite", () => {
  const result = ["a", "b", "c", "d"].reduce<AgentTrace[]>(
    (items, runId) => appendBoundedTrace(items, trace(runId), 3),
    [],
  );
  assert.deepEqual(result.map((item) => item.runId), ["b", "c", "d"]);
});

test("trace store faz upsert por runId antes de aplicar o limite", () => {
  const updated = { ...trace("b"), goal: "updated" };
  const result = appendBoundedTrace([trace("a"), trace("b")], updated, 3);
  assert.equal(result.length, 2);
  assert.equal(result.at(-1)?.goal, "updated");
});
