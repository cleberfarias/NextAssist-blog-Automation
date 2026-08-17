// src/lib/storage.ts
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getStorage } from "firebase-admin/storage";
import type { WorkspaceContext } from "../context.js";

/**
 * Um app nomeado por workspace — o app default do Admin SDK é um singleton do
 * processo inteiro, então no painel (que serve vários workspaces) o workspace B
 * acabaria usando as credenciais/bucket do workspace A.
 */
async function getStorageBucket(ctx: WorkspaceContext) {
  const existing = getApps().find((app) => app.name === ctx.workspace.id);
  if (existing) return getStorage(existing).bucket();

  const serviceAccountJson = await ctx.secrets.get(ctx.workspace.id, "FIREBASE_SERVICE_ACCOUNT_JSON");
  const storageBucket = await ctx.secrets.get(ctx.workspace.id, "FIREBASE_STORAGE_BUCKET");
  if (!serviceAccountJson || !storageBucket) {
    throw new Error(`Workspace "${ctx.workspace.id}": FIREBASE_SERVICE_ACCOUNT_JSON / FIREBASE_STORAGE_BUCKET ausentes.`);
  }
  const app = initializeApp({ credential: cert(JSON.parse(serviceAccountJson)), storageBucket }, ctx.workspace.id);
  return getStorage(app).bucket();
}

export async function writeStateJson(ctx: WorkspaceContext, fileName: string, value: unknown): Promise<void> {
  const file = (await getStorageBucket(ctx)).file(`panel-state/${ctx.workspace.id}/${fileName}`);
  await file.save(JSON.stringify(value, null, 2) + "\n", {
    resumable: false,
    metadata: { contentType: "application/json; charset=utf-8", cacheControl: "no-store" },
  });
}

export async function readStoredStateJson<T>(ctx: WorkspaceContext, fileName: string, fallback: T): Promise<T> {
  try {
    const [contents] = await (await getStorageBucket(ctx)).file(`panel-state/${ctx.workspace.id}/${fileName}`).download();
    return JSON.parse(contents.toString("utf-8")) as T;
  } catch (err) {
    const code = (err as { code?: number | string })?.code;
    if (code === 404 || code === "404") return fallback;
    throw err;
  }
}

export async function uploadCoverImage(ctx: WorkspaceContext, imageBuffer: Buffer, slug: string): Promise<string> {
  const bucket = await getStorageBucket(ctx);
  const filePath = `blog-covers/${ctx.workspace.id}/${slug}-${Date.now()}.jpg`;
  const file = bucket.file(filePath);
  await file.save(imageBuffer, { metadata: { contentType: "image/jpeg" } });
  const [url] = await file.getSignedUrl({ action: "read", expires: "01-01-2100" });
  return url;
}

export async function uploadReelVideo(ctx: WorkspaceContext, videoBuffer: Buffer, slug: string): Promise<string> {
  const bucket = await getStorageBucket(ctx);
  const filePath = `blog-covers/${ctx.workspace.id}/${slug}-${Date.now()}-reel.mp4`;
  const file = bucket.file(filePath);
  await file.save(videoBuffer, { metadata: { contentType: "video/mp4" } });
  const [url] = await file.getSignedUrl({ action: "read", expires: "01-01-2100" });
  return url;
}
