import assert from "node:assert/strict";
import test from "node:test";
import { buildWorkspaceContext } from "../context.js";
import type { WorkspaceContext } from "../context.js";
import type { MarketingWorkspace } from "../workspace.js";
import type { SecretProvider } from "../lib/secrets.js";
import { createTempWorkspace } from "../testing/tempWorkspace.js";
import { runWorkspaceSalesCopilot, shouldComposeOutreach } from "./pipeline.js";
import { getSalesState, reviewSalesDraft } from "./state.js";
import type { SalesAssessment, SalesLeadContext, SalesOutreachDraft } from "./types.js";

test("gera abordagem apenas para lead de alta intenção que pede contato humano", () => {
  assert.equal(shouldComposeOutreach({
    leadId: "lead-1",
    score: 80,
    intent: "high",
    nextAction: "request_human_contact",
    reasons: [],
  }), true);

  assert.equal(shouldComposeOutreach({
    leadId: "lead-2",
    score: 45,
    intent: "medium",
    nextAction: "offer_help",
    reasons: [],
  }), false);

  assert.equal(shouldComposeOutreach({
    leadId: "lead-3",
    score: 100,
    intent: "customer",
    nextAction: "customer_success",
    reasons: [],
  }), false);
});

function baseWorkspace(): MarketingWorkspace {
  return {
    id: "acme", name: "Acme", active: true,
    brand: { name: "Acme", description: "d", toneOfVoice: "t", targetAudience: [], competitors: [] },
    goals: { primary: "leads" },
    channels: { blog: true, instagram: false, linkedin: false },
    integrations: { siteUrl: "https://acme.test", cms: { provider: "nextassist", apiUrl: "https://api.acme.test" } },
    autonomy: { mode: "copilot" },
    secrets: { required: [] },
  };
}

function fakeSecrets(): SecretProvider {
  return { async get() { return undefined; } };
}

// Precisa somar >= 70 pontos pra virar intent "high" + nextAction
// "request_human_contact" (ver src/harness/skills/salesSkills.ts: WEIGHTS —
// site_visit 5 + pricing_view 15 + trial_started 30 + contact_submit 25 = 75).
const hotLeadEvents = [
  { name: "page_view", anonymousId: "lead-1", path: "/", createdAt: "2026-09-14T09:00:00.000Z" },
  { name: "page_view", anonymousId: "lead-1", path: "/precos", createdAt: "2026-09-14T09:30:00.000Z" },
  { name: "trial_started", anonymousId: "lead-1", createdAt: "2026-09-14T10:00:00.000Z" },
  { name: "contact_submit", anonymousId: "lead-1", createdAt: "2026-09-14T10:05:00.000Z" },
];

const fakeDraft: SalesOutreachDraft = {
  leadId: "lead-1", channel: "human", message: "Rascunho novo", rationale: "r", requiresHumanApproval: true,
};

test("não reescreve rascunho de venda com review pendente — não chama o composer de novo", async () => {
  const temp = await createTempWorkspace("acme", {
    "conversion-events.json": hotLeadEvents,
    "sales-state.json": {
      updatedAt: "2026-09-14T10:05:00.000Z",
      entries: [{
        lead: { leadId: "lead-1", anonymousId: "lead-1", signals: [] },
        assessment: { leadId: "lead-1", score: 75, intent: "high", nextAction: "request_human_contact", reasons: [] },
        outreach: { leadId: "lead-1", channel: "human", message: "Rascunho antigo aguardando revisão", rationale: "r", requiresHumanApproval: true },
        review: { status: "pending", message: "Rascunho antigo aguardando revisão", updatedAt: "2026-09-14T10:05:00.000Z" },
      }],
    },
  });
  try {
    const ctx = await buildWorkspaceContext(baseWorkspace(), fakeSecrets(), { workspacesRoot: temp.root, requireAiProvider: false });
    let composeCalls = 0;
    const composeOutreachFn = async (): Promise<SalesOutreachDraft> => { composeCalls++; return fakeDraft; };

    const result = await runWorkspaceSalesCopilot(ctx, { composeOutreach: true, composeOutreachFn });

    assert.equal(composeCalls, 0, "não deveria chamar o composer — já existe rascunho pendente");
    assert.equal(result.outreachCreated, 0);
    assert.equal(result.outreachReused, 1);
    assert.equal(result.entries[0]?.outreach?.message, "Rascunho antigo aguardando revisão");

    // Persistido, não só em memória: a revisão pendente precisa sobreviver no
    // sales-state.json, senão o painel perde o rastro dela no próximo GET.
    const persisted = await getSalesState(ctx);
    assert.equal(persisted?.entries[0]?.review?.status, "pending");
    assert.equal(persisted?.entries[0]?.outreach?.message, "Rascunho antigo aguardando revisão");
  } finally {
    await temp.cleanup();
  }
});

