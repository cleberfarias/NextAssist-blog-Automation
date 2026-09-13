import { AgentHarnessRuntime } from "./runtime.js";
import type { HeyGenMcpClient } from "./heygenMcp.js";
import type { SkillDefinition } from "./types.js";

export interface HeyGenVideoRequest {
  workspaceId: string;
  prompt: string;
  /** Name provided by the connected MCP server/tool discovery, never assumed. */
  createVideoTool: string;
  toolInput: Record<string, unknown>;
}

export async function runHeyGenVideoWorker(
  runtime: AgentHarnessRuntime,
  client: HeyGenMcpClient,
  request: HeyGenVideoRequest,
): Promise<{ status: "created" | "blocked"; output?: unknown; reason?: string }> {
  if (!client.available) return { status: "blocked", reason: `Sessão HeyGen indisponível: ${client.reason}` };
  const result = await runtime.run({
    workspaceId: request.workspaceId,
    agent: "video-producer",
    goal: request.prompt,
    context: { client },
    allowedSkills: ["heygen.create-video"],
    budget: { maxSteps: 1, maxCostUsd: 0 },
  }, async ({ invoke }) => invoke("heygen.create-video", { request, client }));
  if (result.status !== "completed") return { status: "blocked", reason: result.trace.error };
  return { status: "created", output: result.output };
}

export function createHeyGenCreateVideoSkill(): SkillDefinition<
  { request: HeyGenVideoRequest; client: Extract<HeyGenMcpClient, { available: true }> },
  unknown
> {
  return {
    name: "heygen.create-video",
    description: "Cria um vídeo no HeyGen após aprovação humana.",
    requiresApproval: true,
    async execute({ request, client }) {
      return client.callTool(request.createVideoTool, request.toolInput);
    },
  };
}
