import { JWT } from "google-auth-library";
import { config } from "../config.js";

/**
 * Cliente de autenticação Google reaproveitando a MESMA service account já
 * usada para o Firebase Storage (`FIREBASE_SERVICE_ACCOUNT_JSON`). Ela é uma
 * conta de serviço do Google Cloud, então serve também para a Indexing API e
 * a Search Console API — desde que:
 *  - as duas APIs estejam habilitadas no projeto (Cloud Console)
 *  - o e-mail da service account tenha acesso à propriedade no Search Console
 *
 * Escopos usados:
 *  - indexing: publicar notificações de URL na Indexing API
 *  - webmasters: ler métricas/inspeção e reenviar sitemap no Search Console
 */
const SCOPES = [
  "https://www.googleapis.com/auth/indexing",
  "https://www.googleapis.com/auth/webmasters",
];

let client: JWT | null = null;

function getClient(): JWT {
  if (!client) {
    const sa = JSON.parse(config.firebaseServiceAccountJson) as {
      client_email: string;
      private_key: string;
    };
    client = new JWT({
      email: sa.client_email,
      key: sa.private_key,
      scopes: SCOPES,
    });
  }
  return client;
}

/**
 * Faz uma chamada REST autenticada a uma API do Google e devolve o JSON.
 * A `google-auth-library` cuida de obter/renovar o access token.
 */
type HttpMethod = "GET" | "POST" | "PUT" | "DELETE";

export async function googleFetch<T>(
  url: string,
  init: { method?: HttpMethod; body?: unknown } = {},
): Promise<T> {
  const res = await getClient().request<T>({
    url,
    method: init.method ?? "GET",
    data: init.body,
  });
  return res.data;
}
