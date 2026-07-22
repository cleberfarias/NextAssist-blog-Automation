import { config } from "../config.js";

/**
 * Faz login com email/senha via API REST do Identity Toolkit —
 * o mesmo mecanismo usado por signInWithEmailAndPassword() no painel admin.
 * Retorna o idToken para usar como "Authorization: Bearer <idToken>".
 */
export async function getBlogAdminIdToken(): Promise<string> {
  const url = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${config.firebaseWebApiKey}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: config.firebaseAdminEmail,
      password: config.firebaseAdminPassword,
      returnSecureToken: true,
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => null);
    throw new Error(
      `Falha no login do Firebase Auth: ${err?.error?.message ?? res.statusText}`,
    );
  }

  const data = (await res.json()) as { idToken: string };
  return data.idToken;
}