test("gera rascunho novo quando não existe nenhum anterior", async () => {
  const temp = await createTempWorkspace("acme", { "conversion-events.json": hotLeadEvents });
  try {
    const ctx = await buildWorkspaceContext(baseWorkspace(), fakeSecrets(), { workspacesRoot: temp.root, requireAiProvider: false });
    let composeCalls = 0;
    const composeOutreachFn = async (): Promise<SalesOutreachDraft> => { composeCalls++; return fakeDraft; };

    const result = await runWorkspaceSalesCopilot(ctx, { composeOutreach: true, composeOutreachFn });

    assert.equal(composeCalls, 1);
    assert.equal(result.outreachCreated, 1);
    assert.equal(result.outreachReused, 0);
    assert.equal(result.entries[0]?.outreach?.message, "Rascunho novo");
  } finally {
    await temp.cleanup();
  }
});

test("repassa o causedBy recebido (runId do Loop de Crescimento) até o composer de abordagem", async () => {
  const temp = await createTempWorkspace("acme", { "conversion-events.json": hotLeadEvents });
  try {
    const ctx = await buildWorkspaceContext(baseWorkspace(), fakeSecrets(), { workspacesRoot: temp.root, requireAiProvider: false });
    let capturedCausedBy: string | undefined;
    const composeOutreachFn = async (
      _ctx: WorkspaceContext,
      _lead: SalesLeadContext,
      _assessment: SalesAssessment,
      _steering: string | undefined,
      causedBy: string | undefined,
    ): Promise<SalesOutreachDraft> => {
      capturedCausedBy = causedBy;
      return fakeDraft;
    };

    await runWorkspaceSalesCopilot(ctx, { composeOutreach: true, composeOutreachFn, causedBy: "some-run-id" });

    // Um typo como `causedBy: options.steering` no lugar de `causedBy:
    // options.causedBy` na chamada real passaria despercebido sem isto —
    // nenhum outro teste aqui inspeciona o 5º argumento recebido pelo composer.
    assert.equal(capturedCausedBy, "some-run-id");
  } finally {
    await temp.cleanup();
  }
});

test("falha ao compor abordagem de um lead não descarta os rascunhos já compostos para os outros leads do mesmo loop", async () => {
  const hotLeadEventsFor = (anonymousId: string) => [
    { name: "page_view", anonymousId, path: "/", createdAt: "2026-09-14T09:00:00.000Z" },
    { name: "page_view", anonymousId, path: "/precos", createdAt: "2026-09-14T09:30:00.000Z" },
    { name: "trial_started", anonymousId, createdAt: "2026-09-14T10:00:00.000Z" },
    { name: "contact_submit", anonymousId, createdAt: "2026-09-14T10:05:00.000Z" },
  ];
  const temp = await createTempWorkspace("acme", {
    "conversion-events.json": [...hotLeadEventsFor("lead-1"), ...hotLeadEventsFor("lead-2")],
  });
  try {
    const ctx = await buildWorkspaceContext(baseWorkspace(), fakeSecrets(), { workspacesRoot: temp.root, requireAiProvider: false });
    const composeOutreachFn = async (
      _ctx: WorkspaceContext,
      lead: SalesLeadContext,
      _assessment: SalesAssessment,
    ): Promise<SalesOutreachDraft> => {
      if (lead.leadId === "lead-1") throw new Error("IA retornou JSON inválido");
      return { leadId: lead.leadId, channel: "human", message: `Rascunho para ${lead.leadId}`, rationale: "r", requiresHumanApproval: true };
    };

    const result = await runWorkspaceSalesCopilot(ctx, { composeOutreach: true, composeOutreachFn });

    assert.equal(result.outreachCreated, 1, "apenas o lead com sucesso deve contar — o que falhou não conta");

    const failedEntry = result.entries.find((e) => e.lead.leadId === "lead-1");
    const successEntry = result.entries.find((e) => e.lead.leadId === "lead-2");
    assert.ok(failedEntry, "lead cuja composição falhou continua presente no resultado, sem outreach");
    assert.equal(failedEntry?.outreach, undefined);
    assert.equal(successEntry?.outreach?.message, "Rascunho para lead-2");

    // Persistido, não só em memória — a falha em um lead não pode fazer o
    // saveSalesState nunca ser alcançado e derrubar o rascunho do outro lead.
    const persisted = await getSalesState(ctx);
    const persistedFailed = persisted?.entries.find((e) => e.lead.leadId === "lead-1");
    const persistedSuccess = persisted?.entries.find((e) => e.lead.leadId === "lead-2");
    assert.equal(persistedFailed?.outreach, undefined);
    assert.equal(persistedSuccess?.outreach?.message, "Rascunho para lead-2");
  } finally {
    await temp.cleanup();
  }
});

