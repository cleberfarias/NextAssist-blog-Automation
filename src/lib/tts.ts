// src/lib/tts.ts
import OpenAI from "openai";
import type { WorkspaceContext } from "../context.js";

export async function generateNarration(ctx: WorkspaceContext, text: string): Promise<Buffer> {
  const apiKey = await ctx.secrets.get(ctx.workspace.id, "OPENAI_API_KEY");
  if (!apiKey) throw new Error(`Workspace "${ctx.workspace.id}": OPENAI_API_KEY não configurada — necessária para gerar a narração do Reel.`);

  const openai = new OpenAI({ apiKey });
  const response = await openai.audio.speech.create({
    model: "gpt-4o-mini-tts", voice: "nova", input: text,
    instructions: "Fale em português do Brasil, tom animado e natural, ritmo rápido.",
    response_format: "mp3",
  });
  return Buffer.from(await response.arrayBuffer());
}
