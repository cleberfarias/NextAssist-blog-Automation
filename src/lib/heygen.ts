import type { WorkspaceContext } from "../context.js";

const HEYGEN_BASE = "https://api.heygen.com";

interface HeyGenCreateResponse {
  data?: { id?: string };
  error?: { message?: string };
}

interface HeyGenVideoResponse {
  data?: {
    id?: string;
    status?: "pending" | "processing" | "completed" | "failed";
    video_url?: string;
    failure_message?: string;
  };
  error?: { message?: string };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function heygenRequest<T>(path: string, apiKey: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${HEYGEN_BASE}${path}`, {
    ...init,
    headers: {
      "x-api-key": apiKey,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const data = (await res.json().catch(() => null)) as T | null;
  if (!res.ok) {
    const message = (data as { error?: { message?: string } } | null)?.error?.message ?? res.statusText;
    throw new Error(`HeyGen API (${path}): ${message}`);
  }
  if (!data) throw new Error(`HeyGen API (${path}) retornou resposta vazia.`);
  return data;
}

export async function hasHeyGenConfig(ctx: WorkspaceContext): Promise<boolean> {
  const [apiKey, avatarId, voiceId] = await Promise.all([
    ctx.secrets.get(ctx.workspace.id, "HEYGEN_API_KEY"),
    ctx.secrets.get(ctx.workspace.id, "HEYGEN_AVATAR_ID"),
    ctx.secrets.get(ctx.workspace.id, "HEYGEN_VOICE_ID"),
  ]);
  return Boolean(apiKey && avatarId && voiceId);
}

export async function generateHeyGenAvatarReel(
  ctx: WorkspaceContext,
  script: string,
  title: string,
): Promise<Buffer> {
  const [apiKey, avatarId, voiceId] = await Promise.all([
    ctx.secrets.get(ctx.workspace.id, "HEYGEN_API_KEY"),
    ctx.secrets.get(ctx.workspace.id, "HEYGEN_AVATAR_ID"),
    ctx.secrets.get(ctx.workspace.id, "HEYGEN_VOICE_ID"),
  ]);

  if (!apiKey || !avatarId || !voiceId) {
    throw new Error(
      `Workspace "${ctx.workspace.id}": HEYGEN_API_KEY / HEYGEN_AVATAR_ID / HEYGEN_VOICE_ID não configurados.`,
    );
  }

  const created = await heygenRequest<HeyGenCreateResponse>("/v3/videos", apiKey, {
    method: "POST",
    body: JSON.stringify({
      type: "avatar",
      avatar_id: avatarId,
      voice_id: voiceId,
      script,
      title,
      resolution: "1080p",
      aspect_ratio: "9:16",
      engine: { type: "avatar_iv" },
      expressiveness: "medium",
      motion_prompt: "Natural creator-style delivery for a social media Reel. Friendly eye contact, subtle hand gestures, confident but conversational pacing.",
      voice_settings: {
        speed: 1.04,
        pitch: 0,
        locale: "pt-BR",
      },
    }),
  });

  const videoId = created.data?.id;
  if (!videoId) throw new Error("HeyGen não retornou o id do vídeo.");

  for (let attempt = 0; attempt < 60; attempt++) {
    const status = await heygenRequest<HeyGenVideoResponse>(`/v3/videos/${videoId}`, apiKey);
    const video = status.data;
    if (video?.status === "completed" && video.video_url) {
      const videoRes = await fetch(video.video_url);
      if (!videoRes.ok) throw new Error(`Falha ao baixar vídeo do HeyGen: HTTP ${videoRes.status}`);
      return Buffer.from(await videoRes.arrayBuffer());
    }
    if (video?.status === "failed") {
      throw new Error(`HeyGen falhou ao gerar o vídeo: ${video.failure_message ?? "sem detalhe"}`);
    }
    await sleep(5_000);
  }

  throw new Error("HeyGen não terminou a geração do Reel dentro do tempo limite.");
}
