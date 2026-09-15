import assert from "node:assert/strict";
import test from "node:test";
import type { CalendarTopic } from "../contentCalendar.js";
import type { ContentRegistryEntry } from "../contentRegistry.js";
import type { HistoryEntry } from "../history.js";
import type { RunRecord } from "../runsHistory.js";
import type { ReelRecord, ReelStateReport } from "../reels/state.js";
import {
  mergeContentCalendar, mergeContentRegistry, mergePostHistory, mergeReelState, mergeRunsHistory, mergeWorkspaceState,
} from "./workspaceStateMerge.js";

// ---- content-calendar.json ----

function topic(overrides: Partial<CalendarTopic>): CalendarTopic {
  return { tema: "tema", palavraChaveAlvo: "palavra", publicado: false, ...overrides };
}

test("mergeContentCalendar preserva tópicos únicos dos dois lados", () => {
  const remote = [topic({ tema: "A" })];
  const local = [topic({ tema: "B" })];
  const merged = mergeContentCalendar(remote, local);
  assert.deepEqual(merged.map((t) => t.tema).sort(), ["A", "B"]);
});

test("mergeContentCalendar nunca regride publicado:true para false", () => {
  const remote = [topic({ tema: "A", publicado: true, publicadoEm: "2026-01-01T00:00:00.000Z" })];
  const local = [topic({ tema: "A", publicado: false })];
  const merged = mergeContentCalendar(remote, local);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].publicado, true);
});

test("mergeContentCalendar dedupe por tema sem duplicar entradas", () => {
  const remote = [topic({ tema: "A" })];
  const local = [topic({ tema: "A" })];
  assert.equal(mergeContentCalendar(remote, local).length, 1);
});

// ---- post-history.json ----

function historyEntry(overrides: Partial<HistoryEntry>): HistoryEntry {
  return { tema: "tema", titulo: "titulo", slug: "slug", publicadoEm: "2026-01-01T00:00:00.000Z", ...overrides };
}

test("mergePostHistory une posts dos dois lados sem duplicar por slug", () => {
  const remote = [historyEntry({ slug: "a" })];
  const local = [historyEntry({ slug: "b" })];
  const merged = mergePostHistory(remote, local);
  assert.deepEqual(merged.map((e) => e.slug).sort(), ["a", "b"]);
});

test("mergePostHistory não perde posts do remoto quando o local não os tem", () => {
  const remote = [historyEntry({ slug: "a" }), historyEntry({ slug: "b" })];
  const local: HistoryEntry[] = [];
  assert.equal(mergePostHistory(remote, local).length, 2);
});

test("mergePostHistory com mesmo slug nos dois lados mantém a entrada mais recente", () => {
  const remote = [historyEntry({ slug: "a", titulo: "velho", publicadoEm: "2026-01-01T00:00:00.000Z" })];
  const local = [historyEntry({ slug: "a", titulo: "novo", publicadoEm: "2026-01-02T00:00:00.000Z" })];
  const merged = mergePostHistory(remote, local);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].titulo, "novo");
});

// ---- content-registry.json ----

function registryEntry(overrides: Partial<ContentRegistryEntry>): ContentRegistryEntry {
  return {
    contentId: "id", campaignId: null, tema: "tema", formato: "blog", channel: "blog",
    funnelStage: "meio", publicadoEm: "2026-01-01T00:00:00.000Z", status: "published", url: "https://x.test/id",
    ...overrides,
  };
}

test("mergeContentRegistry preserva registros dos dois lados por contentId distinto", () => {
  const remote = [registryEntry({ contentId: "a" })];
  const local = [registryEntry({ contentId: "b" })];
  assert.deepEqual(mergeContentRegistry(remote, local).map((e) => e.contentId).sort(), ["a", "b"]);
});

test("mergeContentRegistry prefere published sobre draft-pending-approval para o mesmo contentId", () => {
  const remote = [registryEntry({ contentId: "a", status: "draft-pending-approval" })];
  const local = [registryEntry({ contentId: "a", status: "published" })];
  const merged = mergeContentRegistry(remote, local);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].status, "published");
});

test("mergeContentRegistry não regride published para draft-pending-approval", () => {
  const remote = [registryEntry({ contentId: "a", status: "published" })];
  const local = [registryEntry({ contentId: "a", status: "draft-pending-approval" })];
  const merged = mergeContentRegistry(remote, local);
  assert.equal(merged[0].status, "published");
});

// ---- runs-history.json ----

function run(overrides: Partial<RunRecord>): RunRecord {
  return {
    id: "2026-01-01T00:00:00.000Z", origem: "action", iniciadoEm: "2026-01-01T00:00:00.000Z",
    finalizadoEm: "2026-01-01T00:05:00.000Z", tema: null, status: "publicado", slug: null, erro: null, eventos: [],
    ...overrides,
  };
}

test("mergeRunsHistory une execuções dos dois lados, dedupe por id, ordena por iniciadoEm desc", () => {
  const remote = [run({ id: "r1", iniciadoEm: "2026-01-01T00:00:00.000Z" })];
  const local = [run({ id: "r2", iniciadoEm: "2026-01-02T00:00:00.000Z" })];
  const merged = mergeRunsHistory(remote, local);
  assert.deepEqual(merged.map((r) => r.id), ["r2", "r1"]);
});

test("mergeRunsHistory com mesmo id mantém o registro com finalizadoEm mais recente", () => {
  const remote = [run({ id: "r1", finalizadoEm: "2026-01-01T00:01:00.000Z", status: "falhou" })];
  const local = [run({ id: "r1", finalizadoEm: "2026-01-01T00:05:00.000Z", status: "publicado" })];
  const merged = mergeRunsHistory(remote, local);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].status, "publicado");
});

