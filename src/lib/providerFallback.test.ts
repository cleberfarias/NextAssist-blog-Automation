import assert from "node:assert/strict";
import test from "node:test";
import { executeWithFallback, isRecoverableProviderError } from "./providerFallback.js";

test("usa o provedor principal quando ele responde", async () => {
  const calls: string[] = [];
  const result = await executeWithFallback({
    primary: async () => {
      calls.push("primary");
      return "resposta principal";
    },
    fallback: async () => {
      calls.push("fallback");
      return "resposta alternativa";
    },
  });

  assert.deepEqual(calls, ["primary"]);
  assert.deepEqual(result, { value: "resposta principal", usedFallback: false });
});

test("usa o fallback quando o provedor principal está sem crédito", async () => {
  const calls: string[] = [];
  const result = await executeWithFallback({
    primary: async () => {
      calls.push("primary");
      throw Object.assign(new Error("credit balance is too low"), { status: 400 });
    },
    fallback: async () => {
      calls.push("fallback");
      return "resposta alternativa";
    },
  });

  assert.deepEqual(calls, ["primary", "fallback"]);
  assert.deepEqual(result, { value: "resposta alternativa", usedFallback: true });
});

test("não usa o fallback para chave inválida", async () => {
  let fallbackCalled = false;

  await assert.rejects(
    executeWithFallback({
      primary: async () => {
        throw Object.assign(new Error("invalid api key"), { status: 401 });
      },
      fallback: async () => {
        fallbackCalled = true;
        return "não deveria executar";
      },
    }),
    /invalid api key/,
  );

  assert.equal(fallbackCalled, false);
});

test("classifica indisponibilidade, limite e rede como recuperáveis", () => {
  assert.equal(isRecoverableProviderError(Object.assign(new Error("rate limit"), { status: 429 })), true);
  assert.equal(isRecoverableProviderError(Object.assign(new Error("unavailable"), { status: 503 })), true);
  assert.equal(isRecoverableProviderError(Object.assign(new Error("timeout"), { code: "ETIMEDOUT" })), true);
  assert.equal(isRecoverableProviderError(Object.assign(new Error("bad request"), { status: 400 })), false);
});
