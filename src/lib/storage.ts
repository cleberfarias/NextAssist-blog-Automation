import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getStorage } from "firebase-admin/storage";
import { config } from "../config.js";

function getStorageBucket() {
  if (getApps().length === 0) {
    const serviceAccount = JSON.parse(config.firebaseServiceAccountJson);
    initializeApp({
      credential: cert(serviceAccount),
      storageBucket: config.firebaseStorageBucket,
    });
  }
  return getStorage().bucket();
}

/**
 * Grava estado JSON durável no bucket. É usado pelo painel hospedado porque
 * o sistema de arquivos do Cloud Run é descartado quando a instância encerra.
 */
export async function writeStateJson(
  fileName: string,
  value: unknown,
): Promise<void> {
  const file = getStorageBucket().file(`panel-state/${fileName}`);
  await file.save(JSON.stringify(value, null, 2) + "\n", {
    resumable: false,
    metadata: {
      contentType: "application/json; charset=utf-8",
      cacheControl: "no-store",
    },
  });
}

/** Lê um estado JSON persistido no bucket, ou devolve o fallback se não existir. */
export async function readStoredStateJson<T>(
  fileName: string,
  fallback: T,
): Promise<T> {
  try {
    const [contents] = await getStorageBucket()
      .file(`panel-state/${fileName}`)
      .download();
    return JSON.parse(contents.toString("utf-8")) as T;
  } catch (err) {
    const code = (err as { code?: number | string })?.code;
    if (code === 404 || code === "404") return fallback;
    throw err;
  }
}

/**
 * Envia os bytes de uma imagem para o Firebase Storage e devolve uma URL
 * pública de longa duração para usar em `imagemCapa`.
 */
export async function uploadCoverImage(
  imageBuffer: Buffer,
  slug: string,
): Promise<string> {
  const bucket = getStorageBucket();
  const filePath = `blog-covers/${slug}-${Date.now()}.png`;
  const file = bucket.file(filePath);

  await file.save(imageBuffer, {
    metadata: { contentType: "image/png" },
  });

  // Token de acesso longo em vez de ACL pública — evita depender de
  // regras de storage abertas.
  const [url] = await file.getSignedUrl({
    action: "read",
    expires: "01-01-2100",
  });

  return url;
}
