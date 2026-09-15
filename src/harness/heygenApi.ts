/**
 * Cliente REST oficial do HeyGen (`api.heygen.com`) para automação headless.
 * Autenticação por `X-Api-Key`, lida do secret de runtime do workspace —
 * nunca de env global, arquivo ou valor hardcoded. Toda falha (secret
 * ausente, HTTP, rede, timeout, JSON inválido, erro remoto) vira um erro
 * genérico: nunca ecoa corpo de resposta, header ou mensagem de erro
 * original, que poderiam carregar o valor do segredo ou dados sensíveis.
 *
 * Este cliente é só request/response — não faz polling nem espera o vídeo
 * terminar. Quem precisa acompanhar o progresso usa `getStatus` uma vez por
 * vez (ver `src/reels/reconciler.ts`, chamado periodicamente).
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

/**
 * Payload já montado por `src/reels/studioScenes.ts` (`StudioScene[]`) — este
 * cliente não conhece a forma de cada cena, só repassa como está. O contrato
 * de CADA campo dentro de `scenes` vem do schema oficial `CreateVideoFromStudioInput`
 * (confirmado via ferramenta MCP tipada `create_video_from_studio`), não de
 * suposição. O único ponto não confirmado por fonte direta é a convenção de
 * nomes no NÍVEL SUPERIOR deste payload (`aspect_ratio`/`resolution` em
 * snake_case) — inferida do `generate()` abaixo, que já usa essa mesma
 * convenção com sucesso no mesmo endpoint (`POST /v3/videos`).
 */
export interface HeyGenApiStudioInput {
  title: string;
  scenes: unknown[];
  aspectRatio: "9:16" | "16:9";
  resolution?: "4k" | "1080p" | "720p";
}

export type HeyGenApiStatus = "queued" | "rendering" | "completed" | "failed" | "cancelled" | "not_found";

export interface HeyGenApiClientOptions {
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export interface HeyGenApiClient {
  generate(input: HeyGenApiGenerateInput): Promise<{ videoId: string }>;
  generateStudio(input: HeyGenApiStudioInput): Promise<{ videoId: string }>;
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
  cancelled: "cancelled",
};

class HeyGenHttpError extends Error {
  constructor(message: string, readonly httpStatus: number) {
    super(message);
  }
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

    if (!response.ok) throw new HeyGenHttpError(`HeyGen API: resposta HTTP ${response.status}.`, response.status);

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

    async generateStudio(input) {
      if (!Array.isArray(input.scenes) || input.scenes.length === 0) {
        throw new Error("HeyGen API: Studio exige ao menos uma cena.");
      }
      const data = (await authorizedFetch("/v3/videos", {
        method: "POST",
        body: JSON.stringify({
          type: "studio",
          title: input.title,
          scenes: input.scenes,
          aspect_ratio: input.aspectRatio,
          resolution: input.resolution ?? "1080p",
        }),
      })) as { video_id?: unknown };
      if (typeof data?.video_id !== "string" || !data.video_id) {
        throw new Error("HeyGen API: resposta sem video_id.");
      }
      return { videoId: data.video_id };
    },

    async getStatus(videoId) {
      if (!VIDEO_ID_PATTERN.test(videoId)) throw new Error("HeyGen API: videoId inválido.");
      let data: { status?: unknown; video_url?: unknown };
      try {
        data = (await authorizedFetch(`/v3/videos/${videoId}`, { method: "GET" })) as typeof data;
      } catch (err) {
        // 404 é um sinal terminal confirmado pelo HeyGen (job não existe mais)
        // — vira um valor, não uma exceção, pra quem chama poder distinguir
        // isso de um erro transitório (rede, timeout, 5xx) que NUNCA deve ser
        // tratado como falha definitiva.
        if (err instanceof HeyGenHttpError && err.httpStatus === 404) return { status: "not_found" };
        throw err;
      }
      const mapped = typeof data?.status === "string" ? REMOTE_STATUS_MAP[data.status] : undefined;
      if (!mapped) throw new Error("HeyGen API: resposta com status desconhecido.");
      return { status: mapped, videoUrl: typeof data?.video_url === "string" ? data.video_url : undefined };
    },
  };
}
