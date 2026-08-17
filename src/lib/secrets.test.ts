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

test("cai para a variável sem prefixo quando a prefixada não existe (com allowGlobalFallback habilitado)", async () => {
  process.env.OPENAI_API_KEY = "fallback-value";
  try {
    // allowGlobalFallback explícito: o padrão depende de NODE_ENV (ver testes
    // abaixo), então este teste fixa o comportamento que está exercitando.
    const provider = new EnvSecretProvider({ allowGlobalFallback: true });
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

test("allowGlobalFallback: false não cai para a variável sem prefixo (evita vazamento entre workspaces em produção)", async () => {
  process.env.OPENAI_API_KEY = "should-not-leak";
  try {
    const provider = new EnvSecretProvider({ allowGlobalFallback: false });
    assert.equal(await provider.get("acme", "OPENAI_API_KEY"), undefined);
  } finally {
    delete process.env.OPENAI_API_KEY;
  }
});

test("padrão desliga o fallback quando NODE_ENV=production", async () => {
  const originalEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  process.env.OPENAI_API_KEY = "should-not-leak";
  try {
    const provider = new EnvSecretProvider();
    assert.equal(await provider.get("acme", "OPENAI_API_KEY"), undefined);
  } finally {
    delete process.env.OPENAI_API_KEY;
    if (originalEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalEnv;
  }
});
