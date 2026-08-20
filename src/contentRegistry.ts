// src/contentRegistry.ts
import { readFile, writeFile } from "node:fs/promises";
import { readStateJson } from "./lib/dataSource.js";
import type { WorkspaceContext } from "./context.js";

export interface ContentRegistryEntry {
  /** = slug. Contrato explícito — precisa ser globalmente único entre canais (limitação conhecida do P0). */
  contentId: string;
  /** Agrupamento temático opcional. Sempre `null` no P0 — atribuição real de campanha é P1. */
  campaignId: string | null;
  tema: string;
  formato: "blog" | "instagram-reel";
  channel: "blog" | "instagram";
  funnelStage: "topo" | "meio" | "fundo";
  publicadoEm: string;
  status: "published" | "draft-pending-approval";
  url: string;
}

async function loadRegistry(ctx: WorkspaceContext): Promise<ContentRegistryEntry[]> {
  try {
    const raw = await readFile(ctx.paths.contentRegistry, "utf-8");
    return JSON.parse(raw) as ContentRegistryEntry[];
  } catch {
    return [];
  }
}

/**
 * Upsert por `contentId` — idempotente a reexecuções do pipeline (retry,
 * falha pós-publicação, etc.). Único writer nesta camada: `pipeline.ts`,
 * chamado logo após `publishPost` — nenhum outro módulo deve escrever aqui.
 */
export async function registerContent(ctx: WorkspaceContext, entry: ContentRegistryEntry): Promise<void> {
  const registry = await loadRegistry(ctx);
  const next = [...registry.filter((e) => e.contentId !== entry.contentId), entry];
  await writeFile(ctx.paths.contentRegistry, JSON.stringify(next, null, 2) + "\n");
}

/** Lê o registro para exibição/atribuição. Usa a fonte configurada (local ou GitHub), igual a `getHistory`. */
export async function getContentRegistry(ctx: WorkspaceContext): Promise<ContentRegistryEntry[]> {
  return readStateJson<ContentRegistryEntry[]>(ctx.paths.contentRegistry, [], ctx.workspace.id);
}
