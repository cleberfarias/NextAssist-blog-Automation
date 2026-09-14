/**
 * Cliente REST oficial do HeyGen (`api.heygen.com`) para automação headless.
 * Autenticação por `X-Api-Key`, lida do secret de runtime do workspace —
 * nunca de env global, arquivo ou valor hardcoded. Toda falha (secret
 * ausente, HTTP, rede, timeout, JSON inválido, erro remoto) vira um erro
 * genérico: nunca ecoa corpo de resposta, header ou mensagem de erro
 * original, que poderiam carregar o valor do segredo ou dados sensíveis.
 */

export interface HeyGenApiSecrets {
  get(workspaceId: string, key: string): Promise<string | undefined>;
}

export interface HeyGenApiGenerateInput {
  title: string;
  script: string;
  avatarId: string;
  voiceId: string;
  aspectRatio: "9:16" | "16:9";
}

export type HeyGenApiStatus = "queued" | "rendering" | "completed" | "failed";

export interface HeyGenApiClientOptions {
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export interface HeyGenApiClient {
  generate(input: HeyGenApiGenerateInput): Promise<{ videoId: string }>;
  getStatus(videoId: string): Promise<{ status: HeyGenApiStatus; videoUrl?: string }>;
}

const HEYGEN_API_BASE = "https://api.heygen.com";
const DEFAULT_TIMEOUT_MS = 30_000;
const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

const REMOTE_STATUS_MAP: Record<string, HeyGenApiStatus> = {
  waiting: "queued",
  pending: "queued",
  processing: "rendering",
  completed: "completed",
  failed: "failed",
};

export interface HeyGenApiPollOptions {
  pollIntervalMs?: number;
  maxAttempts?: number;
  sleep?: (ms: number) => Promise<void>;
}

const DEFAULT_POLL_INTERVAL_MS = 4000;
const DEFAULT_MAX_POLL_ATTEMPTS = 45; // ~3 minutos com o intervalo padrão

/** Espera a renderização terminar sem expor status/erro remoto além do necessário. */
export async function pollHeyGenApiVideo(
  client: HeyGenApiClient,
  videoId: string,
  options: HeyGenApiPollOptions = {},
): Promise<{ videoUrl: string }> {
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_POLL_ATTEMPTS;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const result = await client.getStatus(videoId);
    if (result.status === "completed") {
      if (!result.videoUrl) throw new Error("HeyGen API: renderização concluída sem videoUrl.");
      return { videoUrl: result.videoUrl };
    }
    if (result.status === "failed") throw new Error("HeyGen API: renderização falhou.");
    await sleep(pollIntervalMs);
  }
  throw new Error(`HeyGen API: renderização não concluiu após ${maxAttempts} tentativas.`);
}

export function createHeyGenApiClient(
  ctx: { secrets: HeyGenApiSecrets },
  workspaceId: string,
  options: HeyGenApiClientOptions = {},
): HeyGenApiClient {
  const doFetch = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  async function authorizedFetch(path: string, init: RequestInit): Promise<unknown> {
    const apiKey = await ctx.secrets.get(workspaceId, "HEYGEN_API_KEY");
    if (!apiKey) throw new Error("HeyGen API: HEYGEN_API_KEY ausente para este workspace.");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await doFetch(`${HEYGEN_API_BASE}${path}`, {
        ...init,
        redirect: "error",
        signal: controller.signal,
        headers: { ...(init.headers ?? {}), "X-Api-Key": apiKey, "Content-Type": "application/json" },
      });
    } catch {
      if (controller.signal.aborted) throw new Error(`HeyGen API: timeout após ${timeoutMs}ms.`);
      throw new Error("HeyGen API: falha de rede ao chamar a API.");
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) throw new Error(`HeyGen API: resposta HTTP ${response.status}.`);

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new Error("HeyGen API: resposta inválida (JSON malformado).");
    }

    const record = body as { data?: unknown; error?: unknown };
    if (record?.error) throw new Error("HeyGen API: a API retornou um erro.");
    return record?.data;
  }

  return {
    async generate(input) {
      if (!input.script?.trim()) throw new Error("HeyGen API: script vazio.");
      const data = (await authorizedFetch("/v3/videos", {
        method: "POST",
        body: JSON.stringify({
          type: "avatar",
          title: input.title,
          script: input.script,
          avatar_id: input.avatarId,
          voice_id: input.voiceId,
          aspect_ratio: input.aspectRatio,
          output_format: "mp4",
        }),
      })) as { video_id?: unknown };
      if (typeof data?.video_id !== "string" || !data.video_id) {
        throw new Error("HeyGen API: resposta sem video_id.");
      }
      return { videoId: data.video_id };
    },

    async getStatus(videoId) {
      if (!VIDEO_ID_PATTERN.test(videoId)) throw new Error("HeyGen API: videoId inválido.");
      const data = (await authorizedFetch(`/v3/videos/${videoId}`, { method: "GET" })) as {
        status?: unknown;
        video_url?: unknown;
      };
      const mapped = typeof data?.status === "string" ? REMOTE_STATUS_MAP[data.status] : undefined;
      if (!mapped) throw new Error("HeyGen API: resposta com status desconhecido.");
      return { status: mapped, videoUrl: typeof data?.video_url === "string" ? data.video_url : undefined };
    },
  };
}