test("mergeRunsHistory respeita o limite configurável", () => {
  const remote = Array.from({ length: 5 }, (_, i) => run({ id: `r${i}`, iniciadoEm: `2026-01-0${i + 1}T00:00:00.000Z` }));
  assert.equal(mergeRunsHistory(remote, [], 3).length, 3);
});

// ---- reel-state.json ----

function reel(overrides: Partial<ReelRecord>): ReelRecord {
  return {
    id: "ws:slug", workspaceId: "ws", slug: "slug", title: "Titulo", blogUrl: "https://x.test/slug",
    caption: "Legenda", provider: "heygen-api", avatarId: "avatar", voiceId: "voice", status: "queued",
    createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", audit: [],
    ...overrides,
  };
}

test("mergeReelState: remoto published sempre vence, mesmo com local em rendering", () => {
  const remote: ReelStateReport = { updatedAt: "x", entries: [reel({ status: "published", updatedAt: "2026-01-01T00:10:00.000Z" })] };
  const local: ReelStateReport = { updatedAt: "x", entries: [reel({ status: "rendering", updatedAt: "2026-01-01T00:20:00.000Z" })] };
  const merged = mergeReelState(remote, local);
  assert.equal(merged.entries[0].status, "published");
});

test("mergeReelState: pending_approval remoto vence sobre queued local mais velho", () => {
  const remote: ReelStateReport = { updatedAt: "x", entries: [reel({ status: "pending_approval" })] };
  const local: ReelStateReport = { updatedAt: "x", entries: [reel({ status: "queued" })] };
  const merged = mergeReelState(remote, local);
  assert.equal(merged.entries[0].status, "pending_approval");
});

test("mergeReelState preserva videoId/videoUrl/mediaId/permalink do lado vencedor e do perdedor quando o vencedor não tem", () => {
  const remote: ReelStateReport = { updatedAt: "x", entries: [reel({ status: "pending_approval", videoUrl: "https://files/video.mp4" })] };
  const local: ReelStateReport = { updatedAt: "x", entries: [reel({ status: "queued", videoId: "hg_abc" })] };
  const merged = mergeReelState(remote, local);
  assert.equal(merged.entries[0].videoUrl, "https://files/video.mp4");
  assert.equal(merged.entries[0].videoId, "hg_abc");
});

test("mergeReelState funde os audit trails dos dois lados sem duplicar eventos", () => {
  const remote: ReelStateReport = {
    updatedAt: "x",
    entries: [reel({ status: "rendering", audit: [{ from: null, to: "queued", at: "2026-01-01T00:00:00.000Z", actor: "pipeline" }] })],
  };
  const local: ReelStateReport = {
    updatedAt: "x",
    entries: [reel({
      status: "rendering",
      audit: [
        { from: null, to: "queued", at: "2026-01-01T00:00:00.000Z", actor: "pipeline" },
        { from: "queued", to: "rendering", at: "2026-01-01T00:01:00.000Z", actor: "system" },
      ],
    })],
  };
  const merged = mergeReelState(remote, local);
  assert.equal(merged.entries[0].audit.length, 2);
});

test("mergeReelState preserva reels únicos de cada lado", () => {
  const remote: ReelStateReport = { updatedAt: "x", entries: [reel({ id: "ws:a", slug: "a" })] };
  const local: ReelStateReport = { updatedAt: "x", entries: [reel({ id: "ws:b", slug: "b" })] };
  const merged = mergeReelState(remote, local);
  assert.deepEqual(merged.entries.map((e) => e.id).sort(), ["ws:a", "ws:b"]);
});

test("mergeReelState trata remoto/local nulos como vazios", () => {
  const merged = mergeReelState(null, { updatedAt: "x", entries: [reel({})] });
  assert.equal(merged.entries.length, 1);
});

// ---- orquestração completa ----

test("mergeWorkspaceState combina os cinco arquivos de uma vez", () => {
  const merged = mergeWorkspaceState(
    {
      contentCalendar: { topicos: [topic({ tema: "A", publicado: true })] },
      contentRegistry: [registryEntry({ contentId: "a" })],
      postHistory: [historyEntry({ slug: "a" })],
      runsHistory: [run({ id: "r1" })],
      reelState: { updatedAt: "x", entries: [reel({ status: "pending_approval" })] },
    },
    {
      contentCalendar: { topicos: [topic({ tema: "B" })] },
      contentRegistry: [registryEntry({ contentId: "b" })],
      postHistory: [historyEntry({ slug: "b" })],
      runsHistory: [run({ id: "r2", iniciadoEm: "2026-01-02T00:00:00.000Z" })],
      reelState: { updatedAt: "x", entries: [reel({ status: "queued" })] },
    },
  );
  assert.equal(merged.contentCalendar.topicos.length, 2);
  assert.equal(merged.contentRegistry.length, 2);
  assert.equal(merged.postHistory.length, 2);
  assert.equal(merged.runsHistory.length, 2);
  assert.equal(merged.reelState.entries[0].status, "pending_approval");
});

test("mergeWorkspaceState trata campos ausentes/nulos como vazios sem lançar erro", () => {
  const merged = mergeWorkspaceState({}, {});
  assert.deepEqual(merged.contentCalendar.topicos, []);
  assert.deepEqual(merged.contentRegistry, []);
  assert.deepEqual(merged.postHistory, []);
  assert.deepEqual(merged.runsHistory, []);
  assert.deepEqual(merged.reelState.entries, []);
});
