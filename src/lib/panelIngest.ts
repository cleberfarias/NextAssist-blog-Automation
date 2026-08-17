// src/lib/panelIngest.ts
import { config } from "../config.js";
import type { PipelineEvent } from "../pipeline.js";

export async function pushEventToPanel(workspaceId: string, event: PipelineEvent): Promise<void> {
  if (!config.panelIngestUrl || !config.panelIngestToken) return;
  try {
    await fetch(config.panelIngestUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Panel-Ingest-Token": config.panelIngestToken },
      body: JSON.stringify({ ...event, workspaceId }),
    });
  } catch {
    // painel indisponível ou fora do ar — não é motivo pra falhar o pipeline
  }
}
