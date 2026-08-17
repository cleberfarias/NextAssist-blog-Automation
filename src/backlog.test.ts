// src/backlog.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import { buildWorkspaceContext } from "./context.js";
import type { MarketingWorkspace } from "./workspace.js";
import type { SecretProvider } from "./lib/secrets.js";
import { createTempWorkspace } from "./testing/tempWorkspace.js";
import { getAllTopics, countPendingTopics } from "./contentCalendar.js";
import { ensureContentBacklog, validateOpportunities } from "./backlog.js";
import type { ContentOpportunity } from "./lib/marketingDirector.js";
import type { PipelineEvent } from "./pipelineEvents.js";

function baseWorkspace(overrides: Partial<MarketingWorkspace> = {}): MarketingWorkspace {
  return {
    id: "acme", name: "Acme", active: true,
    brand: { name: "Acme", description: "d", toneOfVoice: "t", targetAudience: [], competitors: [] },
    goals: { primary: "leads" },
    channels: { blog: true, instagram: false, linkedin: false },
    integrations: { siteUrl: "https://acme.test", cms: { provider: "nextassist", apiUrl: "https://api.acme.test" } },
    autonomy: { mode: "copilot" },
    secrets: { required: [] },
    ...overrides,
  };
}

function fakeSecrets(): SecretProvider {
  return { async get() { return undefined; } };
}

async function contextWithCalendar(workspace: MarketingWorkspace, topicos: unknown[], history: unknown[] = []) {
  const temp = await createTempWorkspace(workspace.id, {
    "content-calendar.json": { topicos },
    "post-history.json": history,
  });
  const ctx = await buildWorkspaceContext(workspace, fakeSecrets(), {
    workspacesRoot: temp.root,
    requireAiProvider: false,
  });
  return { ctx, cleanup: temp.cleanup };
}

function opportunity(overrides: Partial<ContentOpportunity> = {}): ContentOpportunity {
  return {
    tema: "Novo tema qualquer",
    palavraChaveAlvo: "novo tema",
    reason: "motivo",
    priority: "medium",
    source: "other",
    ...overrides,
  };
}

test("calendário cheio: não chama o Director e não altera o calendário", async () => {
  const workspace = baseWorkspace({ contentStrategy: { minimumPendingTopics: 2, replenishAmount: 5 } });
  const { ctx, cleanup } = await contextWithCalendar(workspace, [
    { tema: "A", palavraChaveAlvo: "a", publicado: false },
    { tema: "B", palavraChaveAlvo: "b", publicado: false },
  ]);
  try {
    let called = false;
    const result = await ensureContentBacklog(ctx, undefined, { generate: async () => { called = true; return []; } });
    assert.equal(called, false);
    assert.equal(result.skipped, true);
    assert.equal(result.pendingBefore, 2);
    assert.equal(result.pendingAfter, 2);
    assert.equal(result.generated, 0);
    assert.equal(await countPendingTopics(ctx), 2);
  } finally {
    await cleanup();
  }
});

test("calendário baixo: chama o Director e persiste as novas pautas válidas", async () => {
  const workspace = baseWorkspace({ contentStrategy: { minimumPendingTopics: 3, replenishAmount: 5 } });
  const { ctx, cleanup } = await contextWithCalendar(workspace, [
    { tema: "Tema existente", palavraChaveAlvo: "existente", publicado: false },
  ]);
  try {
    const events: PipelineEvent[] = [];
    const result = await ensureContentBacklog(ctx, (e) => events.push(e), {
      generate: async () => [
        opportunity({ tema: "Tema novo A", palavraChaveAlvo: "novo a" }),
        opportunity({ tema: "Tema novo B", palavraChaveAlvo: "novo b" }),
      ],
    });
    assert.equal(result.skipped, false);
    assert.equal(result.pendingBefore, 1);
    assert.equal(result.generated, 2);
    assert.equal(result.pendingAfter, 3);
    assert.equal(await countPendingTopics(ctx), 3);
    assert.ok(events.some((e) => e.agent === "marketing-director" && e.status === "working"));
    assert.ok(events.some((e) => e.agent === "marketing-director" && e.status === "done"));
  } finally {
    await cleanup();
  }
});

