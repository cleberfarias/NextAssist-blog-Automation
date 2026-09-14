import type { BrollAsset } from "./broll.js";

/**
 * Tipos que espelham, campo a campo, o schema oficial `CreateVideoFromStudioInput`
 * da HeyGen (confirmado via schema tipado da ferramenta MCP `create_video_from_studio`,
 * não deduzido do modelo de leitura de `get_video_scenes`, que tem um formato
 * diferente do payload de criação). Cena de avatar é aninhada (`input`), cena de
 * B-roll é plana — essa assimetria também vem direto do schema confirmado.
 */
export interface StudioColorBackground {
  type: "color";
  color: string;
}

export interface StudioVoiceSettings {
  pitch: number;
  speed: number;
  volume: number;
}

export interface StudioAvatarInput {
  type: "avatar";
  avatar_id: string;
  script: string;
  voice_id: string;
  voice_settings: StudioVoiceSettings;
  engine: { type: "avatar_iv" };
  expressiveness: "high" | "medium" | "low";
  motion_prompt: string;
  background: StudioColorBackground;
}

export interface AvatarVideoScene {
  type: "avatar_video";
  input: StudioAvatarInput;
}

export interface VideoScenePlayback {
  mode: "fit_to_scene" | "freeze" | "loop";
  volume: number;
}

export interface VideoScene {
  type: "video";
  source: { type: "asset_id"; asset_id: string };
  script: string;
  voice_id: string;
  playback: VideoScenePlayback;
}

export type StudioScene = AvatarVideoScene | VideoScene;

export interface ReelBriefForScenes {
  gancho: string;
  /** Exatamente 5: [0] fala de transição do avatar, [1..4] narração de cada B-roll. */
  blocos: string[];
  cta: string;
}

export interface StudioScenePlanInput {
  brief: ReelBriefForScenes;
  /** Exatamente 4, distintos — ver `selectBrollForPost` em `broll.ts`. */
  broll: BrollAsset[];
  avatarId: string;
  voiceId: string;
}

/** Mesma cor de fundo do vídeo de referência `b01f896ff2834a4f1d4b7e5a07e3d02d`. */
const AVATAR_BACKGROUND_COLOR = "#F6F6FC";
/** Mesmos ajustes de voz confirmados no vídeo de referência. */
const VOICE_SETTINGS: StudioVoiceSettings = { pitch: 0, speed: 1.05, volume: 1 };

const MOTION_PROMPTS = {
  abertura: "Apresentador confiante e natural, olhando para a câmera, com gestos leves das mãos e energia de vídeo curto para redes sociais.",
  transicao: "Fala natural e convincente, pequenos gestos com as mãos, expressão amigável e segura.",
  fechamento: "Encerramento energético e convidativo, olhando para a câmera, com gesto leve de convite no CTA.",
} as const;

function avatarScene(script: string, motionPrompt: string, avatarId: string, voiceId: string): AvatarVideoScene {
  return {
    type: "avatar_video",
    input: {
      type: "avatar",
      avatar_id: avatarId,
      script,
      voice_id: voiceId,
      voice_settings: { ...VOICE_SETTINGS },
      engine: { type: "avatar_iv" },
      expressiveness: "high",
      motion_prompt: motionPrompt,
      background: { type: "color", color: AVATAR_BACKGROUND_COLOR },
    },
  };
}

function brollScene(script: string, asset: BrollAsset, voiceId: string): VideoScene {
  return {
    type: "video",
    source: { type: "asset_id", asset_id: asset.assetId },
    script,
    voice_id: voiceId,
    playback: { mode: "fit_to_scene", volume: 0 },
  };
}

/**
 * Monta as 7 cenas do Studio multi-cena, sempre no padrão do golden reference
 * (`b01f896ff2834a4f1d4b7e5a07e3d02d`): Avatar → B-roll → B-roll → Avatar →
 * B-roll → B-roll → Avatar/CTA. Generaliza a composição (avatar/voz/roteiro
 * mudam por post) sem se desviar da estrutura validada.
 */
export function buildStudioScenes(input: StudioScenePlanInput): StudioScene[] {
  const { brief, broll, avatarId, voiceId } = input;
  if (brief.blocos.length !== 5) {
    throw new Error("Studio multi-cena exige exatamente 5 blocos no roteiro (1 fala de avatar + 4 narrações de B-roll).");
  }
  if (broll.length !== 4) {
    throw new Error("Studio multi-cena exige exatamente 4 vídeos de B-roll selecionados.");
  }
  const [transicao, narracao1, narracao2, narracao3, narracao4] = brief.blocos;
  return [
    avatarScene(brief.gancho, MOTION_PROMPTS.abertura, avatarId, voiceId),
    brollScene(narracao1, broll[0], voiceId),
    brollScene(narracao2, broll[1], voiceId),
    avatarScene(transicao, MOTION_PROMPTS.transicao, avatarId, voiceId),
    brollScene(narracao3, broll[2], voiceId),
    brollScene(narracao4, broll[3], voiceId),
    avatarScene(brief.cta, MOTION_PROMPTS.fechamento, avatarId, voiceId),
  ];
}
