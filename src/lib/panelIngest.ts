import { config } from "../config.js";
import type { PipelineEvent } from "../pipeline.js";

/**
 * Empurra um evento do pipeline pro painel hospedado (`/api/events/ingest`),
 * pra ele acender as mesas do escritório em tempo real mesmo quando o
 * pipeline roda numa GitHub Action (fora do processo do painel). Melhor
 * esforço: nunca lança, pra nunca derrubar o pipeline por causa do painel.
 */
export async function pushEventToPanel(event: PipelineEvent): Promise<void> {
  if (!config.panelIngestUrl || !config.panelIngestToken) return;

  try {
    await fetch(config.panelIngestUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Panel-Ingest-Token": config.panelIngestToken,
      },
      body: JSON.stringify(event),
    });
  } catch {
    // painel indisponível ou fora do ar — não é motivo pra falhar o pipeline
  }
}
