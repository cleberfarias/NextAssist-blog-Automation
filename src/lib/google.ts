// src/lib/google.ts
import { JWT } from "google-auth-library";
import type { WorkspaceContext } from "../context.js";

const SCOPES = [
  "https://www.googleapis.com/auth/indexing",
  "https://www.googleapis.com/auth/webmasters",
];

const clients = new WeakMap<WorkspaceContext, JWT>();

async function getClient(ctx: WorkspaceContext): Promise<JWT> {
  let client = clients.get(ctx);
  if (!client) {
    const serviceAccountJson = await ctx.secrets.get(ctx.workspace.id, "FIREBASE_SERVICE_ACCOUNT_JSON");
    if (!serviceAccountJson) throw new Error(`Workspace "${ctx.workspace.id}": FIREBASE_SERVICE_ACCOUNT_JSON ausente.`);
    const sa = JSON.parse(serviceAccountJson) as { client_email: string; private_key: string };
    client = new JWT({ email: sa.client_email, key: sa.private_key, scopes: SCOPES });
    clients.set(ctx, client);
  }
  return client;
}

type HttpMethod = "GET" | "POST" | "PUT" | "DELETE";

export async function googleFetch<T>(
  ctx: WorkspaceContext,
  url: string,
  init: { method?: HttpMethod; body?: unknown } = {},
): Promise<T> {
  const client = await getClient(ctx);
  const res = await client.request<T>({ url, method: init.method ?? "GET", data: init.body });
  return res.data;
}
