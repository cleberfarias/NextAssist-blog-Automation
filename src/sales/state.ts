import { readFile, writeFile } from "node:fs/promises";
import { config } from "../config.js";
import type { WorkspaceContext } from "../context.js";
import { readStoredStateJson, writeStateJson } from "../lib/storage.js";
import type { SalesHumanReview, SalesPipelineEntry, SalesReviewStatus } from "./types.js";

const SALES_STATE_FILE = "sales-state.json";

export interface SalesStateReport {
  updatedAt: string;
  entries: SalesPipelineEntry[];
}

function localFile(ctx: WorkspaceContext): URL {
  return new URL(SALES_STATE_FILE, ctx.paths.root);
}

async function persist(ctx: WorkspaceContext, report: SalesStateReport): Promise<void> {
  if (config.dataSource === "github") {
    await writeStateJson(ctx, SALES_STATE_FILE, report);
  } else {
    await writeFile(localFile(ctx), `${JSON.stringify(report, null, 2)}\n`);
  }
}

export async function saveSalesState(
  ctx: WorkspaceContext,
  entries: SalesPipelineEntry[],
): Promise<SalesStateReport> {
  const previous = await getSalesState(ctx);
  const reviewByLead = new Map(
    (previous?.entries ?? [])
      .filter((entry) => entry.review)
      .map((entry) => [entry.lead.leadId, entry.review!] as const),
  );

  const merged = entries.map((entry) => {
    const review = reviewByLead.get(entry.lead.leadId);
    return review ? { ...entry, review } : entry;
  });

  const report: SalesStateReport = {
    updatedAt: new Date().toISOString(),
    entries: merged,
  };
  await persist(ctx, report);
  return report;
}

export async function getSalesState(ctx: WorkspaceContext): Promise<SalesStateReport | null> {
  try {
    if (config.dataSource === "github") {
      return await readStoredStateJson<SalesStateReport | null>(ctx, SALES_STATE_FILE, null);
    }
    return JSON.parse(await readFile(localFile(ctx), "utf-8")) as SalesStateReport;
  } catch {
    return null;
  }
}

export async function reviewSalesDraft(
  ctx: WorkspaceContext,
  input: {
    leadId: string;
    status: SalesReviewStatus;
    message?: string;
    subject?: string;
  },
): Promise<SalesPipelineEntry> {
  const report = await getSalesState(ctx);
  if (!report) throw new Error("Estado comercial ainda não foi gerado para este workspace.");

  const index = report.entries.findIndex((entry) => entry.lead.leadId === input.leadId);
  if (index < 0) throw new Error("Lead não encontrado no estado comercial.");

  const entry = report.entries[index]!;
  if (!entry.outreach) throw new Error("Este lead não possui rascunho de abordagem.");

  const message = (input.message ?? entry.review?.message ?? entry.outreach.message).trim();
  if (!message) throw new Error("A mensagem não pode ficar vazia.");

  const review: SalesHumanReview = {
    status: input.status,
    message,
    ...(input.subject !== undefined
      ? { subject: input.subject.trim() || undefined }
      : entry.review?.subject !== undefined
        ? { subject: entry.review.subject }
        : entry.outreach.subject
          ? { subject: entry.outreach.subject }
          : {}),
    updatedAt: new Date().toISOString(),
  };

  const updatedEntry: SalesPipelineEntry = { ...entry, review };
  const entries = [...report.entries];
  entries[index] = updatedEntry;
  await persist(ctx, { updatedAt: new Date().toISOString(), entries });
  return updatedEntry;
}
