import { readFile, writeFile } from "node:fs/promises";
import { config } from "../config.js";
import type { WorkspaceContext } from "../context.js";
import { readStoredStateJson, writeStateJson } from "../lib/storage.js";
import type { SalesPipelineEntry } from "./types.js";

const SALES_STATE_FILE = "sales-state.json";

export interface SalesStateReport {
  updatedAt: string;
  entries: SalesPipelineEntry[];
}

function localFile(ctx: WorkspaceContext): URL {
  return new URL(SALES_STATE_FILE, ctx.paths.root);
}

export async function saveSalesState(
  ctx: WorkspaceContext,
  entries: SalesPipelineEntry[],
): Promise<SalesStateReport> {
  const report: SalesStateReport = {
    updatedAt: new Date().toISOString(),
    entries,
  };

  if (config.dataSource === "github") {
    await writeStateJson(ctx, SALES_STATE_FILE, report);
  } else {
    await writeFile(localFile(ctx), `${JSON.stringify(report, null, 2)}\n`);
  }

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
