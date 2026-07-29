import { config } from "../config.js";

/**
 * Publica uma única imagem no feed do Instagram via Graph API da Meta.
 *
 * A publicação é feita em dois passos (exigência da API):
 *  1. cria um "container" de mídia a partir de `imageUrl` (que precisa ser uma
 *     URL pública em JPEG) + legenda;
 *  2. publica o container.
 *
 * Entre os dois, esperamos o container ficar pronto (`status_code=FINISHED`);
 * para imagens isso costuma ser quase imediato, mas a API pode responder
 * `IN_PROGRESS` por alguns segundos.
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
async function waitForContainer(containerId: string): Promise<void> {
  // ~30s no total: imagens costumam ficar prontas em 1-2 tentativas.
  const maxAttempts = 10;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const { status_code: status } = await graphGet(containerId, "status_code");
    if (status === "FINISHED") return;
    if (status === "ERROR" || status === "EXPIRED") {
      throw new Error(`container de mídia ficou com status ${status}`);
    }
    await sleep(3000);
  }
  throw new Error("container de mídia não ficou pronto a tempo (timeout)");
}

export interface InstagramPostResult {
  mediaId: string;
  permalink: string | null;
}

export async function publishImageToInstagram(
  imageUrl: string,
  caption: string,
): Promise<InstagramPostResult> {
  const userId = config.instagram.userId;

  // 1. Cria o container.
  const container = await graphPost(`${userId}/media`, {
    image_url: imageUrl,
    caption,
  });
  const containerId: string = container.id;

  // 2. Espera ficar pronto.
  await waitForContainer(containerId);

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