test("calendário vazio: reabastece do zero", async () => {
  const workspace = baseWorkspace({ contentStrategy: { minimumPendingTopics: 5, replenishAmount: 3 } });
  const { ctx, cleanup } = await contextWithCalendar(workspace, []);
  try {
    const result = await ensureContentBacklog(ctx, undefined, {
      generate: async () => [
        opportunity({ tema: "Tema 1", palavraChaveAlvo: "k1" }),
        opportunity({ tema: "Tema 2", palavraChaveAlvo: "k2" }),
        opportunity({ tema: "Tema 3", palavraChaveAlvo: "k3" }),
      ],
    });
    assert.equal(result.pendingBefore, 0);
    assert.equal(result.generated, 3);
    assert.equal(result.pendingAfter, 3);
  } finally {
    await cleanup();
  }
});

test("validateOpportunities respeita o limite máximo configurável", () => {
  const opportunities = [
    opportunity({ tema: "T1", palavraChaveAlvo: "k1" }),
    opportunity({ tema: "T2", palavraChaveAlvo: "k2" }),
    opportunity({ tema: "T3", palavraChaveAlvo: "k3" }),
  ];
  const result = validateOpportunities(opportunities, {
    existingThemes: [], existingKeywords: [], publishedTitles: [], forbiddenTerms: [], maxCount: 2,
  });
  assert.equal(result.accepted.length, 2);
});

test("duplicidades: descarta tema repetido, palavra-chave repetida, termo proibido e pauta muito similar a post publicado", async () => {
  const workspace = baseWorkspace({
    contentStrategy: { minimumPendingTopics: 5, replenishAmount: 10 },
    brand: { ...baseWorkspace().brand, forbiddenTerms: ["concorrente x"] },
  });
  const { ctx, cleanup } = await contextWithCalendar(
    workspace,
    [{ tema: "Como organizar estoque de celular", palavraChaveAlvo: "estoque celular", publicado: false }],
    [{ tema: "t", titulo: "Guia completo de atendimento via WhatsApp para assistência técnica", slug: "s", publicadoEm: "2026-01-01T00:00:00Z" }],
  );
  try {
    const result = await ensureContentBacklog(ctx, undefined, {
      generate: async () => [
        opportunity({ tema: "Como organizar estoque de celular", palavraChaveAlvo: "outra palavra" }), // tema duplicado
        opportunity({ tema: "Outro tema qualquer", palavraChaveAlvo: "estoque celular" }), // keyword duplicada
        opportunity({ tema: "Fale mal do concorrente X aqui", palavraChaveAlvo: "concorrente x review" }), // termo proibido
        opportunity({ tema: "Guia completo de atendimento via WhatsApp para assistências técnicas", palavraChaveAlvo: "whatsapp atendimento" }), // muito similar a post publicado
        opportunity({ tema: "Tema totalmente novo e único sobre garantia estendida", palavraChaveAlvo: "garantia estendida" }), // válido
      ],
    });
    assert.equal(result.generated, 1);
    assert.equal(result.discardedDuplicates, 3);
    assert.equal(result.discardedForbidden, 1);
    const all = await getAllTopics(ctx);
    assert.ok(all.some((t) => t.tema === "Tema totalmente novo e único sobre garantia estendida"));
  } finally {
    await cleanup();
  }
});

test("falha do Director: registra erro, não altera o calendário, pipeline pode seguir com a pauta pendente antiga", async () => {
  const workspace = baseWorkspace({ contentStrategy: { minimumPendingTopics: 3, replenishAmount: 5 } });
  const { ctx, cleanup } = await contextWithCalendar(workspace, [
    { tema: "Tema pendente antigo", palavraChaveAlvo: "antigo", publicado: false },
  ]);
  try {
    const events: PipelineEvent[] = [];
    const result = await ensureContentBacklog(ctx, (e) => events.push(e), {
      generate: async () => { throw new Error("provider indisponível"); },
    });
    assert.equal(result.pendingBefore, 1);
    assert.equal(result.generated, 0);
    assert.equal(result.pendingAfter, 1);
    assert.match(result.error ?? "", /provider indisponível/);
    assert.ok(events.some((e) => e.agent === "marketing-director" && e.status === "error"));

    const all = await getAllTopics(ctx);
    assert.equal(all.length, 1);
    assert.equal(all[0].tema, "Tema pendente antigo");
  } finally {
    await cleanup();
  }
});
