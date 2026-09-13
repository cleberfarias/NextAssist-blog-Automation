import type { WorkspaceContext } from "../context.js";

export function getHeygenVideoStrategy(ctx: WorkspaceContext) {
  const strategy = ctx.workspace.videoStrategy;
  if (!strategy || strategy.provider !== "heygen") {
    throw new Error(`Workspace "${ctx.workspace.id}": videoStrategy HeyGen não configurada.`);
  }
  return { ...strategy };
}
