import { readFile, writeFile } from "node:fs/promises";
import { config } from "../config.js";
import type { WorkspaceContext } from "../context.js";
import { readStoredStateJson, writeStateJson } from "../lib/storage.js";
import type { SalesExecutionRecord, SalesHumanReview, SalesPipelineEntry, SalesReviewStatus } from "./types.js";

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
  const previousByLead = new Map((previous?.entries ?? []).map((entry) => [entry.lead.leadId, entry] as const));

  const merged = entries.map((entry) => {
    const old = previousByLead.get(entry.lead.leadId);
    // Reatacha a review recém-lida do disco (não a que o loop tinha em
    // memória desde o início do run) SOMENTE quando o rascunho ao qual ela
    // pertence é o mesmo: assim uma aprovação/edição humana concorrente,
    // feita enquanto o loop ainda rodava, não é sobrescrita pelo snapshot
    // antigo do loop. Se o rascunho mudou (recomposição — caso da Task 6),
    // a review antiga continua descartada de propósito.
    const sameDraft = Boolean(old?.outreach && entry.outreach && old.outreach.message === entry.outreach.message);
    return {
      ...entry,
      ...(sameDraft && old?.review ? { review: old.review } : {}),
      ...(old?.executions?.length ? { executions: old.executions } : {}),
    };
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

/**
 * Como `getSalesState`, mas NÃO trata qualquer erro de leitura como "nenhum
 * estado existe ainda". Uma falha transiente de leitura (permissão, JSON
 * corrompido, etc.) não é o mesmo que "arquivo nunca foi criado" — tratar as
 * duas coisas como iguais faria o pipeline comercial recompor/sobrescrever
 * rascunhos pendentes de revisão humana como se nada existisse. Usado
 * apenas por `runWorkspaceSalesCopilot` para decidir dedup; os demais
 * chamadores de `getSalesState` (revisão humana, registro de execução, rota
 * `GET /api/sales`) continuam com o comportamento antigo — não é o objetivo
 * desta função mudar isso.
 */
export async function getSalesStateStrict(ctx: WorkspaceContext): Promise<SalesStateReport | null> {
  if (config.dataSource === "github") {
    return await readStoredStateJson<SalesStateReport | null>(ctx, SALES_STATE_FILE, null);
  }
  try {
    return JSON.parse(await readFile(localFile(ctx), "utf-8")) as SalesStateReport;
  } catch (err) {
    if ((err as { code?: string })?.code === "ENOENT") return null;
    throw err;
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

export async function recordSalesExecution(
  ctx: WorkspaceContext,
  leadId: string,
  execution: SalesExecutionRecord,
): Promise<SalesPipelineEntry> {
  const report = await getSalesState(ctx);
  if (!report) throw new Error("Estado comercial ainda não foi gerado para este workspace.");
  const index = report.entries.findIndex((entry) => entry.lead.leadId === leadId);
  if (index < 0) throw new Error("Lead não encontrado no estado comercial.");

  const entry = report.entries[index]!;
  const updatedEntry: SalesPipelineEntry = {
    ...entry,
    executions: [...(entry.executions ?? []), execution].slice(-20),
  };
  const entries = [...report.entries];
  entries[index] = updatedEntry;
  await persist(ctx, { updatedAt: new Date().toISOString(), entries });
  return updatedEntry;
}
