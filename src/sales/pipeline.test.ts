import assert from "node:assert/strict";
import test from "node:test";
import { buildWorkspaceContext } from "../context.js";
import type { MarketingWorkspace } from "../workspace.js";
import type { SecretProvider } from "../lib/secrets.js";
import { createTempWorkspace } from "../testing/tempWorkspace.js";
import { runWorkspaceSalesCopilot, shouldComposeOutreach } from "./pipeline.js";
import { getSalesState } from "./state.js";
import type { SalesOutreachDraft } from "./types.js";

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