test("revisão humana concorrente (aprovação/edição) durante o run não é sobrescrita por saveSalesState no fim do loop", async () => {
  const hotLeadEventsFor = (anonymousId: string) => [
    { name: "page_view", anonymousId, path: "/", createdAt: "2026-09-14T09:00:00.000Z" },
    { name: "page_view", anonymousId, path: "/precos", createdAt: "2026-09-14T09:30:00.000Z" },
    { name: "trial_started", anonymousId, createdAt: "2026-09-14T10:00:00.000Z" },
    { name: "contact_submit", anonymousId, createdAt: "2026-09-14T10:05:00.000Z" },
  ];
  const temp = await createTempWorkspace("acme", {
    "conversion-events.json": [...hotLeadEventsFor("lead-a"), ...hotLeadEventsFor("lead-b")],
    // Lead A já tem rascunho pendente — será REAPROVEITADO pelo loop (não
    // recomposto). Lead B é novo, sem estado anterior — vai pelo composer.
    "sales-state.json": {
      updatedAt: "2026-09-14T10:05:00.000Z",
      entries: [{
        lead: { leadId: "lead-a", anonymousId: "lead-a", signals: [] },
        assessment: { leadId: "lead-a", score: 75, intent: "high", nextAction: "request_human_contact", reasons: [] },
        outreach: { leadId: "lead-a", channel: "human", message: "Rascunho original de A", rationale: "r", requiresHumanApproval: true },
        review: { status: "pending", message: "Rascunho original de A", updatedAt: "2026-09-14T10:05:00.000Z" },
      }],
    },
  });
  try {
    const ctx = await buildWorkspaceContext(baseWorkspace(), fakeSecrets(), { workspacesRoot: temp.root, requireAiProvider: false });

    // Simula a concorrência de verdade: enquanto o loop ainda está DENTRO da
    // chamada de composição do lead B (ainda não chegou no saveSalesState do
    // fim do run), um humano aprova e edita o rascunho do lead A via
    // reviewSalesDraft — que persiste direto no disco, por fora do loop.
    const composeOutreachFn = async (
      _ctx: WorkspaceContext,
      lead: SalesLeadContext,
    ): Promise<SalesOutreachDraft> => {
      if (lead.leadId === "lead-b") {
        await reviewSalesDraft(ctx, {
          leadId: "lead-a",
          status: "approved",
          message: "texto editado pelo humano",
        });
      }
      return { leadId: lead.leadId, channel: "human", message: `Rascunho para ${lead.leadId}`, rationale: "r", requiresHumanApproval: true };
    };

    await runWorkspaceSalesCopilot(ctx, { composeOutreach: true, composeOutreachFn });

    const persisted = await getSalesState(ctx);
    const leadA = persisted?.entries.find((e) => e.lead.leadId === "lead-a");

    // A aprovação/edição do humano precisa sobreviver — não pode ser
    // revertida para o "pending" antigo que o loop tinha em memória desde o
    // início do run.
    assert.equal(leadA?.review?.status, "approved");
    assert.equal(leadA?.review?.message, "texto editado pelo humano");
    // O rascunho reaproveitado de A continua intocado — só a review mudou.
    assert.equal(leadA?.outreach?.message, "Rascunho original de A");
  } finally {
    await temp.cleanup();
  }
});

test("gera rascunho novo quando o anterior foi rejeitado", async () => {
  const temp = await createTempWorkspace("acme", {
    "conversion-events.json": hotLeadEvents,
    "sales-state.json": {
      updatedAt: "2026-09-14T10:05:00.000Z",
      entries: [{
        lead: { leadId: "lead-1", anonymousId: "lead-1", signals: [] },
        assessment: { leadId: "lead-1", score: 75, intent: "high", nextAction: "request_human_contact", reasons: [] },
        outreach: { leadId: "lead-1", channel: "human", message: "Rascunho rejeitado", rationale: "r", requiresHumanApproval: true },
        review: { status: "rejected", message: "Rascunho rejeitado", updatedAt: "2026-09-14T10:05:00.000Z" },
      }],
    },
  });
  try {
    const ctx = await buildWorkspaceContext(baseWorkspace(), fakeSecrets(), { workspacesRoot: temp.root, requireAiProvider: false });
    let composeCalls = 0;
    const composeOutreachFn = async (): Promise<SalesOutreachDraft> => { composeCalls++; return fakeDraft; };

    const result = await runWorkspaceSalesCopilot(ctx, { composeOutreach: true, composeOutreachFn });

    assert.equal(composeCalls, 1, "review rejeitada libera uma nova tentativa");
    assert.equal(result.outreachCreated, 1);
    assert.equal(result.outreachReused, 0);
    assert.equal(result.entries[0]?.review, undefined, "rascunho novo não herda a review antiga em memória");

    // Persistido, não só em memória: sem isso, sales-state.json reata a review
    // "rejected" antiga ao rascunho novo e um filtro de "pendente revisão" no
    // painel esconderia o rascunho novo do humano — exatamente o bug relatado.
    const persisted = await getSalesState(ctx);
    assert.equal(persisted?.entries[0]?.review, undefined);
    assert.equal(persisted?.entries[0]?.outreach?.message, "Rascunho novo");
  } finally {
    await temp.cleanup();
  }
});
