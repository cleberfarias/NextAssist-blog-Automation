import assert from "node:assert/strict";
import test from "node:test";
import { EnvSecretProvider } from "./secrets.js";

test("resolve a variável prefixada pelo workspace quando existir", async () => {
  process.env.ACME_ANTHROPIC_API_KEY = "prefixed-value";
  process.env.ANTHROPIC_API_KEY = "unprefixed-value";
  try {
    const provider = new EnvSecretProvider();
    assert.equal(await provider.get("acme", "ANTHROPIC_API_KEY"), "prefixed-value");
  } finally {
    delete process.env.ACME_ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
  }
});

test("cai para a variável sem prefixo quando a prefixada não existe", async () => {
  process.env.OPENAI_API_KEY = "fallback-value";
  try {
    const provider = new EnvSecretProvider();
    assert.equal(await provider.get("acme", "OPENAI_API_KEY"), "fallback-value");
  } finally {
    delete process.env.OPENAI_API_KEY;
  }
});

test("devolve undefined quando nenhuma das duas existe", async () => {
  const provider = new EnvSecretProvider();
  assert.equal(await provider.get("acme", "MISSING_KEY"), undefined);
});

test("normaliza hífen no id do workspace para o prefixo", async () => {
  process.env.WORKSPACE_CHATGURU_IG_ACCESS_TOKEN = "token-value";
  try {
    const provider = new EnvSecretProvider();
    assert.equal(await provider.get("workspace-chatguru", "IG_ACCESS_TOKEN"), "token-value");
  } finally {
    delete process.env.WORKSPACE_CHATGURU_IG_ACCESS_TOKEN;
  }
});
