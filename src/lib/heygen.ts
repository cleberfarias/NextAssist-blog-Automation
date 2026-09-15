export const HEYGEN_MCP_URL = "https://mcp.heygen.com/mcp/v1/";

export interface HeyGenMcpVideoRequest {
  title: string;
  prompt: string;
  avatarId: string;
  voiceId: string;
  brandKitId?: string;
  aspectRatio: "9:16" | "16:9";
  music: boolean;
  musicVolume?: number;
}

export interface HeyGenMcpVideoResult {
  videoUrl?: string;
  videoBuffer?: Buffer;
  videoId?: string;
}

/**
 * Boundary entre o domínio do NextAssist e um cliente MCP autenticado por OAuth.
 *
 * O repositório NÃO conhece API keys do HeyGen. O runtime responsável por rodar
 * os agentes deve fornecer uma implementação já autenticada do MCP e registrá-la
 * através de `configureHeyGenMcpClient` durante o bootstrap.
 */
export interface HeyGenMcpClient {
  generateVideo(request: HeyGenMcpVideoRequest): Promise<HeyGenMcpVideoResult>;
}

let heygenMcpClient: HeyGenMcpClient | null = null;

export function configureHeyGenMcpClient(client: HeyGenMcpClient): void {
  heygenMcpClient = client;
}

export function clearHeyGenMcpClient(): void {
  heygenMcpClient = null;
}

export function isHeyGenMcpAvailable(): boolean {
  return heygenMcpClient !== null;
}

export async function generateHeyGenMcpReel(request: HeyGenMcpVideoRequest): Promise<Buffer> {
  if (!heygenMcpClient) {
    throw new Error(
      `HeyGen MCP indisponível no runtime. Configure um cliente OAuth para ${HEYGEN_MCP_URL}. ` +
      "O Reel foi bloqueado e não haverá fallback para outro gerador.",
    );
  }

  const result = await heygenMcpClient.generateVideo(request);
  if (result.videoBuffer?.length) return result.videoBuffer;

  if (result.videoUrl) {
    const response = await fetch(result.videoUrl);
    if (!response.ok) {
      throw new Error(`HeyGen MCP gerou o vídeo, mas o download falhou (${response.status}).`);
    }
    return Buffer.from(await response.arrayBuffer());
  }

  throw new Error("HeyGen MCP concluiu sem retornar videoBuffer ou videoUrl.");
}
