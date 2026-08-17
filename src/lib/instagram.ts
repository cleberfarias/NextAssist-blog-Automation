// src/lib/instagram.ts
import type { WorkspaceContext } from "../context.js";

const GRAPH = "https://graph.facebook.com";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function graphPost(ctx: WorkspaceContext, path: string, params: Record<string, string>): Promise<any> {
  const accessToken = await ctx.secrets.get(ctx.workspace.id, "IG_ACCESS_TOKEN");
  const apiVersion = ctx.workspace.integrations.instagram?.apiVersion ?? "v21.0";
  const body = new URLSearchParams({ ...params, access_token: accessToken ?? "" });
  const res = await fetch(`${GRAPH}/${apiVersion}/${path}`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`Instagram API (${path}): ${data?.error?.message ?? res.statusText}`);
  return data;
}

async function graphGet(ctx: WorkspaceContext, path: string, fields: string): Promise<any> {
  const accessToken = await ctx.secrets.get(ctx.workspace.id, "IG_ACCESS_TOKEN");
  const apiVersion = ctx.workspace.integrations.instagram?.apiVersion ?? "v21.0";
  const query = new URLSearchParams({ fields, access_token: accessToken ?? "" });
  const res = await fetch(`${GRAPH}/${apiVersion}/${path}?${query}`);
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`Instagram API (${path}): ${data?.error?.message ?? res.statusText}`);
  return data;
}

async function waitForContainer(ctx: WorkspaceContext, containerId: string, maxAttempts: number): Promise<void> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const { status_code: status, status: statusDetail } = await graphGet(ctx, containerId, "status_code,status");
    if (status === "FINISHED") return;
    if (status === "ERROR" || status === "EXPIRED") throw new Error(`container de mídia ficou com status ${status}${statusDetail ? `: ${statusDetail}` : ""}`);
    await sleep(3000);
  }
  throw new Error("container de mídia não ficou pronto a tempo (timeout)");
}

export interface InstagramPostResult { mediaId: string; permalink: string | null; }

export async function publishReelToInstagram(ctx: WorkspaceContext, videoUrl: string, caption: string): Promise<InstagramPostResult> {
  const userId = await ctx.secrets.get(ctx.workspace.id, "IG_USER_ID");
  if (!userId) throw new Error(`Workspace "${ctx.workspace.id}": IG_USER_ID não configurado.`);

  const container = await graphPost(ctx, `${userId}/media`, { media_type: "REELS", video_url: videoUrl, caption });
  const containerId: string = container.id;
  await waitForContainer(ctx, containerId, 100);
  const published = await graphPost(ctx, `${userId}/media_publish`, { creation_id: containerId });
  const mediaId: string = published.id;

  let permalink: string | null = null;
  try {
    const info = await graphGet(ctx, mediaId, "permalink");
    permalink = info.permalink ?? null;
  } catch { /* segue sem o permalink */ }

  return { mediaId, permalink };
}
