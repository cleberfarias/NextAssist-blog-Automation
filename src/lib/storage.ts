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
