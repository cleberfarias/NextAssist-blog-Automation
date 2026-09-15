import assert from "node:assert/strict";
import test from "node:test";
import { selectHeyGenProvider } from "./heygenProvider.js";

test("provider selection defaults to explicit headless config and preserves interactive MCP", () => {
  const strategy = { provider: "heygen-mcp" as const, runtimeProviders: { headless: "heygen-api" as const } };
  assert.equal(selectHeyGenProvider(strategy), "heygen-api");
  assert.equal(selectHeyGenProvider(strategy, "interactive"), "heygen-mcp");
  assert.equal(selectHeyGenProvider({ provider: "heygen-mcp" }), "heygen-mcp");
  assert.equal(selectHeyGenProvider(undefined), undefined);
});

test("unknown providers fail closed instead of legacy fallback", () => {
  assert.throws(() => selectHeyGenProvider({ provider: "unknown" } as never), /Provider/);
});
