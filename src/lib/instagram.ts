import { config } from "../config.js";

/**
 * Publica mídia no Instagram via Graph API da Meta (fluxo de container em
 * dois passos: cria a mídia a partir de uma URL pública + legenda, depois
 * publica o container depois que ele fica pronto).
 */

const GRAPH = "https://graph.facebook.com";

function base(): string {
  return `${GRAPH}/${config.instagram.apiVersion}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function graphPost(path: string, params: Record<string, string>): Promise<any> {
  const body = new URLSearchParams({
    ...params,
    access_token: config.instagram.accessToken,
  });
  const res = await fetch(`${base()}/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = data?.error?.message ?? res.statusText;
    throw new Error(`Instagram API (${path}): ${msg}`);
  }
  return data;
}

async function graphGet(path: string, fields: string): Promise<any> {
  const query = new URLSearchParams({
    fields,
    access_token: config.instagram.accessToken,
  });
  const res = await fetch(`${base()}/${path}?${query}`);
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = data?.error?.message ?? res.statusText;
    throw new Error(`Instagram API (${path}): ${msg}`);
  }
  return data;
}

/** Espera o container de mídia ficar pronto antes de publicar. */
async function waitForContainer(containerId: string, maxAttempts: number): Promise<void> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const { status_code: status, status: statusDetail } = await graphGet(
      containerId,
      "status_code,status",
    );
    if (status === "FINISHED") return;
    if (status === "ERROR" || status === "EXPIRED") {
      throw new Error(
        `container de mídia ficou com status ${status}${statusDetail ? `: ${statusDetail}` : ""}`,
      );
    }
    await sleep(3000);
  }
  throw new Error("container de mídia não ficou pronto a tempo (timeout)");
}

export interface InstagramPostResult {
  mediaId: string;
  permalink: string | null;
}

/**
 * Publica um Reel no Instagram via Graph API da Meta.
 *
 * Mesmo fluxo de dois passos da imagem, mas com `media_type=REELS` e
 * `video_url`. O processamento de vídeo demora bem mais que o de imagem —
 * por isso o timeout de espera do container é maior.
 */
export async function publishReelToInstagram(
  videoUrl: string,
  caption: string,
): Promise<InstagramPostResult> {
  const userId = config.instagram.userId;

  // 1. Cria o container do Reel.
  const container = await graphPost(`${userId}/media`, {
    media_type: "REELS",
    video_url: videoUrl,
    caption,
  });
  const containerId: string = container.id;

  // 2. Espera ficar pronto (~5min no total: processamento de vídeo é mais lento).
  await waitForContainer(containerId, 100);

  // 3. Publica.
  const published = await graphPost(`${userId}/media_publish`, {
    creation_id: containerId,
  });
  const mediaId: string = published.id;

  // 4. Busca o permalink (melhor esforço — não é crítico).
  let permalink: string | null = null;
  try {
    const info = await graphGet(mediaId, "permalink");
    permalink = info.permalink ?? null;
  } catch {
    // segue sem o permalink
  }

  return { mediaId, permalink };
}
