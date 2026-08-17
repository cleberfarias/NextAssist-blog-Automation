// src/lib/veo.ts
import type { WorkspaceContext } from "../context.js";

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";
const GEMINI_VEO_MODEL = "veo-3.1-fast-generate-preview";

interface Operation {
  name: string; done?: boolean; error?: { message: string };
  response?: { generateVideoResponse?: { generatedSamples?: Array<{ video?: { uri?: string } }> } };
}
type GeminiError = Error & { status?: number };

function sleep(ms: number): Promise<void> { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function callGemini(path: string, apiKey: string, body?: unknown): Promise<any> {
  const res = await fetch(`${GEMINI_BASE}/${path}`, {
    method: body ? "POST" : "GET",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const err: GeminiError = new Error(`Gemini API (${path}): ${data?.error?.message ?? res.statusText}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

/** `apiKeyOverride` permite passar a chave de fallback (2ª conta) explicitamente. */
export async function generateVeoReel(ctx: WorkspaceContext, imageBuffer: Buffer, prompt: string, apiKeyOverride?: string): Promise<Buffer> {
  const apiKey = apiKeyOverride ?? (await ctx.secrets.get(ctx.workspace.id, "GEMINI_API_KEY"));
  if (!apiKey) throw new Error(`Workspace "${ctx.workspace.id}": GEMINI_API_KEY não configurada — necessária para gerar vídeo com o Veo.`);

  const operation: Operation = await callGemini(`models/${GEMINI_VEO_MODEL}:predictLongRunning`, apiKey, {
    instances: [{ prompt, image: { bytesBase64Encoded: imageBuffer.toString("base64"), mimeType: "image/jpeg" } }],
    parameters: { aspectRatio: "9:16", resolution: "720p" },
  });

  const maxAttempts = 30;
  let finished: Operation = operation;
  for (let attempt = 0; attempt < maxAttempts && !finished.done; attempt++) {
    await sleep(10_000);
    finished = await callGemini(operation.name, apiKey);
  }
  if (!finished.done) throw new Error("geração de vídeo pelo Veo não terminou a tempo (timeout)");
  if (finished.error) throw new Error(`Veo falhou ao gerar o vídeo: ${finished.error.message}`);

  const videoUri = finished.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri;
  if (!videoUri) throw new Error("Veo terminou mas não retornou um vídeo.");

  const videoRes = await fetch(videoUri, { headers: { "x-goog-api-key": apiKey } });
  if (!videoRes.ok) throw new Error(`Falha ao baixar vídeo do Veo: HTTP ${videoRes.status}`);
  return Buffer.from(await videoRes.arrayBuffer());
}
