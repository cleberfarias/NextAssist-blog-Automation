import assert from "node:assert/strict";
import test from "node:test";
import { resolveFunnelStage } from "./topicPlanner.js";

test("aceita os três valores válidos", () => {
  assert.equal(resolveFunnelStage("topo"), "topo");
  assert.equal(resolveFunnelStage("meio"), "meio");
  assert.equal(resolveFunnelStage("fundo"), "fundo");
});

test("usa 'meio' como fallback para valor inválido ou ausente", () => {
  assert.equal(resolveFunnelStage(undefined), "meio");
  assert.equal(resolveFunnelStage("bottom"), "meio");
  assert.equal(resolveFunnelStage(42), "meio");
});
