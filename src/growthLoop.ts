import { readFile, writeFile } from "node:fs/promises";
import { config } from "./config.js";
import type { WorkspaceContext } from "./context.js";
import { readStoredStateJson, writeStateJson } from "./lib/storage.js";
import type { RevenueDecision, RevenueSnapshot } from "./revenue/types.js";
import type { BacklogResult } from "./backlog.js";

const GROWTH_LOOP_STATE_FILE = "growth-loop-state.json";

export type GrowthLoopOutcome =
  | ({ type: "marketing" } & BacklogResult)
  | { type: "marketing_skipped"; reason: string }
  | { type: "sales"; leadsAssessed: number; outreachCreated: number; outreachReused: number }
  | { type: "no_owner"; note: string }
  | { type: "no_action" };

export interface GrowthLoopState {
  runId: string;
  startedAt: string;
  completedAt: string;
  updatedAt: string;
  snapshot: RevenueSnapshot;
  decision: RevenueDecision;
  outcome: GrowthLoopOutcome;
}

function localFile(ctx: WorkspaceContext): URL {
  return new URL(GROWTH_LOOP_STATE_FILE, ctx.paths.root);
}

export async function saveGrowthLoopState(ctx: WorkspaceContext, state: GrowthLoopState): Promise<void> {
  if (config.dataSource === "github") {
    await writeStateJson(ctx, GROWTH_LOOP_STATE_FILE, state);
    return;
  }
  await writeFile(localFile(ctx), `${JSON.stringify(state, null, 2)}\n`);
}

export async function getGrowthLoopState(ctx: WorkspaceContext): Promise<GrowthLoopState | null> {
  try {
    if (config.dataSource === "github") {
      return await readStoredStateJson<GrowthLoopState | null>(ctx, GROWTH_LOOP_STATE_FILE, null);
    }
    return JSON.parse(await readFile(localFile(ctx), "utf-8")) as GrowthLoopState;
  } catch {
    return null;
  }
}
