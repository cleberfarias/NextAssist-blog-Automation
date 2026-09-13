import type { WorkspaceContext } from "../context.js";

export const HEYGEN_API_BASE = "https://api.heygen.com/v3";

export async function getHeygenApiKey(ctx: WorkspaceContext): Promise<string> {
  const apiKey = await ctx.secrets.get(ctx.workspace.id, "HEYGEN_API_KEY");
  if (!apiKey) throw new Error("HEYGEN_API_KEY não configurada para o workspace.");
  return apiKey;
}
