// src/lib/imageGen.ts
import type { WorkspaceContext } from "../context.js";

export async function generateCoverImage(ctx: WorkspaceContext, prompt: string): Promise<Buffer> {
  const apiKey = await ctx.secrets.get(ctx.workspace.id, "OPENAI_API_KEY");
  if (!apiKey) throw new Error(`Workspace "${ctx.workspace.id}": OPENAI_API_KEY não configurada — necessária para gerar a imagem de capa.`);

  const res = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: "gpt-image-1", prompt, size: "1536x1024",
      output_format: "jpeg", output_compression: 90, n: 1,
    }),
  });
  if (!res.ok) throw new Error(`Falha ao gerar imagem de capa: ${await res.text()}`);
  const data = (await res.json()) as { data: { b64_json: string }[] };
  return Buffer.from(data.data[0].b64_json, "base64");
}
