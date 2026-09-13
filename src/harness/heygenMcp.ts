/**
 * Boundary for a HeyGen MCP client. OAuth is completed by a supported MCP
 * host (Codex, Claude Code, or a future Cloud Run sidecar), never by this
 * worker. This avoids guessing HeyGen authorization endpoints or persisting
 * credentials in the repository.
 */
export interface HeyGenOAuthSession {
  accessToken: string;
  expiresAt?: string;
  refreshToken?: string;
  scope?: string;
}

export interface HeyGenOAuthSessionStore {
  read(workspaceId: string): Promise<HeyGenOAuthSession | undefined>;
  write?(workspaceId: string, session: HeyGenOAuthSession): Promise<void>;
  remove?(workspaceId: string): Promise<void>;
}

export interface HeyGenMcpConnection {
  callTool(name: string, input: unknown): Promise<unknown>;
}

export interface HeyGenMcpConnector {
  connect(input: {
    endpoint: string;
    session: HeyGenOAuthSession;
    onSessionUpdated?: (session: HeyGenOAuthSession) => Promise<void>;
  }): Promise<HeyGenMcpConnection>;
}

export interface ConfigureHeyGenMcpClientOptions {
  workspaceId: string;
  sessionStore: HeyGenOAuthSessionStore;
  connector: HeyGenMcpConnector;
  endpoint?: string;
}

export type HeyGenMcpClient =
  | { available: true; callTool(name: string, input: unknown): Promise<unknown> }
  | { available: false; reason: "missing-session" | "expired-session" };

const DEFAULT_HEYGEN_MCP_ENDPOINT = "https://mcp.heygen.com/mcp/v1/";

function hasExpired(session: HeyGenOAuthSession, now: Date): boolean {
  return Boolean(session.expiresAt && Number.isFinite(Date.parse(session.expiresAt)) && Date.parse(session.expiresAt) <= now.getTime());
}

export async function configureHeyGenMcpClient(options: ConfigureHeyGenMcpClientOptions): Promise<HeyGenMcpClient> {
  const session = await options.sessionStore.read(options.workspaceId);
  if (!session?.accessToken) return { available: false, reason: "missing-session" };
  if (hasExpired(session, new Date())) return { available: false, reason: "expired-session" };

  const endpoint = options.endpoint ?? DEFAULT_HEYGEN_MCP_ENDPOINT;
  if (new URL(endpoint).protocol !== "https:") throw new Error("O endpoint MCP do HeyGen deve usar HTTPS.");
  const connection = await options.connector.connect({
    endpoint,
    session,
    onSessionUpdated: options.sessionStore.write
      ? (updatedSession) => options.sessionStore.write!(options.workspaceId, updatedSession)
      : undefined,
  });
  return { available: true, callTool: (name, input) => connection.callTool(name, input) };
}
