import assert from "node:assert/strict";
import test from "node:test";
import { buildStudioScenes, type AvatarVideoScene, type VideoScene } from "./studioScenes.js";
import { NEXTASSIST_BROLL } from "./broll.js";

const brief = {
  gancho: "Você sabe quanto perde por falta de controle?",
  blocos: ["Cliente, OS e peças espalhadas viram retrabalho.", "Narração 1", "Narração 2", "Narração 3", "Narração 4"],
  cta: "Teste o NextAssist grátis por sete dias.",
};

const broll = [NEXTASSIST_BROLL[0], NEXTASSIST_BROLL[1], NEXTASSIST_BROLL[2], NEXTASSIST_BROLL[3]];

test("buildStudioScenes produz exatamente 7 cenas no padrão Avatar/B-roll/B-roll/Avatar/B-roll/B-roll/Avatar (golden reference)", () => {
  const scenes = buildStudioScenes({ brief, broll, avatarId: "avatar-1", voiceId: "voice-1" });
  assert.equal(scenes.length, 7);
  assert.deepEqual(scenes.map((s) => s.type), [
    "avatar_video", "video", "video", "avatar_video", "video", "video", "avatar_video",
  ]);
});

test("cenas de avatar usam gancho/transição/cta nas posições certas", () => {
  const scenes = buildStudioScenes({ brief, broll, avatarId: "avatar-1", voiceId: "voice-1" });
  const avatarScenes = scenes.filter((s): s is AvatarVideoScene => s.type === "avatar_video");
  assert.equal(avatarScenes[0].input.script, brief.gancho);
  assert.equal(avatarScenes[1].input.script, brief.blocos[0]);
  assert.equal(avatarScenes[2].input.script, brief.cta);
});

test("cenas de B-roll usam as narrações e os 4 assets selecionados, na ordem", () => {
  const scenes = buildStudioScenes({ brief, broll, avatarId: "avatar-1", voiceId: "voice-1" });
  const brollScenes = scenes.filter((s): s is VideoScene => s.type === "video");
  assert.deepEqual(brollScenes.map((s) => s.script), [brief.blocos[1], brief.blocos[2], brief.blocos[3], brief.blocos[4]]);
  assert.deepEqual(brollScenes.map((s) => s.source.asset_id), broll.map((a) => a.assetId));
});

test("cenas de avatar seguem os parâmetros confirmados: engine avatar_iv, expressiveness high, voice speed 1.05, fundo cor sólida", () => {
  const scenes = buildStudioScenes({ brief, broll, avatarId: "avatar-1", voiceId: "voice-1" });
  const avatarScenes = scenes.filter((s): s is AvatarVideoScene => s.type === "avatar_video");
  for (const scene of avatarScenes) {
    assert.deepEqual(scene.input.engine, { type: "avatar_iv" });
    assert.equal(scene.input.expressiveness, "high");
    assert.equal(scene.input.voice_settings.speed, 1.05);
    assert.equal(scene.input.background.type, "color");
    assert.match(scene.input.background.color, /^#[0-9A-Fa-f]{6}$/);
    assert.equal(scene.input.avatar_id, "avatar-1");
    assert.equal(scene.input.voice_id, "voice-1");
  }
});

test("cada cena de avatar tem um motion_prompt específico e diferente por trecho", () => {
  const scenes = buildStudioScenes({ brief, broll, avatarId: "avatar-1", voiceId: "voice-1" });
  const prompts = scenes.filter((s): s is AvatarVideoScene => s.type === "avatar_video").map((s) => s.input.motion_prompt);
  assert.equal(prompts.length, 3);
  for (const p of prompts) assert.ok(p.trim().length > 0);
  assert.equal(new Set(prompts).size, 3); // as 3 são diferentes entre si
});

test("cenas de B-roll ficam mudas (playback.volume 0) — só a narração deve soar", () => {
  const scenes = buildStudioScenes({ brief, broll, avatarId: "avatar-1", voiceId: "voice-1" });
  const brollScenes = scenes.filter((s): s is VideoScene => s.type === "video");
  for (const scene of brollScenes) {
    assert.equal(scene.playback.volume, 0);
    assert.equal(scene.playback.mode, "fit_to_scene");
    assert.equal(scene.source.type, "asset_id");
    assert.equal(scene.voice_id, "voice-1");
  }
});

test("exige exatamente 5 blocos — falha alto em vez de montar cena incompleta", () => {
  assert.throws(() => buildStudioScenes({ brief: { ...brief, blocos: ["só um"] }, broll, avatarId: "a", voiceId: "v" }), /5 blocos/);
});

test("exige exatamente 4 vídeos de B-roll — falha alto em vez de montar cena incompleta", () => {
  assert.throws(() => buildStudioScenes({ brief, broll: broll.slice(0, 2), avatarId: "a", voiceId: "v" }), /4 vídeos de B-roll/);
});
