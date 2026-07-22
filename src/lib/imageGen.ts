import { config } from "../config.js";

/**
 * Gera uma imagem de capa a partir de um prompt e devolve os bytes (PNG).
 * Implementado para o provider "openai" (gpt-image-1). Para trocar de
 * provider, adicione um novo `case` aqui — o restante do pipeline não muda.
 */
export async function generateCoverImage(prompt: string): Promise<Buffer> {
  if (!config.imageGenApiKey) {
    throw new Error(
      "IMAGE_GEN_API_KEY não configurada — necessária para gerar a imagem de capa.",
    );
  }

  switch (config.imageGenProvider) {
    case "openai":
      return generateWithOpenAi(prompt);
    default:
      throw new Error(
        `Provider de imagem "${config.imageGenProvider}" não implementado.`,
      );
  }
}

async function generateWithOpenAi(prompt: string): Promise<Buffer> {
  const res = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.imageGenApiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-image-1",
      prompt,
      size: "1536x1024",
      n: 1,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Falha ao gerar imagem de capa: ${err}`);
  }

  const data = (await res.json()) as { data: { b64_json: string }[] };
  return Buffer.from(data.data[0].b64_json, "base64");
}
