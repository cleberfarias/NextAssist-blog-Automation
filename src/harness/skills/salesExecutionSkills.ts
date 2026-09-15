import type { SalesExecutionRecord, SalesPipelineEntry } from "../../sales/types.js";
import type { SalesTransports } from "../../sales/transports.js";
import type { SkillDefinition } from "../types.js";

export const SEND_EMAIL_SKILL = "sales.send_email";
export const SEND_WHATSAPP_SKILL = "sales.send_whatsapp";

export interface SalesExecutionHarnessContext {
  entry: SalesPipelineEntry;
  transports: SalesTransports;
}

export interface SendEmailInput {
  to: string;
}

export interface SendWhatsAppInput {
  to: string;
}

function approvedMessage(entry: SalesPipelineEntry): { subject?: string; message: string } {
  if (!entry.outreach) throw new Error("Lead sem rascunho de abordagem.");
  if (entry.review?.status !== "approved") throw new Error("Rascunho comercial não aprovado por humano.");
  const message = entry.review.message.trim();
  if (!message) throw new Error("Mensagem aprovada está vazia.");
  return { subject: entry.review.subject, message };
}

export const sendEmailSkill: SkillDefinition<SendEmailInput, SalesExecutionRecord, SalesExecutionHarnessContext> = {
  name: SEND_EMAIL_SKILL,
  description: "Envia e-mail comercial somente após aprovação humana explícita.",
  requiresApproval: true,
  async execute(input, context) {
    const transport = context.context.transports.email;
    if (!transport) throw new Error("Transport de e-mail não configurado.");
    if (!input.to.trim()) throw new Error("Destinatário de e-mail ausente.");
    const approved = approvedMessage(context.context.entry);
    const result = await transport.sendEmail({ to: input.to.trim(), subject: approved.subject, message: approved.message });
    return {
      action: "send_email",
      status: "completed",
      executedAt: new Date().toISOString(),
      provider: result.provider,
      ...(result.externalId ? { externalId: result.externalId } : {}),
    };
  },
};

export const sendWhatsAppSkill: SkillDefinition<SendWhatsAppInput, SalesExecutionRecord, SalesExecutionHarnessContext> = {
  name: SEND_WHATSAPP_SKILL,
  description: "Envia WhatsApp comercial somente após aprovação humana explícita.",
  requiresApproval: true,
  async execute(input, context) {
    const transport = context.context.transports.whatsapp;
    if (!transport) throw new Error("Transport de WhatsApp não configurado.");
    if (!input.to.trim()) throw new Error("Destino de WhatsApp ausente.");
    const approved = approvedMessage(context.context.entry);
    const result = await transport.sendWhatsApp({ to: input.to.trim(), message: approved.message });
    return {
      action: "send_whatsapp",
      status: "completed",
      executedAt: new Date().toISOString(),
      provider: result.provider,
      ...(result.externalId ? { externalId: result.externalId } : {}),
    };
  },
};
