import OpenAI from "openai";
import { config } from "../config.js";

const openai = config.openaiApiKey ? new OpenAI({ apiKey: config.openaiApiKey }) : null;

/**
 * Gera a narração em áudio (MP3) para o Reel do Instagram, a partir de um
 * texto curto. Usa o TTS da OpenAI (mesma credencial da API principal).
 */
export async function generateNarration(text: string): Promise<Buffer> {
  if (!openai) {
    throw new Error("OPENAI_API_KEY não configurada — necessária para gerar a narração do Reel.");
  }

  const response = await openai.audio.speech.create({
    model: "gpt-4o-mini-tts",
    voice: "nova",
    input: text,
    instructions: "Fale em português do Brasil, tom animado e natural, ritmo rápido.",
    response_format: "mp3",
  });

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}
