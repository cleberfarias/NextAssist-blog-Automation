// src/contentCalendar.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import { buildWorkspaceContext } from "./context.js";
import type { MarketingWorkspace } from "./workspace.js";
import type { SecretProvider } from "./lib/secrets.js";
import { createTempWorkspace } from "./testing/tempWorkspace.js";
import { getNextTopic, markTopicPublished, countPendingTopics, getAllTopics, addTopics } from "./contentCalendar.js";

const workspace: MarketingWorkspace = {
  id: "acme", name: "Acme", active: true,
  brand: { name: "Acme", description: "d", toneOfVoice: "t", targetAudience: [], competitors: [] },
  goals: { primary: "leads" },
  channels: { blog: true, instagram: false, linkedin: false },
  integrations: { siteUrl: "https://acme.test", cms: { provider: "nextassist", apiUrl: "https://api.acme.test" } },
  autonomy: { mode: "copilot" },
  secrets: { required: [] },
};

function fakeSecrets(): SecretProvider {
  return { async get() { return undefined; } };
}

async function contextWithCalendar(topicos: unknown[]) {
  const temp = await createTempWorkspace("acme", { "content-calendar.json": { topicos } });
  const ctx = await buildWorkspaceContext(workspace, fakeSecrets(), {
    workspacesRoot: temp.root,
    requireAiProvider: false,
  });
  return { ctx, cleanup: temp.cleanup };
}

test("getNextTopic devolve o primeiro tópico não publicado", async () => {
  const { ctx, cleanup } = await contextWithCalendar([
    { tema: "A", palavraChaveAlvo: "a", publicado: true },
    { tema: "B", palavraChaveAlvo: "b", publicado: false },
  ]);
  try {
    const topic = await getNextTopic(ctx);
    assert.equal(topic?.tema, "B");
  } finally {
    await cleanup();
  }
});

test("getNextTopic devolve null quando não há pendentes (calendário cheio de publicados)", async () => {
  const { ctx, cleanup } = await contextWithCalendar([{ tema: "A", palavraChaveAlvo: "a", publicado: true }]);
  try {
    assert.equal(await getNextTopic(ctx), null);
  } finally {
    await cleanup();
  }
});

test("countPendingTopics conta só os não publicados", async () => {
  const { ctx, cleanup } = await contextWithCalendar([
    { tema: "A", palavraChaveAlvo: "a", publicado: true },
    { tema: "B", palavraChaveAlvo: "b", publicado: false },
    { tema: "C", palavraChaveAlvo: "c", publicado: false },
  ]);
  try {
    assert.equal(await countPendingTopics(ctx), 2);
  } finally {
    await cleanup();
  }
});

test("countPendingTopics devolve 0 para calendário vazio", async () => {
  const { ctx, cleanup } = await contextWithCalendar([]);
  try {
    assert.equal(await countPendingTopics(ctx), 0);
  } finally {
    await cleanup();
  }
});

test("markTopicPublished continua funcionando com itens no formato antigo (sem os campos novos)", async () => {
  const { ctx, cleanup } = await contextWithCalendar([{ tema: "A", palavraChaveAlvo: "a", publicado: false }]);
  try {
    await markTopicPublished(ctx, "A");
    const all = await getAllTopics(ctx);
    assert.equal(all[0].publicado, true);
    assert.ok(all[0].publicadoEm);
  } finally {
    await cleanup();
  }
});

test("addTopics acrescenta tópicos marcados como gerados pelo marketing-director", async () => {
  const { ctx, cleanup } = await contextWithCalendar([{ tema: "A", palavraChaveAlvo: "a", publicado: true }]);
  try {
    const added = await addTopics(ctx, [
      { tema: "B", palavraChaveAlvo: "b", reason: "lacuna de concorrência", priority: "high" },
    ]);
    assert.equal(added.length, 1);
    assert.equal(added[0].generatedBy, "marketing-director");
    assert.ok(added[0].createdAt);
    assert.equal(added[0].publicado, false);
    assert.equal(added[0].reason, "lacuna de concorrência");
    assert.equal(added[0].priority, "high");

    const all = await getAllTopics(ctx);
    assert.equal(all.length, 2);
    assert.equal(await countPendingTopics(ctx), 1);
  } finally {
    await cleanup();
  }
});

test("addTopics com lista vazia não altera o calendário", async () => {
  const { ctx, cleanup } = await contextWithCalendar([{ tema: "A", palavraChaveAlvo: "a", publicado: true }]);
  try {
    const added = await addTopics(ctx, []);
    assert.equal(added.length, 0);
    assert.equal((await getAllTopics(ctx)).length, 1);
  } finally {
    await cleanup();
  }
});
