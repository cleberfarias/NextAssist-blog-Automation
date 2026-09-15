import assert from "node:assert/strict";
import test from "node:test";
import { runApprovedSalesExecution } from "./salesExecutionRuntime.js";
import type { SalesPipelineEntry } from "../sales/types.js";

function entry(status: "pending" | "approved" | "rejected"): SalesPipelineEntry {
  return {
    lead: { leadId: "lead-1", signals: [] },
    assessment: { leadId: "lead-1", score: 80, intent: "high", nextAction: "request_human_contact", reasons: [] },
    outreach: { leadId: "lead-1", channel: "email", message: "Mensagem original", rationale: "teste", requiresHumanApproval: true },
    review: { status, message: "Mensagem aprovada", subject: "Assunto", updatedAt: new Date().toISOString() },
  };
}

test("bloqueia envio quando revisão humana não está aprovada", async () => {
  await assert.rejects(
    runApprovedSalesExecution({
      workspaceId: "nextassist",
      entry: entry("pending"),
      request: { action: "send_email", to: "lead@example.com" },
      transports: {
        email: { async sendEmail() { return { provider: "fake" }; } },
      },
    }),
    /bloqueada|aprovação/i,
  );
});

test("envia mensagem aprovada pelo transport configurado", async () => {
  let sentMessage = "";
  const result = await runApprovedSalesExecution({
    workspaceId: "nextassist",
    entry: entry("approved"),
    request: { action: "send_email", to: "lead@example.com" },
    transports: {
      email: {
        async sendEmail(input) {
          sentMessage = input.message;
          return { provider: "fake", externalId: "msg-1" };
        },
      },
    },
  });

  assert.equal(result.status, "completed");
  assert.equal(result.action, "send_email");
  assert.equal(result.provider, "fake");
  assert.equal(result.externalId, "msg-1");
  assert.equal(sentMessage, "Mensagem aprovada");
});

test("falha fechado quando transport não está configurado", async () => {
  await assert.rejects(
    runApprovedSalesExecution({
      workspaceId: "nextassist",
      entry: entry("approved"),
      request: { action: "send_whatsapp", to: "+5548999999999" },
      transports: {},
    }),
    /Transport de WhatsApp não configurado/,
  );
});
